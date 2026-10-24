import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { checkRuntime } from '../scripts/prepare-python-runtime.mjs';
import { limitMemory } from '../src/execution/memory.ts';
import { normalizeOutput, sha256, stable, validateRequest } from '../src/execution/validation.ts';

try { await checkRuntime(); } catch (error) { throw new Error(`Real WASM tests require runtime assets. Run npm run prepare:python. ${error.message}`); }

function execute(source, entry = { id: 'case' }, options = {}) {
  return new Promise((resolve, reject) => {
    const request = { source, operation: 'run', mode: 'script', ...options, cases: [entry] };
    const worker = new Worker(new URL('./helpers/pythonWasmWorker.mjs', import.meta.url), { workerData: request });
    let timer = setTimeout(() => finish(null, new Error('WASM load timeout')), 30000);
    let ended = false;
    const finish = (value, error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    worker.on('error', error => finish(null, error));
    worker.on('message', message => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish({ status: 'timeout' }), options.timeout ?? 3000);
      } else if (message.type === 'result') finish(message.result);
      else if (message.type === 'error') finish(null, new Error(message.message));
    });
  });
}
function status(result, expected) { assert.equal(result.status, expected, JSON.stringify(result)); }

test('REAL WASM interpreter boots, built-in math and JSON work', async () => {
  const result = await execute('import sys, math, json\nprint(sys.version.split()[0])\nprint(json.dumps(math.isqrt(81)))');
  status(result, 'completed');
  assert.equal(result.stdout, '3.14.9\n9\n');
});
test('Armstrong stdin cases include zero and preserve spaces', async () => {
  const source = "n=int(input())\nprint(sum(int(d)**len(str(n)) for d in str(n)) == n)";
  for (const stdin of ['0', '153', '9474']) status(await execute(source, { id: stdin, stdin, expected: 'True' }, { operation: 'test' }), 'passed');
  status(await execute("print(' x ')", { id: 'spaces', expected: 'x' }), 'failed');
});
test('syntax error and indentation error retain genuine learner lines', async () => {
  for (const source of ['x =\n', 'if True:\nprint(1)']) {
    const result = await execute(source, { id: 'syntax' }, { operation: 'syntax' });
    status(result, 'syntax_error');
    assert.ok(result.error.line >= 1);
  }
});
test('compile-only never executes raising code', async () => status(await execute("raise RuntimeError('not executed')", { id: 'syntax' }, { operation: 'syntax' }), 'completed'));
test('runtime errors include genuine exception types and lines', async () => {
  for (const [source, type] of [['print(1/0)', 'ZeroDivisionError'], ['print(missing)', 'NameError'], ["raise Exception('example')", 'Exception'], ['raise KeyboardInterrupt()', 'KeyboardInterrupt']]) {
    const result = await execute(source);
    status(result, 'runtime_error');
    assert.equal(result.error.type, type);
    assert.equal(result.error.line, 1);
  }
  const name = 'Long'.repeat(40) + 'Error';
  const bounded = await execute(`class ${name}(Exception): pass\nraise ${name}('example')`);
  status(bounded, 'runtime_error');
  assert.equal(bounded.error.type, name.slice(0, 128));
});
test('buggy prime 9 fails and corrected identical case passes', async () => {
  const options = { operation: 'test', mode: 'function', functionName: 'prime' };
  const entry = { id: 'nine', args: [9], expected: false };
  status(await execute('def prime(n):\n return n > 1', entry, options), 'failed');
  status(await execute('def prime(n):\n return n > 1 and all(n%d for d in range(2, int(n**0.5)+1))', entry, options), 'passed');
});
test('JSON arguments, null expectations, tuples and object ordering', async () => {
  const options = { operation: 'test', mode: 'function', functionName: 'echo' };
  status(await execute('def echo(x): return x', { id: 'null', args: [null], expected: null }, options), 'passed');
  status(await execute('def echo(): return (1, 2)', { id: 'tuple', expected: [1, 2] }, options), 'passed');
  status(await execute("def echo(): return {'b':2,'a':1}", { id: 'object', expected: { a: 1, b: 2 } }, options), 'passed');
});
test('unsupported returns reject non-JSON, nonfinite, unsafe and deep values', async () => {
  for (const expression of ['{1,2}', "float('nan')", '2**60', "'x'*9000"]) status(await execute(`def value(): return ${expression}`, { id: 'unsupported' }, { mode: 'function', functionName: 'value' }), 'unsupported');
  const deep = 'def value():\n x=[]\n for _ in range(40): x=[x]\n return x';
  status(await execute(deep, { id: 'deep' }, { mode: 'function', functionName: 'value' }), 'unsupported');
});
test('JS bridge, sockets and application files are inaccessible', async () => {
  for (const source of ["import js", "import socket\nsocket.socket().connect(('example.com',443))", "open('/.env')", "open('/src/App.tsx')"]) status(await execute(source), 'runtime_error');
  const result = await execute("import os\nprint(sorted(os.environ))\nprint(os.environ.get('OPENAI_API_KEY'))");
  status(result, 'completed');
  assert.equal(result.stdout, "['PYTHONHOME', 'PYTHONIOENCODING', 'PYTHONPATH', 'PYTHON_COLORS']\nNone\n");
});
test('filesystem denies creation, truncation, append, mutation and descriptor writes', async () => {
  for (const source of ["open('/new', 'w')", "open('/main.py', 'w')", "open('/main.py', 'a')", "import os\nos.mkdir('/new')", "import os\nos.unlink('/main.py')", "import os\nos.truncate('/main.py',0)"]) status(await execute(source), 'runtime_error');
});
test('stdin in function top-level is supplied or fails explicitly at EOF', async () => {
  const source = 'x=input()\ndef answer(): return x';
  status(await execute(source, { id: 'eof' }, { mode: 'function', functionName: 'answer' }), 'runtime_error');
  status(await execute(source, { id: 'input', stdin: 'hello', expected: 'hello' }, { mode: 'function', functionName: 'answer' }), 'passed');
});
test('fresh virtual filesystem and VM have no case state leak', async () => {
  const source = 'import builtins\nprint(hasattr(builtins, "previous"))\nbuiltins.previous=True';
  for (let index = 0; index < 2; index++) {
    const result = await execute(source);
    status(result, 'completed');
    assert.equal(result.stdout, 'False\n');
  }
});
test('output flood is bounded to 64 KiB combined', async () => {
  const result = await execute("while True: print('x'*1000)");
  status(result, 'output_limit');
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 65536);
});
test('invalid UTF-8 and combined stdout/stderr remain within the text output cap', async () => {
  for (const source of ["import os\nos.write(1,b'\\xff'*30000)", "import os\nos.write(1,b'x'*40000)\nos.write(2,b'y'*40000)"]) {
    const result = await execute(source);
    status(result, 'output_limit');
    assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= 65536);
  }
});
test('linear memory cannot grow beyond 256 MiB', async () => status(await execute("x=bytearray(300*1024*1024)"), 'memory_limit'));
test('infinite learner loop is terminated by parent worker deadline', async () => status(await execute('while True: pass', { id: 'loop' }, { timeout: 500 }), 'timeout'));
test('memory patch rejects unexpected, shared and excessive initial memory', () => {
  const header = [0,97,115,109,1,0,0,0];
  for (const section of [[5,3,1,2,1], [5,5,1,1,129,32,0], [5,3,2,0,1]]) assert.throws(() => limitMemory(new Uint8Array([...header, ...section])));
  const module = new WebAssembly.Module(limitMemory(new Uint8Array([...header,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0])));
  const instance = new WebAssembly.Instance(module);
  assert.throws(() => instance.exports.memory.grow(4096), RangeError);
});
test('request limits and output normalization are strict; stable suites exclude source', async () => {
  const base = { source: '', operation: 'test', mode: 'function', functionName: 'f', cases: [{ id: 'a', expected: null }] };
  validateRequest(base);
  for (const change of [{ source: 'x'.repeat(20001) }, { cases: Array.from({ length: 11 }, (_, index) => ({ id: String(index), expected: null })) }, { cases: [{ id: 'a' }] }, { cases: [{ id: 'a', expected: Infinity }] }, { cases: [{ id: 'a', stdin: 'x'.repeat(8193), expected: null }] }, { functionName: 'f();evil' }, { functionName: ['f'] }, { functionName: 'f'.repeat(129) }]) assert.throws(() => validateRequest({ ...base, ...change }));
  assert.equal(normalizeOutput(' a \r\n\n'), ' a ');
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(stable({ b: 2, a: 1 }), stable({ a: 1, b: 2 }));
});

test('repeated empty writes preserve bounded capture and later stdout', async () => {
  const result = await execute("import os\nfor _ in range(20000): os.write(1,b'')\nprint('done')");
  status(result, 'completed');
  assert.equal(result.stdout, 'done\n');
});