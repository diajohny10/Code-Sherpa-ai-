import { sha256 } from './validation.ts';
import type { RuntimeAssets } from './wasiEngine.ts';

const base = '/python-runtime/';
const names = ['python.wasm', 'python314.zip', 'os.py', 'LICENSE'] as const;
const limits = { 'python.wasm': 30 * 1024 * 1024, 'python314.zip': 40 * 1024 * 1024, 'os.py': 200000, LICENSE: 200000 };
export interface RuntimeManifest {
  runtimeVersion: string; archiveSha256: string; source: string;
  files: Record<string, { size: number; sha256: string }>;
}
async function readAsset(name: string, maximum: number): Promise<Uint8Array> {
  const response = await fetch(base + name, { credentials: 'omit', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Python assets missing. Run npm run prepare:python.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) throw new Error('Python asset exceeds size limit');
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function loadRuntimeAssets(): Promise<RuntimeAssets> {
  const manifest: RuntimeManifest = JSON.parse(new TextDecoder().decode(await readAsset('manifest.json', 8192)));
  if (manifest.runtimeVersion !== '3.14.9' || manifest.archiveSha256 !== '8de7834105edef8db8a13299e2587cf8945021dd8764f2691d83bbc25129dfa2' || manifest.source !== 'https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.14.9/python-3.14.9-wasi_sdk-24.zip') throw new Error('Python runtime provenance mismatch. Run npm run prepare:python.');
  const files: Record<string, Uint8Array> = {};
  for (const name of names) {
    const expected = manifest.files?.[name];
    if (!expected || !Number.isSafeInteger(expected.size) || expected.size <= 0 || expected.size > limits[name] || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('Invalid Python asset manifest');
    const bytes = await readAsset(name, expected.size);
    if (bytes.length !== expected.size || await sha256(bytes) !== expected.sha256) throw new Error(`Python asset checksum mismatch: ${name}. Run npm run prepare:python.`);
    files[name] = bytes;
  }
  return { wasm: files['python.wasm'], stdlib: files['python314.zip'], os: files['os.py'] };
}