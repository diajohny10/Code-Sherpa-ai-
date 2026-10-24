import { WASI, File, OpenFile, Directory, PreopenDirectory, ConsoleStdout } from '@bjorn3/browser_wasi_shim';
import { limitMemory } from './memory.ts';
import { hasOwn, normalizeOutput, stable, validateJSON, validateRequest } from './validation.ts';
import type { JSONValue, PythonCaseResult, PythonExecutionRequest, PythonTestCase } from './types.ts';

export interface RuntimeAssets { wasm: Uint8Array; stdlib: Uint8Array; os: Uint8Array }
export const RUNTIME_VERSION = '3.14.9';
const encoder = new TextEncoder();
const OUTPUT_LIMIT = 65536;
const allowed = new Set(('args_get args_sizes_get environ_get environ_sizes_get clock_res_get clock_time_get fd_advise fd_allocate fd_close fd_datasync fd_fdstat_get fd_fdstat_set_flags fd_fdstat_set_rights fd_filestat_get fd_filestat_set_size fd_filestat_set_times fd_pread fd_prestat_get fd_prestat_dir_name fd_pwrite fd_read fd_readdir fd_renumber fd_seek fd_sync fd_tell fd_write path_create_directory path_filestat_get path_filestat_set_times path_link path_open path_readlink path_remove_directory path_rename path_symlink path_unlink_file poll_oneoff proc_exit proc_raise sched_yield random_get sock_accept sock_recv sock_send sock_shutdown').split(' '));
const denied = new Set(('fd_allocate fd_datasync fd_fdstat_set_flags fd_fdstat_set_rights fd_filestat_set_size fd_filestat_set_times fd_pwrite fd_renumber fd_sync path_create_directory path_filestat_set_times path_link path_remove_directory path_rename path_symlink path_unlink_file proc_raise').split(' '));

function driver(request: PythonExecutionRequest, nonce: string): string {
  if (request.operation === 'syntax') return "compile(open('/main.py').read(), '/main.py', 'exec')\n";
  if (request.mode === 'script') return "import runpy\nrunpy.run_path('/main.py', run_name='__main__')\n";
  return [
    'import json, runpy, math',
    'def _check(value, depth=0, budget=None):',
    '    if budget is None: budget = [10000]',
    '    budget[0] -= 1',
    "    if depth > 32 or budget[0] < 0: raise TypeError('Return JSON limit exceeded')",
    '    if value is None or type(value) in (str, bool): return value',
    '    if type(value) is int and abs(value) <= 9007199254740991: return value',
    '    if type(value) is float and math.isfinite(value) and (not value.is_integer() or abs(value) <= 9007199254740991): return value',
    '    if type(value) in (list, tuple): return [_check(item, depth+1, budget) for item in value]',
    '    if type(value) is dict and all(type(key) is str for key in value): return {key:_check(item, depth+1, budget) for key,item in value.items()}',
    "    raise TypeError('Return value is not supported JSON')",
    "_scope = runpy.run_path('/main.py', run_name='__learner__')",
    "_args = json.loads(open('/args.json').read())",
    `_value = _scope[${JSON.stringify(request.functionName)}](*_args)`,
    'try:',
    "    _encoded = json.dumps(_check(_value), allow_nan=False, separators=(',', ':'))",
    "    if len(_encoded.encode('utf-8')) > 8192: raise TypeError('Return JSON exceeds 8192 bytes')",
    'except (TypeError, ValueError, RecursionError) as _error:',
    `    print(${JSON.stringify(nonce + 'unsupported:')} + str(_error))`,
    'else:',
    `    print(${JSON.stringify(nonce)} + _encoded)`,
    '',
  ].join('\n');
}

