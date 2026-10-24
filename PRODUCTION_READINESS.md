# Production readiness verification

Assessment date: 2026-10-24

## Verdict: NO-GO for public production release

The application now includes **real browser-only Python execution**, a refined professional dark UI, and connected, staging-verified Supabase accounts. Local execution/error/test/fix workflows and responsive browser layout are verified. Public production readiness remains open for deployed HTTPS/operations, production account workflows, account lifecycle, and independent security review. Local Docker is not required.

This is a local source and runtime assessment, not a penetration-test certification or verification of a deployed environment. Initial findings are retained below for traceability. Subsequent work changed source, added PostgreSQL/account dependencies and migrations, and upgraded frontend development tooling. No paid AI calls were made.

## Current verification: Python execution and professional UI (2026-10-24)

### Follow-up: live coverage and cinematic entry

- The primary requirement panel now consumes **current actual execution evidence**, rather than a fixture-only memo unrelated to source. It displays “Not tested” before usable linked assertions exist, counts only explicitly mapped assertions, warns about unlinked tests, and keeps illustrative reference scores separate. Source/task/assertion changes invalidate stale evidence; syntax-only/unasserted runs cannot manufacture passes. Results/links remain client-local and are not trusted grades.
- The runner exposes per-case requirement links and a bulk-link convenience action. Local palindrome wording now supports returned or printed classifications; source correctness is not judged by AI/provider failures. Real stdout comparisons include printed `input()` prompts.
- Added a 4.2-second, once-per-tab-session project-themed cinematic welcome: SVG summit/trail, code-console reveal, immediate Enter/Skip/Escape, focus/inert/scroll cleanup, reduced-motion bypass, and explicit `?intro=1` replay. It preserves mounted workspace state and does not call providers or pretend to validate backend readiness.
- A real guest Edge browser test passed six palindrome inputs, unlinked-versus-linked coverage, wrong/fixed revisions, stale expected-output invalidation, responsive widths, keyboard skip, replay auto-dismissal, and reduced motion. External requests: zero. One provider request was intercepted with a synthetic 502; no live model request was made. Evidence: `verification/coverage-entry-browser.json` and the cinematic desktop/mobile captures.
- This is still scoped evidence, not semantic proof of arbitrary requirements or public deployment certification. Existing account-lifecycle, hosting/security/operations gates remain.

Latest follow-up results: **248 frontend/runtime tests passed** (53 helpers, 176 mounted/client/coverage/entry tests, 19 real-WASM tests), with zero failures/skips. Production build and asset checks passed; npm audit reports zero vulnerabilities. The Edge coverage/entry scenario passed all 14 checks, including a synthetic AI-service failure, with zero external requests. Backend source/DB schema were not changed or retested for this frontend follow-up; older totals below are retained as historical verification stages.

### Implemented

- **Check syntax** compiles real CPython 3.14.9 WASI source without executing program statements. **Run Python** displays actual stdin/stdout, stderr/tracebacks, exit code, and error type/learner line. **Run tests** compares actual script output or JSON function return values against explicitly chosen expectations.
- Editing code and rerunning identical assertions can confirm previously failing cases now pass **for those inputs**. Changed expectations/suites do not count as proof of a fix. Runs without assertions are completed, not passed. Old results are invalidated/cancelled on source/input/task/account changes.
- Fresh Web Worker/VM/read-only virtual filesystem per case; no JS bridge, sockets, subprocesses, host/application files, or supplied server secrets. The browser runner never calls FastAPI execution or OpenAI. FastAPI `/api/execute` still fails closed.
- Limits: 20,000 source characters, 8 KiB stdin/JSON inputs, ten cases, three seconds per execution, thirty seconds initialization, sixty seconds per batch, 64 KiB combined output, and 256 MiB WASM linear memory. JS/browser overhead is additional. Zero-byte output writes use fixed-capacity captures; identifiers/JSON/error summaries are bounded.
- Pinned SHA-256-checked CPython WASI assets are self-hosted, license-preserved, and checked before builds. First use fetches about 41 MB before HTTP compression. CI now prepares these generated assets. No SharedArrayBuffer/cross-origin-isolation headers are required.
- Professional styling adds consistent system typography, compact navigation/hero, dark account controls, primary/secondary/danger execution actions, case cards, status badges, readable terminal panels, rounded durations, focus states, and mobile stacking. External Google Fonts requests were removed.

