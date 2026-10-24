# Real Python runs, tests, and fix checks

The **Run and test Python** section now runs real CPython **3.14.9 WASI** inside a fresh browser Web Worker. It detects actual syntax/runtime failures and compares actual outputs with explicitly chosen expectations. This does not call OpenAI, send source to an execution service, or execute Python inside FastAPI.

## Use it

1. Put your program in the existing editor.
2. Click **Check syntax** to compile it without executing program statements. Syntax/indentation errors include the real Python error and learner-code line.
3. Choose the appropriate execution mode:
   - **Script (stdin/stdout):** enter text in **Program input (stdin)** and click **Run Python**. Output, stderr/traceback, and exit code appear below. Use this for `input()`/`print()` programs, including an Armstrong-number script.
   - **Function (JSON arguments):** enter a simple function name and a JSON argument array, such as `is_prime` and `[9]`. The function's JSON-compatible return value is displayed. Tuples normalize to arrays. Large/unsafe integers, nonfinite numbers, sets, and other unsupported return values produce an explicit limitation instead of a false pass.
4. Add up to ten test cases. In script mode, specify stdin and expected stdout; in function mode, specify JSON argument arrays and expected JSON values. Select **Assert expected value** for each case, then click **Run tests**. An explicit empty output and an explicit JSON `null` are valid expectations; an unchecked expectation is not silently treated as a passing test.
5. Edit the code and rerun **the same assertions**. If a different source revision passes cases that previously failed, the panel reports those cases as fixed **for these inputs**. Changing inputs/expectations does not count as proving a code fix. A normal run without expectations is “completed,” not “passed.”
6. Click **Stop** to terminate current work. Code, input, task, or account changes invalidate old results and cancel pending execution; late completions cannot overwrite newer work.

## Updating Requirement coverage

The main coverage card now uses **actual browser test evidence**, not the old prime/parity reference-fixture calculation. Before evidence exists it says **Not tested**; correct-looking source is not scored zero merely because a fixture does not support that task.

1. Define each case's input and expected result, and enable its expected-value assertion.
2. Open **Requirements checked by case** and choose the requirements that case exercises. **Link all requirements** is an explicit convenience action if you want every case associated with every displayed requirement; review these associations rather than treating them as automatic semantic verification.
3. Click **Run tests**. Each requirement gets a passing label only if all its linked assertions passed. Failed assertions/execution failures appear as failing evidence; missing, unsupported, unlinked, or incomplete evidence stays untested. Unlinked tests are shown separately and do not secretly contribute to the requirement score.

The score reflects requirements with passing mapped tests / all requirements. It is evidence for the chosen inputs and user-defined expectations, not proof of the algorithm or of every possible input. Editing code or assertions clears stale green results; regenerating/resetting the task clears old associations. A later syntax-only or plain run does not award new coverage or erase stronger unchanged test evidence.

For the palindrome script in the editor, `input("Enter a string: ")` prints a prompt. Expected stdout must therefore include it: `racecar` expects `Enter a string: Palindrome`, while `hello` expects `Enter a string: Not a palindrome`. Supply a newline (`\n`) to test an empty string through `input()`; zero input bytes mean EOF, not an empty submitted line. Select case-sensitive/whitespace expectations according to the intended specification.

An AI-service **502** is not a verdict on the Python program. Local test execution and linked coverage work even while AI generation falls back to demo suggestions. Source, reports, and requirement links remain in memory rather than being uploaded to Supabase; execution does not unlock server-verified achievements. Reference-example history remains explicitly illustrative.

## Cinematic workspace entry

The root view now adds a lightweight mountain/trail and code-console welcome, matching the Code Sherpa theme. It appears once per tab session, auto-dismisses at 4.2 seconds, and offers **Enter workspace**, **Skip intro**, and Escape immediately. Reduced-motion preference skips it, including on `?intro=1` replay. Session-storage failure fails open rather than blocking learning.

Workspace children stay mounted behind an inert/hidden overlay, so authentication can initialize without resetting forms or source when the introduction closes. Keyboard focus is trapped only while active and restored on dismissal; body scrolling is restored on cleanup. No video, audio, external assets, provider calls, or fake connectivity checks are used. To preview again, open <http://127.0.0.1:5176/?intro=1> in a new tab rather than navigating away from unsaved code.

The **Verify coverage and cinematic entry** task runs a fresh-guest Edge smoke test: six actual palindrome cases, wrong/fixed revisions, stale-output invalidation, responsive links, entry/session/replay/keyboard behavior, and reduced motion. It synthesizes an AI-service failure and makes no paid provider call. Results and entry images: `verification/coverage-entry-browser.json`, `verification/cinematic-desktop.png`, `verification/cinematic-mobile.png`.

**Use suggested cases** imports only safely recognized literal inputs or JSON-compatible function calls; it never evaluates an AI-supplied expression. Function-style suggestions need Function mode and an actual matching function in your source. Unsupported/placeholder cases are skipped with an explicit count. Review assertions before running them. For scripts printing messages such as “Armstrong number,” define the exact expected printed text rather than assuming a Boolean reference result is the script's output.

