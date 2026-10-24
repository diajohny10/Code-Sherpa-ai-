import { loadRuntimeAssets } from './assets.ts';
import { executePythonCase } from './wasiEngine.ts';
import { validateRequest } from './validation.ts';
import type { PythonExecutionRequest } from './types.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (value: unknown) => void;
};
let used = false;
scope.onmessage = async (event: MessageEvent) => {
  if (used) return;
  const value = event.data as { jobId?: unknown; request?: PythonExecutionRequest };
  if (!value || typeof value.jobId !== 'string' || value.jobId.length > 128 || !value.request) return;
  used = true;
  try {
    validateRequest(value.request);
    if (value.request.cases.length !== 1) throw new Error('Worker accepts one isolated case');
    const assets = await loadRuntimeAssets();
    let started = false;
    const result = await executePythonCase(assets, value.request, value.request.cases[0], () => {
      started = true;
      scope.postMessage({ jobId: value.jobId, type: 'ready' });
    });
    if (started) scope.postMessage({ jobId: value.jobId, type: 'result', result });
    else scope.postMessage({ jobId: value.jobId, type: 'error', message: result.error?.message.slice(0, 2048) ?? 'Python runtime could not initialize' });
  } catch (error) {
    scope.postMessage({ jobId: value.jobId, type: 'error', message: error instanceof Error ? error.message.slice(0, 2048) : 'Python engine error' });
  }
};