### Verification

| Check | Result |
| --- | --- |
| Frontend helper tests | 53 passed |
| Mounted UI/client tests | 132 passed |
| Real CPython WASM tests | 19 passed (not native Python or mocked execution) |
| Backend regressions | 111 passed; 3 hosted DB tests not rerun in the offline/no-paid-call suite |
| Total in this update | **315 passed, 3 skipped, no failures** |
| Asset-checked production build | Passed; dedicated worker emitted |
| npm audit | Zero reported vulnerabilities, including patched fflate 0.8.3 |
| Real headless Edge smoke | Passed syntax line, runtime exception, stdin/stdout, fail-then-fixed tests, timeout, Stop/rerun |
| Layout widths | No page overflow at 1440, 768, 390, 320 px |
| Execution browser traffic | Zero external requests and zero learning/OpenAI requests |

Browser evidence: `verification/browser-execution.json`, `verification/ui-1440.png`, `verification/ui-390.png`. Runtime/unit tests cover no JS/socket/secret/host-file access, read-only files, VM reset, compile-only behavior, output/memory/timeout limits, cancellation, and unsafe inputs. Previously passed hosted Supabase tests below were not rerun for this frontend feature.

**Limits of the claim:** these are local self-checks, not server-attested grades or proof for every possible input. Browser source/results are not cloud-saved; server-verified achievements remain locked. Standard-library-only WASI cannot provide arbitrary native packages, writable files, or networking. A trusted browser/WASM engine and ongoing runtime/shim updates are assumed; this is not a formal sandbox/security certification. The account/HTTPS/monitoring/backup/restore/shared-quota/deployment gates below remain. See `PYTHON_EXECUTION.md` for setup and usage.

## Previous verification: connected Supabase staging (2026-10-24)

**OpenAI/test-case follow-up:** added a guarded source-aware `POST /api/learning/test-cases`, a no-cost/no-store `GET /api/ai/status`, and UI generation/source-sharing consent with visible test-case feedback. Changed prompts refresh cases without erasing the editor; generic demo placeholders no longer discard known local reference examples. Responses API requests disable persistence with `store: false` (not a zero-retention guarantee). New functionality retains existing body/schema/rate/concurrency/deadline/budget controls and does not execute Python. Setup is in `OPENAI_SETUP.md`; a separate opt-in preview task is available, while the ordinary preview task still forces AI off.

Latest follow-up verification: **133 frontend tests passed; 111 backend tests passed; 3 hosted database tests skipped in this offline/no-paid-call run; build passed and diagnostics are clear.** The prior live Supabase verification below remains historical evidence, not a claim these three tests reran in this update. OpenAI was mocked; no real key was read/activated, no paid request was made, and live key/billing/model-quality verification remains pending. These changes do not remove the remaining public-release gates.

The user configured `.env`, supplied the public Supabase CA certificate, and explicitly approved temporary-account testing in this new/staging project. Credentials were loaded and updated privately, never printed or included in reports.

### Completed and verified

