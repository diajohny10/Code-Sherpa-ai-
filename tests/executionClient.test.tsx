import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runPython } from '../src/execution/client';
import type { PythonCaseResult, PythonExecutionRequest } from '../src/execution/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static receive: ((worker: FakeWorker, value: { jobId: string; request: PythonExecutionRequest }) => void) | undefined;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  terminate() { this.terminated = true; }
  postMessage(value: { jobId: string; request: PythonExecutionRequest }) { FakeWorker.receive?.(this, value); }
  send(data: unknown) { this.onmessage?.({ data }); }
}
const request = (source = 'print(1)'): PythonExecutionRequest => ({ source, mode: 'script', operation: 'run', cases: [{ id: 'one' }] });
const result = (id = 'one'): PythonCaseResult => ({ id, status: 'completed', stdout: '1\n', stderr: '', exitCode: 0, durationMs: 1 });
beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.receive = undefined;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const started = async () => { await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1)); return FakeWorker.instances[0]; };

it('a completed run without expectations is not passed; hashes track source and stable suite separately', async () => {
  FakeWorker.receive = (worker, value) => { worker.send({ jobId: value.jobId, type: 'ready' }); worker.send({ jobId: value.jobId, type: 'result', result: result() }); };
  const progress = vi.fn();
  const first = await runPython(request(), { onProgress: progress });
  const next = await runPython(request('print(2)'));
  expect(first.allPassed).toBe(false);
  expect(first.passed).toBe(0);
  expect(first.sourceHash).not.toBe(next.sourceHash);
  expect(first.suiteHash).toBe(next.suiteHash);
  expect(progress).toHaveBeenCalledWith({ completed: 1, total: 1 });
  expect(FakeWorker.instances.every(worker => worker.terminated)).toBe(true);
});
it('rejects concurrent batches immediately, aborts with AbortError and releases admission', async () => {
  const controller = new AbortController();
  const pending = runPython(request(), { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await started();
  await expect(runPython(request())).rejects.toThrow(/busy/);
  controller.abort();
  await rejection;
  expect(FakeWorker.instances[0].terminated).toBe(true);
  const preAborted = new AbortController(); preAborted.abort();
  await expect(runPython(request(), { signal: preAborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
it('ignores stale IDs, malformed results and result-before-ready; kills stalled loading', async () => {
  FakeWorker.receive = (worker, value) => {
    worker.send({ jobId: 'stale', type: 'ready' });
    worker.send({ jobId: value.jobId, type: 'result', result: result() });
    worker.send({ jobId: value.jobId, type: 'result', result: { ...result(), stdout: {} } });
  };
  const report = await runPython(request(), { loadTimeoutMs: 50 });
  expect(report.results[0].status).toBe('engine_error');
  expect(report.allPassed).toBe(false);
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it('terminates execution deadline and rejects oversized worker payloads', async () => {
  FakeWorker.receive = (worker, value) => {
    worker.send({ jobId: value.jobId, type: 'ready' });
    worker.send({ jobId: value.jobId, type: 'result', result: { ...result(), stdout: 'x'.repeat(65537) } });
  };
  const report = await runPython(request(), { executionTimeoutMs: 20 });
  expect(report.results[0].status).toBe('timeout');
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it('isolates every case with a new worker and preserves progress', async () => {
  FakeWorker.receive = (worker, value) => {
    worker.send({ jobId: value.jobId, type: 'ready' });
    worker.send({ jobId: value.jobId, type: 'result', result: { ...result(value.request.cases[0].id), status: 'passed' } });
  };
  const report = await runPython({ ...request(), operation: 'test', cases: [{ id: 'one', expected: '1' }, { id: 'two', expected: '1' }] });
  expect(report.allPassed).toBe(true);
  expect(report.results).toHaveLength(2);
  expect(FakeWorker.instances).toHaveLength(2);
  expect(FakeWorker.instances.every(worker => worker.terminated)).toBe(true);
});
it('rejects oversized batches and unavailable browser capability before starting a worker', async () => {
  await expect(runPython({ ...request(), operation: 'test', cases: Array.from({ length: 11 }, (_, index) => ({ id: String(index), expected: '1' })) })).rejects.toThrow(/1-10/);
  vi.stubGlobal('Worker', undefined);
  await expect(runPython(request())).rejects.toThrow(/does not support/);
  expect(FakeWorker.instances).toHaveLength(0);
});
it('asset and worker errors reject, never manufacture a successful execution', async () => {
  FakeWorker.receive = (worker, value) => worker.send({ jobId: value.jobId, type: 'error', message: 'Run npm run prepare:python.' });
  await expect(runPython(request())).rejects.toThrow(/prepare:python/);
  expect(FakeWorker.instances[0].terminated).toBe(true);
});
it('the global 60-second batch deadline prevents additional cases from starting', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  FakeWorker.receive = (worker, value) => {
    worker.send({ jobId: value.jobId, type: 'ready' });
    clock = 60001;
    worker.send({ jobId: value.jobId, type: 'result', result: { ...result('one'), status: 'passed' } });
  };
  const report = await runPython({ ...request(), operation: 'test', cases: [{ id: 'one', expected: '1' }, { id: 'two', expected: '1' }] });
  expect(report.results[1].status).toBe('timeout');
  expect(report.allPassed).toBe(false);
  expect(FakeWorker.instances).toHaveLength(1);
});