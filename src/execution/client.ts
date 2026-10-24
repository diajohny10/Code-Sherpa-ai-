import type { PythonCaseResult, PythonExecutionReport, PythonExecutionRequest } from './types.ts';
import { hasOwn, sha256, stable, validateJSON, validateRequest } from './validation.ts';
import { RUNTIME_VERSION } from './wasiEngine.ts';
export type * from './types.ts';

export interface PythonExecutionOptions {
  signal?: AbortSignal; onProgress?: (value: { completed: number; total: number }) => void;
  executionTimeoutMs?: number; loadTimeoutMs?: number;
}
let active = false;
const statuses = new Set(['passed', 'failed', 'completed', 'syntax_error', 'runtime_error', 'timeout', 'output_limit', 'memory_limit', 'cancelled', 'unsupported', 'engine_error']);
const abortError = () => new DOMException('Python execution cancelled', 'AbortError');
function validResult(value: unknown, id: string, mode: PythonExecutionRequest['mode']): value is PythonCaseResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as PythonCaseResult;
  if (result.id !== id || !statuses.has(result.status) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || new TextEncoder().encode(result.stdout + result.stderr).length > 65536 || !(result.exitCode === null || Number.isSafeInteger(result.exitCode)) || !Number.isFinite(result.durationMs) || result.durationMs < 0) return false;
  if (result.error !== undefined && (!result.error || typeof result.error.type !== 'string' || result.error.type.length > 128 || typeof result.error.message !== 'string' || result.error.message.length > 65536 || (result.error.line !== undefined && (!Number.isSafeInteger(result.error.line) || result.error.line < 1)))) return false;
  try {
    if (hasOwn(result, 'actual')) {
      validateJSON(result.actual);
      if (mode === 'function' && new TextEncoder().encode(JSON.stringify(result.actual)).length > 8192) return false;
      if (mode === 'script' && (typeof result.actual !== 'string' || new TextEncoder().encode(result.actual).length > 65536)) return false;
    }
  } catch { return false; }
  return true;
}
const deadline = (value: number | undefined, maximum: number): number => {
  if (value === undefined) return maximum;
  if (!Number.isFinite(value) || value <= 0) throw new Error('Timeout must be a positive finite number');
  return Math.min(value, maximum);
};

export async function runPython(request: PythonExecutionRequest, options: PythonExecutionOptions = {}): Promise<PythonExecutionReport> {
  if (options.signal?.aborted) throw abortError();
  if (active) throw new Error('Python execution is busy; wait for the active batch or cancel it.');
  validateRequest(request);
  const executionTimeout = deadline(options.executionTimeoutMs, 3000);
  const loadTimeout = deadline(options.loadTimeoutMs, 30000);
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined' || !globalThis.crypto?.subtle || typeof globalThis.crypto.randomUUID !== 'function') throw new Error('This browser does not support the isolated Python WASM worker.');
  active = true;
  const started = performance.now();
  try {
    const snapshot = structuredClone(request);
    const sourceHash = await sha256(snapshot.source);
    const suiteHash = await sha256(stable({ operation: snapshot.operation, mode: snapshot.mode, functionName: snapshot.functionName ?? null, cases: snapshot.cases }));
    const results: PythonCaseResult[] = [];
    for (const entry of snapshot.cases) {
      if (options.signal?.aborted) throw abortError();
      const remaining = 60000 - (performance.now() - started);
      if (remaining <= 0) {
        results.push({ id: entry.id, status: 'timeout', stdout: '', stderr: '', exitCode: null, error: { type: 'BatchTimeout', message: 'Batch exceeded 60 seconds' }, durationMs: 0 });
        continue;
      }
      const result = await new Promise<PythonCaseResult>((resolve, reject) => {
        const worker = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
        const jobId = crypto.randomUUID();
        let ready = false;
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;
        const caseStarted = performance.now();
        const cleanup = () => { clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.terminate(); options.signal?.removeEventListener('abort', abort); };
        const finish = (value?: PythonCaseResult, error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error); else resolve(value!);
        };
        const abort = () => finish(undefined, abortError());
        const timeout = () => finish({ id: entry.id, status: ready ? 'timeout' : 'engine_error', stdout: '', stderr: '', exitCode: null, error: { type: ready ? 'ExecutionTimeout' : 'LoadTimeout', message: ready ? 'Python exceeded execution deadline' : 'Python runtime loading timed out. Run npm run prepare:python.' }, durationMs: performance.now() - caseStarted });
        timer = setTimeout(timeout, Math.min(loadTimeout, remaining));
        worker.onerror = () => finish(undefined, new Error('Python worker failed to load or execute. Run npm run prepare:python.'));
        worker.onmessage = (event: MessageEvent) => {
          if (settled) return;
          const message = event.data;
          if (!message || typeof message !== 'object' || message.jobId !== jobId) return;
          if (message.type === 'ready' && !ready) {
            ready = true;
            clearTimeout(timer);
            timer = setTimeout(timeout, Math.max(1, Math.min(executionTimeout, remaining - (performance.now() - caseStarted))));
          } else if (message.type === 'result' && ready && validResult(message.result, entry.id, snapshot.mode)) finish(message.result);
          else if (message.type === 'error' && typeof message.message === 'string' && message.message.length <= 2048) finish(undefined, new Error(message.message));
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        else {
          try { worker.postMessage({ jobId, request: { ...snapshot, cases: [entry] } }); }
          catch { finish(undefined, new Error('Unable to send request to Python worker')); }
        }
      });
      results.push(result);
      options.onProgress?.({ completed: results.length, total: snapshot.cases.length });
    }
    const passed = results.filter(result => result.status === 'passed').length;
    const failed = results.filter(result => result.status !== 'passed' && result.status !== 'completed').length;
    return { engine: 'cpython-wasi', runtimeVersion: RUNTIME_VERSION, operation: snapshot.operation, mode: snapshot.mode, sourceHash, suiteHash, results, passed, failed, allPassed: passed === results.length && passed > 0, durationMs: performance.now() - started };
  } finally { active = false; }
}