- Corrected reserved-character URI encoding in the private database URL and added early rejection/regression coverage for ambiguous URLs. Verified TLS with hostname/certificate checks and the user-provided CA; no certificate verification was bypassed. Public CA copy: `certs/supabase-ca.crt`.
- Applied migrations **001 and 002** to the hosted project, then reran to confirm checksum/idempotent behavior. Three account tables live in `sherpa_private`; all four application/ledger tables have RLS. Effective Supabase API-role access was denied in live tests.
- Created and verified the dedicated, restricted `sherpa_backend` runtime role. Migration-owner credentials remain separate. Runtime has no RLS bypass, schema creation, ledger read, account deletion, or membership in other roles. Generated runtime credentials were saved only to the ignored private `.env`.
- **97/97 backend tests passed**, including all **3 live Supabase integration tests**, with zero skips/failures/errors. **103/103 frontend tests passed. Total: 200 passed, zero skipped.** Production build passed after the development proxy update; editor checks are clean.
- An additional hosted smoke test passed through the **restricted runtime role**: registration, persistent progress, CAS conflicts, user isolation, CSRF enforcement, login/session rotation, logout revocation, and session expiry. All temporary and other staging test accounts were confirmed removed.
- Running local backend health/session and frontend/proxied-session HTTP checks returned **200**; account endpoints report database access enabled. Existing port 8000 was not replaced. Connected preview: <http://127.0.0.1:5176/>; backend: `127.0.0.1:18000`.

Safe, credential-free records: `verification/backend-all.json`, `verification/hosted-smoke.json`, `verification/runtime-role.json`, and `verification/preview-http.json`. Reusable VS Code tasks and `backend.verify_hosted`/`backend.configure_runtime`/`backend.check_preview` support repeat verification. Staging checks must not run against real-user production data.

### Still not a public production release

- The local application is connected to hosted Supabase; neither the frontend nor FastAPI has been deployed to a public HTTPS origin. The local-preview task deliberately uses loopback-only origins and HTTP cookie settings without changing production `.env` settings. Production requires verified HTTPS, Secure cookies, correct ingress/origin/proxy trust, secret injection, and target-platform dependency validation.
- Integrated-browser navigation to the new preview timed out in this session, although server-side HTTP and proxied API checks passed. Real browser registration/cookie/progress workflows on the eventual deployment still require end-to-end verification.
- Email ownership verification, recovery/reset, deletion/privacy handling, applicable MFA, monitoring/alerts, backup/restore exercises, rollback/load testing, Python advisory scanning, and actual CI execution remain release gates.
- In-memory quotas still reset on restart and multiply across processes; shared/durable admission and spending controls are needed where applicable. Optional paid learning requests are not yet account-gated and still require explicit backend/UI permission. Server-side learner execution remains disabled; the newer browser WASI feature is verified above.

**Verdict remains NO-GO for public production, but Supabase connection, migration, restricted-role account behavior, and hosted tests are no longer blockers.** The following sections preserve earlier implementation-stage evidence and resolved blockers for traceability.

## Supabase adaptation stage (historical, before private configuration)

- Supabase PostgreSQL is the chosen hosted database target; the existing FastAPI Argon2/cookie authentication remains. This is **not** a Supabase Auth migration and does not automatically supply email verification/recovery.
- Remote connections require certificate- and hostname-verified TLS. Optional additional root trust uses `SHERPA_DATABASE_CA_FILE`; unsupported DSN certificate/CRL/client-key options are rejected. Asyncpg statement caching is disabled for pooler compatibility.
- The migrator supports separate `SHERPA_MIGRATION_DATABASE_URL` owner credentials and pins its schema regardless of the connection's ambient search path. Migration 001 remains unchanged; migration 002 moves account tables in place into `sherpa_private`, enables RLS, and revokes PUBLIC/Supabase API-role access. Runtime SQL explicitly qualifies private tables. An optional one-time, fail-closed least-privilege server-role bootstrap is provided.
- `.env.supabase.example`, `scripts/configure-supabase.ps1`, and [SUPABASE_SETUP.md](SUPABASE_SETUP.md) document hidden-input/private configuration, session-pooler/direct connections, migrations, backend hosting, and staging verification without local Docker.
- Hosted staging tests support an explicitly acknowledged isolated Supabase project whose database is named `postgres`. They verify private-schema/RLS/effective API-role isolation as well as account/session/progress behavior. Cleanup does not prune unrelated staging sessions.

