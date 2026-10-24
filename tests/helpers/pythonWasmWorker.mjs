import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { executePythonCase } from '../../src/execution/wasiEngine.ts';

const root = new URL('../../public/python-runtime/', import.meta.url);
const assets = {
  wasm: new Uint8Array(await readFile(new URL('python.wasm', root))),
  stdlib: new Uint8Array(await readFile(new URL('python314.zip', root))),
  os: new Uint8Array(await readFile(new URL('os.py', root))),
};
try {
  const result = await executePythonCase(assets, workerData, workerData.cases[0], () => parentPort.postMessage({ type: 'ready' }));
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: String(error) });
}