Function mode executes definitions using a separate module name. Guard interactive CLI code with `if __name__ == '__main__':`, or choose script mode; unguarded top-level `input()` can otherwise exhaust supplied input and raise EOFError.

## Isolation and bounds

- CPython is WebAssembly with **only allowlisted WASI imports**. There is no Python-to-JavaScript bridge and no network/socket capability.
- The interpreter receives only its supplied source/arguments/stdin and a read-only virtual standard-library filesystem. Browser storage, application files, server environment variables, database credentials, OpenAI keys, native processes, and host disk access are not provided.
- Every case gets a new worker/VM/filesystem. At most one batch runs per tab. The main page terminates the worker on Stop, abort, or deadline.
- Maximums: **20,000 source characters**, **8 KiB UTF-8 stdin**, **8 KiB encoded JSON args/expectations**, **10 cases**, **3 seconds execution per case**, **30 seconds runtime initialization**, **60 seconds per batch**, **64 KiB combined output**, **256 MiB WASM linear memory**. JSON depth/node and function-identifier limits also apply.
- Initialization/compilation is distinct from learner execution timing. Browser scheduling can delay timer delivery; deadlines are not a real-time guarantee. JS/browser overhead is additional to the WASM memory cap.
- Writable files, network access, subprocesses, pip installation, desktop/GUI modules, and third-party native packages are unavailable. A genuine Python error may therefore identify a sandbox capability limitation rather than an algorithm mistake.
- Stdout comparison normalizes CRLF and terminal newlines only. Other whitespace matters. Function results use bounded JSON comparison, not arbitrary Python `eval` of input/expected values.

These are **local self-checks, not trusted server grades or proof for every possible input**. Expected answers can be wrong, and a malicious learner can manipulate their own client. The browser runner does not award server-verified achievements or upload source/results to Supabase. The existing verified-tests achievement remains locked for this reason. Execution reports/test drafts are in-memory, not cloud-saved projects. AI source sharing remains a separate explicit choice.

## Runtime setup and deployment

```powershell
npm.cmd ci
npm.cmd run prepare:python
npm.cmd test
npm.cmd run build
```

The current workspace is already prepared. `prepare:python` downloads one pinned, SHA-256-checked archive from Brett Cannon's CPython WASI builds (not an official PSF binary distribution), preserves the bundled license, and constructs a STORE-only standard-library ZIP. Runtime files and manifest live under `public/python-runtime` and are copied to `dist` by Vite. Large generated assets are ignored by Git; CI prepares them explicitly. Do not deploy a build missing these files or its worker chunk.

Pinned archive:

```text
https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.14.9/python-3.14.9-wasi_sdk-24.zip
SHA-256: 8de7834105edef8db8a13299e2587cf8945021dd8764f2691d83bbc25129dfa2
```

The current assets total about **41 MB before HTTP compression**, fetched lazily on first use. Configure HTTPS, static-file compression and coherent cache invalidation; slow downloads can hit the initialization deadline. A missing/changed asset fails checksum checks rather than becoming a fake successful run. Keep the interpreter/shim patched and revalidate after runtime updates. Preserve `public/python-runtime/LICENSE` in redistribution.

Workers, WebAssembly, Web Crypto, and `crypto.randomUUID` must be available (use HTTPS or localhost). This implementation prebuffers stdin and does **not** require SharedArrayBuffer or cross-origin-isolation headers. Production CSP must permit the trusted module worker and WASM compilation. Do not relax JavaScript execution restrictions merely to permit learner Python.

The backend `/api/execute` remains fail-closed with HTTP 503. Backend/AI metadata saying `code_execution: disabled` refers to **server/provider execution**, not this separate browser capability.

## Verification

`npm test` includes mounted UI/client tests and **real CPython WASM tests in isolated Node workers**, never native Python execution of learner programs. Coverage includes syntax/indentation, runtime exceptions/lines, stdin/stdout, mismatches, prime fail/fix, JSON functions, no JS/socket/host-file/secret access, read-only filesystem, output/memory limits, fresh VM state, termination, and empty-write capture bounds.

The optional VS Code task **Verify browser Python execution UI** runs `node scripts/verify-execution-browser.mjs` with a fresh, cookie-free browser context. It verifies real browser execution, failing/fixed inputs, timeout/Stop, and layout widths 1440/768/390/320. It blocks external and learning-model requests. On this machine it passed in headless Edge with zero such requests. Safe results and desktop/mobile screenshots are in `verification/`.

The redesigned UI uses consistent system typography, dark cards, accessible status colors/focus, minimum-size controls, clear primary/secondary execution actions, and bounded terminal overflow. Automated layout checks and screenshots do not constitute full accessibility or security certification. Public deployment, account lifecycle, operations, and independent sandbox/security review remain production-release work.