**Current verification:** 93 backend tests passed, 3 hosted database tests skipped; 103 frontend tests passed; build and Python compilation passed; no editor errors reported. Total: **196 passed, 3 skipped**. Live TLS, SQL migration execution, role bootstrap, and Supabase account round-trips remain unverified.

**Previous blocker, now resolved:** private project configuration was originally missing. It is now configured, migrated, and staging-verified as recorded above. Supabase hosts PostgreSQL; the React build and FastAPI process still require their own public hosting/HTTPS ingress.

**Remaining release gates:** complete hosted staging verification, validate runtime-role effective privileges, deploy and verify HTTPS/origins/proxies/secrets, backups/restores, monitoring/rollback, account verification/recovery/deletion, dependency scans, and shared/durable quotas where required. Production stays NO-GO; paid AI and learner-code execution remain disabled by default. Previous local-Docker notes below are historical, not prerequisites for the Supabase path.

## Latest follow-up: frontend fixes, PostgreSQL, and authentication (2026-10-24)

### Implemented

- Progress updates use current-state functional updates; persistence runs separately from React state updaters. Delayed responses cannot erase newer progress, and resets/plan/account changes invalidate old work.
- Coverage work is bounded and cached, computed with memoization; unsupported numeric magnitudes remain UNTESTED instead of triggering expensive trial division. Fixed static source checks are separate from provider requirement order.
- Active-plan prompts and hint provenance remain attached to their results. Fetch and response-body deadlines, cancellation, render error recovery, feedback announcements, and keyboard-focus navigation were added. Inert/sample controls and fabricated streak/profile claims were removed; verified-execution achievements remain locked.
- PostgreSQL persistence uses `asyncpg` with a bounded connection pool, parameterized queries, explicit transactional checksum-verified migrations, account-owned progress, and optimistic revision checks. Stale writes return 409.
- Email/password registration, sign-in, logout, Argon2id password hashing, hash-only session-token storage, seven-day rotating/revocable sessions, HttpOnly cookies, explicit Origin/CSRF checks, no-store responses, and bounded authentication work/rates are implemented.
- The account UI hydrates server progress before mounting, separates guest localStorage from signed-in database progress, serializes writes, pauses on conflicts/expired sessions, and never persists passwords or session tokens in localStorage. Offline guest mode remains usable; signed-in failed writes never silently fall back to guest storage.
- Session pruning is explicit and bounded to 1,000 expired rows per maintenance invocation, not global cleanup in a sign-in transaction. Timestamp validation matches browser-compatible ISO formats.
- Vite/React tooling was upgraded; the current full npm audit reports zero vulnerabilities. A tested Python version snapshot, local PostgreSQL Compose configuration, private environment templates/setup scripts, and a CI workflow with a dedicated PostgreSQL service were added.

### Verification at the frontend/account implementation stage (historical)

| Check | Result |
| --- | --- |
| Frontend helper tests | 45 passed |
| Mounted React/account/lifecycle tests | 58 passed |
| Backend security/accounts/provider tests | 83 passed, including real Argon2 hashing |
| Live PostgreSQL integration tests | **2 skipped: no test database available** |
| Total | **186 passed, 2 skipped, no failures** |
| Production build / Python compilation | Passed |
| npm audit / pip dependency consistency | Zero npm vulnerabilities / no broken Python requirements |
| Compose syntax | Validated without contacting the unavailable engine |
| Editor diagnostics | No errors reported |

**Historical environment blocker:** Docker's executable existed, but its daemon was unavailable. The selected path has since changed to Supabase and no longer requires local Docker. Hosted connection credentials and the three database tests are now the pending verification; see `SUPABASE_SETUP.md`. CI was written but has not been executed in this session.

### Remaining release gates

