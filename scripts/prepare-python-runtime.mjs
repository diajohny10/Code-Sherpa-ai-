import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

export const VERSION = '3.14.9';
export const ARCHIVE_HASH = '8de7834105edef8db8a13299e2587cf8945021dd8764f2691d83bbc25129dfa2';
export const URL = `https://github.com/brettcannon/cpython-wasi-build/releases/download/v${VERSION}/python-${VERSION}-wasi_sdk-24.zip`;
export const root = fileURLToPath(new globalThis.URL('../public/python-runtime/', import.meta.url));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function checkRuntime() {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  if (manifest.runtimeVersion !== VERSION || manifest.archiveSha256 !== ARCHIVE_HASH || manifest.source !== URL) throw new Error('Runtime provenance mismatch');
  for (const name of ['python.wasm', 'python314.zip', 'os.py', 'LICENSE']) {
    const bytes = await readFile(`${root}/${name}`);
    if (bytes.length !== manifest.files[name]?.size || digest(bytes) !== manifest.files[name]?.sha256) throw new Error(`Runtime checksum mismatch: ${name}`);
  }
  return manifest;
}

async function prepare() {
  try { await checkRuntime(); console.log('Verified cached CPython WASI runtime.'); return; } catch { /* Rebuild invalid or missing assets from the pinned archive. */ }
  const response = await fetch(URL, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`Runtime download failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 30 * 1024 * 1024) throw new Error('Runtime archive exceeds 30 MiB');
    chunks.push(chunk);
  }
  const archive = Buffer.concat(chunks);
  if (archive.length !== 14333948 || digest(archive) !== ARCHIVE_HASH) throw new Error('Pinned runtime archive SHA256/size mismatch');
  const entries = unzipSync(archive);
  const library = {};
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('lib/python3.14/') || name.endsWith('/')) continue;
    const relative = name.slice('lib/python3.14/'.length);
    if (relative.split('/').some(part => ['..', 'test', 'tests', '__pycache__', 'ensurepip', 'tkinter', 'idlelib', 'turtledemo'].includes(part))) continue;
    library[relative] = bytes;
  }
  const files = { 'python.wasm': entries['python.wasm'], 'python314.zip': zipSync(library, { level: 0 }), 'os.py': entries['lib/python3.14/os.py'], LICENSE: entries.LICENSE };
  await mkdir(root, { recursive: true });
  const manifest = { runtimeVersion: VERSION, source: URL, archiveSha256: ARCHIVE_HASH, distributor: 'brettcannon/cpython-wasi-build (not an official PSF binary)', files: {} };
  for (const [name, bytes] of Object.entries(files)) {
    if (!bytes?.length) throw new Error(`Archive missing ${name}`);
    await writeFile(`${root}/${name}`, bytes);
    manifest.files[name] = { size: bytes.length, sha256: digest(bytes) };
  }
  await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await checkRuntime();
  console.log(`Prepared verified CPython ${VERSION} WASI assets (${Object.keys(library).length} stdlib files, STORE-only ZIP).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await prepare();