export async function executePythonCase(assets: RuntimeAssets, request: PythonExecutionRequest, entry: PythonTestCase, onReady?: () => void): Promise<PythonCaseResult> {
  validateRequest({ ...request, cases: [entry] });
  const started = performance.now();
  const result: PythonCaseResult = { id: entry.id, status: 'engine_error', stdout: '', stderr: '', exitCode: null, durationMs: 0 };
  const nonce = '__SHERPA_' + crypto.randomUUID().replace(/-/g, '') + ':';
  // Fixed-capacity captures also bound JS allocations when a program makes
  // arbitrarily many empty writes (which do not consume the byte quota).
  const stdout = { data: new Uint8Array(OUTPUT_LIMIT), length: 0 };
  const stderr = { data: new Uint8Array(OUTPUT_LIMIT), length: 0 };
  let outputBytes = 0;
  try {
    const module = await WebAssembly.compile(limitMemory(assets.wasm));
    for (const item of WebAssembly.Module.imports(module)) if (item.module !== 'wasi_snapshot_preview1' || item.kind !== 'function' || !allowed.has(item.name)) throw new Error(`Forbidden WASM import: ${item.module}.${item.name}`);
    const file = (bytes: Uint8Array | string) => new File(typeof bytes === 'string' ? encoder.encode(bytes) : bytes, { readonly: true });
    const contents = new Map([
      ['main.py', file(request.source)], ['driver.py', file(driver(request, nonce))],
      ['args.json', file(JSON.stringify(entry.args ?? []))],
      ['lib', new Directory(new Map<string, File | Directory>([
        ['python314.zip', file(assets.stdlib)],
        ['python3.14', new Directory(new Map<string, File | Directory>([['os.py', file(assets.os)], ['lib-dynload', new Directory([])]]))],
      ]))],
    ] as [string, File | Directory][]);
    const wasi = new WASI(['python', '-S', '-B', '-u', '/driver.py'], ['PYTHONHOME=/', 'PYTHONPATH=/lib/python314.zip:/lib/python3.14', 'PYTHONIOENCODING=utf-8', 'PYTHON_COLORS=0'], [new OpenFile(file(entry.stdin ?? '')), new ConsoleStdout(() => {}), new ConsoleStdout(() => {}), new PreopenDirectory('/', contents)], { debug: false });
    const imports = { ...wasi.wasiImport };
    for (const name of allowed) {
      if (denied.has(name) || name.startsWith('sock_')) imports[name] = () => 76;
      else if (!imports[name]) imports[name] = () => 52;
    }
    const originalOpen = imports.path_open;
    imports.path_open = (...args: unknown[]) => {
      const flags = Number(args[4]);
      const rights = BigInt(args[5] as bigint);
      if ((flags & (1 | 4 | 8)) || (rights & ((1n << 6n) | (1n << 8n) | (1n << 22n) | (1n << 23n)))) return 76;
      return originalOpen(...args);
    };
    let instance: WebAssembly.Instance;
    imports.fd_write = (descriptor: number, vectors: number, count: number, written: number) => {
      if (descriptor !== 1 && descriptor !== 2) return 76;
      const memory = (instance.exports.memory as WebAssembly.Memory).buffer;
      const pointer = vectors >>> 0;
      const length = count >>> 0;
      const destination = written >>> 0;
      if (length > 1024 || pointer + length * 8 > memory.byteLength || destination + 4 > memory.byteLength) return 21;
      const view = new DataView(memory);
      let size = 0;
      for (let index = 0; index < length; index++) {
        const offset = view.getUint32(pointer + index * 8, true);
        const bytes = view.getUint32(pointer + index * 8 + 4, true);
        if (offset + bytes > memory.byteLength) return 21;
        size += bytes;
        if (outputBytes + size > OUTPUT_LIMIT) throw new Error('SHERPA_OUTPUT_LIMIT');
      }
      for (let index = 0; index < length; index++) {
        const offset = view.getUint32(pointer + index * 8, true);
        const bytes = view.getUint32(pointer + index * 8 + 4, true);
        if (bytes) {
          const capture = descriptor === 1 ? stdout : stderr;
          capture.data.set(new Uint8Array(memory, offset, bytes), capture.length);
          capture.length += bytes;
        }
      }
      outputBytes += size;
      view.setUint32(destination, size, true);
      return 0;
    };
    instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: imports });
    onReady?.();
    result.exitCode = wasi.start(instance as unknown as Parameters<WASI['start']>[0]);
    result.status = result.exitCode === 0 ? 'completed' : 'runtime_error';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.status = message === 'SHERPA_OUTPUT_LIMIT' ? 'output_limit' : /memory|out of bounds/i.test(message) ? 'memory_limit' : 'engine_error';
    result.error = { type: result.status, message: message === 'SHERPA_OUTPUT_LIMIT' ? 'Combined stdout/stderr exceeds 64 KiB' : message };
  }
  let remainingOutput = OUTPUT_LIMIT;
  const decode = (capture: { data: Uint8Array; length: number }) => {
    const bytes = capture.data.subarray(0, capture.length);
    const text = new TextDecoder().decode(bytes);
    const utf8 = encoder.encode(text);
    if (utf8.length <= remainingOutput) { remainingOutput -= utf8.length; return text; }
    let end = remainingOutput;
    while (end > 0 && (utf8[end] & 192) === 128) end--;
    remainingOutput -= end;
    result.status = 'output_limit';
    result.error = { type: 'output_limit', message: 'Decoded stdout/stderr exceeds 64 KiB' };
    return new TextDecoder().decode(utf8.subarray(0, end));
  };
  result.stdout = decode(stdout);
  result.stderr = decode(stderr);
  if (result.status === 'runtime_error') {
    const plainError = result.stderr.replace(/\x1b\[[0-9;]*m/g, '');
    const matches = plainError.match(/(?:^|\n)(\w*(?:Error|Exception)|KeyboardInterrupt|GeneratorExit|StopIteration)(?::[^\n]*)?(?=\n|$)/g) ?? [];
    const match = matches[matches.length - 1]?.trim();
    const lines = [...plainError.matchAll(/File "\/main.py", line (\d+)/g)];
    const line = lines[lines.length - 1]?.[1];
    const type = match?.split(':')[0] ?? 'PythonError';
    result.error = { type: type.slice(0, 128), message: match ?? result.stderr.slice(-2048), ...(line ? { line: Number(line) } : {}) };
    if (/SyntaxError|IndentationError|TabError/.test(type)) result.status = 'syntax_error';
    if (/MemoryError/.test(type)) result.status = 'memory_limit';
  }
  if (result.status === 'completed' && request.mode === 'function' && request.operation !== 'syntax') {
    const marker = result.stdout.lastIndexOf(nonce);
    if (marker < 0) { result.status = 'unsupported'; result.error = { type: 'UnsupportedReturn', message: 'Function did not produce a JSON result' }; }
    else {
      const encoded = result.stdout.slice(marker + nonce.length).trimEnd();
      result.stdout = result.stdout.slice(0, marker);
      try {
        if (encoder.encode(encoded).length > 8192) throw new Error('Return JSON exceeds 8192 bytes');
        const actual: unknown = JSON.parse(encoded);
        validateJSON(actual);
        result.actual = actual;
      } catch { result.status = 'unsupported'; result.error = { type: 'UnsupportedReturn', message: 'Return value is not bounded JSON' }; }
    }
  }
  if (result.status === 'completed' && hasOwn(entry, 'expected') && request.operation !== 'syntax') {
    const actual: JSONValue | undefined = request.mode === 'script' ? normalizeOutput(result.stdout) : result.actual;
    if (request.mode === 'script') result.actual = actual;
    result.status = request.mode === 'script' ? actual === normalizeOutput(entry.expected as string) ? 'passed' : 'failed' : stable(actual) === stable(entry.expected) ? 'passed' : 'failed';
  }
  result.durationMs = performance.now() - started;
  return result;
}