- Run the real PostgreSQL tests and deployed end-to-end account workflows; validate the dependency lock on the target platform and scan Python advisories.
- Verify TLS/Secure cookies, exact trusted origins/proxies, least-privilege database access, secret injection, restart/health behavior, backups/restores, monitoring, and rollback in staging.
- Define and implement the account lifecycle required for public release: email ownership verification, password recovery, deletion/privacy handling, and applicable MFA. Duplicate registration currently reveals email existence via 409.
- In-memory API/auth quotas remain per process and reset on restart; multi-worker/replica or durable monetary budgets need shared/gateway enforcement and provider-account spending controls. Accounts do not yet gate optional paid learning requests; paid AI remains explicitly disabled by default.
- Perform broader accessibility, cross-browser, load, and external security verification. Browser execution is now implemented; server-side execution remains intentionally disabled.

The older sections below describe historical findings; resolved statuses are marked rather than removing the original evidence.

## Backend admission-control follow-up (2026-10-24)

The requested application-level P0 admission controls are now implemented in `backend/main.py`, `backend/security.py`, and `backend/ai_provider.py`:

- Shared per-peer sliding-window rate limiting across all three learning endpoints, including mounted/root-prefixed deployments, demo requests, and invalid attempts. Default: 20 attempts per 60 seconds, with a bounded 4096-client quota map.
- A 65,536-byte pre-parse limit on actual HTTP request bytes, including streamed bodies and forged/missing Content-Length, plus a 5-second body-receive deadline.
- Model-level list-item bounds: requirements at most 500 characters, mentor test results at most 300; list counts remain capped at 12. Blank items, nonboolean opt-in values, and unknown fields are rejected before provider work.
- Immediate provider concurrency admission (4 workers by default), a 20-second response deadline, no unbounded work queue, and slot retention until the actual worker exits after timeout/cancellation.
- A process-wide sliding budget of 100 admitted paid opt-in attempts per 24 hours by default. Paid HTTP requests require `SHERPA_ENABLE_PAID_AI=true` in addition to learner opt-in and a server key; paid mode is disabled by default.
- Quota/capacity/budget exhaustion returns 429 with Retry-After before provider selection; oversized bodies return 413, invalid models 422, stalled body uploads 408, and provider deadline overruns 504. Tests explicitly verify rejected work never selects a provider.
- Output-token and upstream-byte caps, redirect rejection, explicit error-response cleanup, and a socket watchdog for slow upstream response headers/body reads.

Follow-up verification: **62/62 backend tests passed** with warnings treated as errors (50 new security/regression tests); **43/43 frontend tests passed**; Python compilation and the production build passed; no editor diagnostics were reported. Tests used mocks/direct ASGI calls/local socket pairs without external or paid calls. No new dependency was installed. Configuration and operating instructions are in `README.md`.

**Historical status after backend controls:** production remained NO-GO at that stage. Frontend/dependency remediation has since been completed as recorded above. In-memory quotas still reset on restart and multiply across processes; trusted ingress/shared budgets and deployed TLS/AI verification remain release requirements. Python cannot forcibly stop every DNS/connect operation, so such work retains its bounded slot rather than permitting replacement work.

## Verified checks (initial assessment)

| Check | Result |
| --- | --- |
| Frontend helper/API-wrapper tests | 43/43 passed (`npm.cmd test`) |
| Backend provider/execution-boundary unit tests | 12/12 passed (`.venv/Scripts/python.exe -m unittest discover -v`) |
| Production compilation/bundle | Passed (`npm.cmd run build`) |
| VS Code diagnostics | No errors reported |
| Built frontend browser smoke test | Dashboard renders; deterministic plan creation works |
| Isolated API health | HTTP 200; execution explicitly disabled |
| Deterministic plan, hints, mentor HTTP requests | HTTP 200 |
| Empty prompt over HTTP | HTTP 422 |
| Submitted source over HTTP | HTTP 503; fails closed without execution |
| Vite preview `/api/health` proxy | HTTP 200 |
| npm shipped dependency audit | No reported advisories (`npm.cmd audit --omit=dev --json`) |
| Full npm dependency audit | Two affected packages: Vite (high), esbuild (moderate) |
| Delayed-response browser regression probe | FAILED: persisted hint use was overwritten |

HTTP tests used a temporary backend on loopback port 18000 with `OPENAI_API_KEY` empty. The built frontend was served on loopback port 4173. An existing service occupied port 8000 and was not replaced. AI opt-in remained off. Vite preview is a local verification tool, not proof of a production server configuration.

## Initial release findings (historical)

### P0 — Original finding; application controls implemented, deployment gate remains

**Unrestricted paid AI usage and insufficient admission controls.**

The paragraphs below describe the initial audit baseline, not the updated backend implementation. See the follow-up above for the implemented controls and remaining operational requirements. Original line references are historical.

`backend/main.py:69-121` accepts the client-controlled `use_ai` flag without application authentication, quotas, rate limits, or a bounded request admission queue. `backend/ai_provider.py:345` selects a real provider when a server key is available. An accessible API therefore allows arbitrary callers to consume the server's AI budget unless an external gateway enforces controls. Browser opt-in and CORS are not authorization.

Request parsing also lacks an application-level body-size limit, and the list fields in `backend/main.py:31-44` constrain item counts but not individual item lengths at schema level. Helper validation runs after parsing. `asyncio.to_thread` does not supply bounded admission for incoming requests.

Release gate: enforce a documented access model, per-caller rate limits, concurrency limits, request-byte limits, and cost/output budgets at the application or verified ingress layer. Anonymous use can be intentional, but still needs abuse and cost controls. Demonstrate these controls with tests. Keep real AI disabled until then.

### P1 — Progress loss (resolved with frontend regressions)

`src/App.tsx:133-137` and `src/App.tsx:189` write progress derived from state captured before an awaited request. A later response can overwrite newer hint counts, earned rewards, or reset state.

Reproduced in the production bundle using browser request interception:

1. Start a plan request and hold a valid deterministic response.
2. Reveal the first Bug Detective hint while the request is pending.
3. Observe persisted `hintsUsed` increase from 0 to 1.
4. Release the plan response.
5. Observe persisted `hintsUsed` return to 0.

Release gate: apply updates against current progress, coordinate persistence with those updates, and invalidate pending work when progress is reset. Add mounted-component/browser regression tests covering concurrent reward, hint, and reset operations.

### P1 — Coverage can block the browser (resolved with work limits/cache)

`src/coverage.ts:19-31` uses synchronous trial division for any safe integer in an accepted fixture. It is invoked repeatedly by requirement matching and scoring. `src/App.tsx:86` recalculates coverage on every render, including text edits.

A source-audit probe with a schema-valid 12-requirement/12-case plan and input `1000000000039` took approximately 2.2 seconds for one coverage calculation. Larger accepted values can take substantially longer. Response shape validation alone does not bound computational work.

Release gate: constrain supported fixture ranges and computational work; cache/memoize repeated calculations and move any intentionally expensive work off the UI thread. Unsupported values must remain UNTESTED rather than receive fabricated results. Test maximum-cost accepted inputs.

### P1 — Challenge lifecycle and result correctness (resolved with frontend regressions)

- `src/App.tsx:139-177,275`: reset does not cancel or invalidate pending requests; late responses can restore old plans or attach old hints/mentor results to a different challenge.
- `src/App.tsx:79`: fixed static prime checks are assigned to provider requirement labels by array index. Valid reordered requirements can receive unrelated pass/fail badges.
- `src/App.tsx:349` with request construction at `176,269`: editing the prompt leaves the old plan active, allowing new prompt text to be sent with old requirements.
- `src/App.tsx:129,182`: hint provenance is not consistently reset with the hint set; local fallback hints can retain an earlier AI-generated label.

Release gate: bind requests, prompts, results, and provenance to explicit plan identities; discard stale completions; keep fixed static checks separate from arbitrary provider requirements or map only explicitly supported semantics. Add regression tests for each case.

### P1 — No verified production deployment contract (still open; artifacts added)

The repository documents development startup with Vite and Uvicorn `--reload`. It does not establish a production static host/reverse proxy, TLS termination, `/api` routing, process supervision, resource limits, health-based recovery, or secret injection. Python dependencies use broad ranges without a tested transitive lock/constraints artifact. No repository CI workflow was found.

Local preview inherited a working API proxy, but a static host serving `dist` will need its own `/api` routing. Preview responses did not contain CSP or other deployment security headers; actual production edge behavior remains unverified. A Dockerfile is not mandatory, but an equivalent reproducible and tested deployment is.

Release gate: define and stage the intended hosting topology, lock tested dependencies, add automated release checks, configure applicable security headers and TLS, and verify restart/recovery, routing, logs, monitoring, and rollback against that environment.

### P1 — Development-tool advisories (resolved; current npm audit clean)

Full npm audit reports Vite 5.4.21 as high severity and its esbuild dependency as moderate severity. Findings include Windows path/file-access and launch-editor issues. These are development/server-tool findings, not proof of an exploitable flaw in the static React bundle. The shipped npm dependency audit is clean at assessment time.

Release gate: upgrade to supported patched tool versions, review compatibility, and rerun tests/build/audit. Do not expose Vite development or preview servers publicly. Do not apply a forced major-version audit fix without reviewing it.

## Additional production work

- **Frontend follow-up implemented:** cancellation and end-to-end fetch/body deadlines now prevent indefinite loading.
- **Backend follow-up implemented:** bounded admission, response deadlines, output budgets, and header/body socket interruption now replace the initial socket-timeout-only behavior. Cancellation cannot terminate every DNS/connect operation; bounded worker slots remain held until completion.
- **Implemented:** application error boundary/recovery, keyboard navigation focus, live feedback announcements, removal of inert/sample controls, and filtering/rejection of verified-test claims.
- **Implemented:** mounted React regressions cover adverse request ordering, resets, timeouts, provenance, and account transitions. CI now supplies PostgreSQL; that workflow and deployed integration still need to run. Browser-local and database demo scores are not trusted evidence of code correctness.

## Intentional scope limitations, not security defects

Server execution fails closed. The separate browser WASI runner now produces actual local execution/test results. Fixture scores and text-pattern review remain illustrative and distinct from those results. Guest progress is browser-local; signed-in progress uses PostgreSQL. Browser self-checks are not server-attested grades and do not qualify for verified-execution rewards.

An actual execution feature requires a separately designed and verified isolated sandbox. Do not enable execution inside the web process merely to remove this limitation.

Positive controls include server-side key handling, opt-in real AI, bounded structured provider-output validation, sanitized public provider errors, React text rendering rather than raw HTML injection, malformed-storage recovery, and explicit demo/execution-disabled disclosures.

## Not verified

- Actual staging/production infrastructure, HTTPS, reverse-proxy limits, backups, alerting, restart behavior, and rollback.
- Live paid AI quality, capacity, or integration: only deterministic/mock paths were exercised, intentionally without cost.
- Python advisory scanning remains pending. Pip was bootstrapped in the project environment, account dependencies were installed, and `pip check` passed; that consistency check is not an advisory scan.
- Full accessibility conformance, cross-browser/mobile coverage, sustained load/soak behavior, and external penetration testing.
- Hosted database behavior is covered by earlier live integration/restricted-runtime tests; local browser WASI and responsive execution UI are now verified above. Public deployed account workflows, broader browser/security review, and any future server sandbox remain unverified; server execution is still disabled.

## Minimum next release decision

Remain **NO-GO** for public production until account-lifecycle, deployed HTTPS/operations, backup/restore/monitoring, and security gates are satisfied. Frontend correctness, Supabase setup, local Python execution, actual testing/fix comparison, and professional responsive UI are implemented and tested. Passing the current regressions and browser smoke does not constitute a public deployment or full security certification.
