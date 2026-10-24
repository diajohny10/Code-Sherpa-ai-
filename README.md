# Code Sherpa AI

Code Sherpa AI is a beginner-focused Python learning dashboard. It combines learning plans, illustrative requirement coverage, Bug Detective, guest/account progress, optional AI guidance, and real browser-only Python execution. Reference/demo scores remain separate from actual run/test results.

## Features

- **Project-themed cinematic entry:** a short violet/mint summit trail and code-console reveal with immediate Enter/Skip/Escape, a 4.2-second automatic dismissal, once-per-tab-session behavior, and reduced-motion support. It does not remount or reset the workspace. Replay preview: <http://127.0.0.1:5176/?intro=1> (use a new tab if you have unsaved code).
- **Execution-linked requirement coverage:** the main panel starts at “Not tested,” not an unexplained zero. Link actual asserted tests to requirements in Run and test Python, then run them; current passing/failing evidence updates the panel. Code/expected-output/task changes invalidate stale evidence. Reference-fixture scores are collapsed separately and never substituted for your code's results.

- **Real browser Python:** syntax checks, runtime tracebacks, stdin/stdout runs, JSON-function tests, editable expected outputs, and rerunning the same inputs to check fixes. CPython WASI runs in bounded workers without server execution or AI charges. See [PYTHON_EXECUTION.md](PYTHON_EXECUTION.md).
- **Professional dark workspace:** consistent system typography, clear execution actions/statuses, polished cases/output cards, keyboard focus, and responsive desktop/tablet/mobile layouts. Real browser tests found no page overflow at 1440, 768, 390, and 320 pixels.

- Prompt-to-requirements for the prime-number and even/odd examples, with deterministic demo fallback for other prompts.
- Suggested tests and edge cases are distinct from execution evidence. Main requirement rows show **TESTS PASSED**, **FAILING**, or **UNTESTED** based on your explicitly mapped assertions. Passing linked tests / all requirements determines the score only after usable evidence exists; this is not proof for every input or a server-attested grade.
- Progressive, one-at-a-time hints.
- Four fixed Bug Detective challenges, selectable repair hypotheses, editable proposed fixes, and fixture-based scoring. Free-text fixes are never executed or verified.
- Guest XP, levels, history, hints, and achievements stay in this browser's localStorage. Signed-in progress is stored in PostgreSQL and loaded on other devices after sign-in/reload. Guest and account progress stay separate; no automatic import occurs. Reset asks for confirmation. Concurrent account writes use revision checks rather than silently overwriting newer progress.
- Email/password registration and sign-in, Argon2id hashing, rotating/revocable database sessions, HttpOnly cookies, Origin/CSRF enforcement, and logout. Account passwords/tokens are never stored in localStorage. Email verification, password recovery, MFA, and account deletion are not yet implemented.
- Contextual Code Mentor. Deterministic mode works without a key; real AI requires learner opt-in, explicit backend enablement, a server-side key, and available admission budget.
- “Review my code” remains limited text-pattern feedback. The separate **Run and test Python** panel performs actual compilation/execution. Neither reference suggestions nor passing selected inputs guarantee correctness for every input.

## Windows 11 setup and startup

Open PowerShell in the project folder. Current workspace dependencies/runtime assets are installed. For a fresh setup, use Node 24 and Python 3.13, create `.venv`, run `npm.cmd ci` **and `npm.cmd run prepare:python`**, and install `requirements.lock.txt` in that environment. Browser execution uses its own CPython 3.14.9 WASI build, not native backend Python. The Python lock is the tested Windows/Python 3.13 snapshot; validate it on the target platform. Start the frontend:

```powershell
npm run dev
```

Open the Vite URL printed in that terminal, normally [http://127.0.0.1:5173](http://127.0.0.1:5173). Keep that terminal open. In a second PowerShell window, start the backend using the project virtual environment:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

The API health endpoint is [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health); interactive API docs are at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). Vite proxies `/api` requests to this backend. If the backend is stopped, the frontend falls back to its local deterministic planner/mentor and labels those results as demo-generated.

The account backend adds `asyncpg` and `argon2-cffi`. To check existing installations without installing anything:

```powershell
Test-Path .\node_modules
.\.venv\Scripts\python.exe -c "import fastapi, uvicorn; print('FastAPI', fastapi.__version__, '| Uvicorn', uvicorn.__version__)"
```

## PostgreSQL and learner accounts

**Hosted Supabase is connected and staging-verified: [Supabase setup guide](SUPABASE_SETUP.md).** TLS verification, migrations, RLS/API-role isolation, restricted runtime credentials, and real account/progress tests passed without local Docker. Private connection settings remain in the ignored `.env`. The app retains FastAPI cookie authentication rather than Supabase Auth; Supabase hosts the database, not this FastAPI server/frontend. The connected local preview is <http://127.0.0.1:5176/> (backend port 18000); restart it using the named VS Code preview tasks. This is not yet a public production deployment.

Account storage is optional. With no `SHERPA_DATABASE_URL`, the dashboard remains a usable guest demo and account controls report that the database is disabled. A stopped/unreachable backend also leaves guest learning available. A signed-in account never silently falls back to localStorage for saving: failed writes show an unsaved warning, and conflicts pause autosave until you explicitly reload. Guest progress is never automatically imported into an account.

### Optional local database setup (Windows)

**Current machine:** Docker's CLI is installed, but its engine reports **“Docker Desktop is unable to start.”** No PostgreSQL service was found. The real-database integration tests have therefore not been run locally. Start/fix Docker Desktop yourself before running these steps; no elevation or system configuration was attempted by this project.

1. Install the declared Python dependencies in `.venv` (already installed in this workspace). A fresh setup can use `python -m pip install -r requirements.lock.txt` with that environment's interpreter. Do not install globally.
2. Generate a private local `.env` using `scripts/configure-local.ps1`, or copy `.env.example` and fill it privately. The generator uses random database credentials, does not display them, and refuses to overwrite an existing file. `.env` is ignored by Git. If PowerShell policy blocks scripts, create/edit the file manually; no execution-policy change is required.
3. With Docker Desktop healthy, run from the project root:

```powershell
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
& $docker compose up -d --wait
. .\scripts\load-local-env.ps1
.\.venv\Scripts\python.exe -m backend.migrate
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

If scripts cannot run, set the `SHERPA_*` variables from the private file directly in your terminal without sharing their contents. Compose reads `.env` automatically; the application deliberately reads process environment variables, not that file automatically.

4. In another terminal, run `npm.cmd run dev` and open the printed URL. Register with an email and a password of 12–128 characters. Sign out and back in to load the account's saved progress. If Vite selects a different port, explicitly add that exact origin to `SHERPA_AUTH_ORIGINS` and restart the backend.

The local Compose service binds PostgreSQL only to `127.0.0.1:5433` and keeps data in a named volume. Do not run `compose down -v` unless you intentionally want to delete that database. The image is pinned to the supported PostgreSQL 17 major; pin a tested patch/digest for a production deployment.

### Account and persistence security

- Passwords use Argon2id; hash work is limited to two concurrent tasks. Login and registration share a separate default **5 attempts/60 seconds per peer** (`SHERPA_AUTH_REQUESTS_PER_WINDOW`, `SHERPA_AUTH_RATE_WINDOW_SECONDS`).
- Sessions last seven days, rotate on login/registration, and are revoked on logout. Only SHA-256 hashes of random session tokens are stored in PostgreSQL. Session cookies are HttpOnly, SameSite=Lax, scoped to `/api`, and **Secure by default**.
- `SHERPA_COOKIE_SECURE=false` is accepted only with exclusively loopback `SHERPA_AUTH_ORIGINS` for local HTTP development. Production requires HTTPS and Secure cookies. Trusted origins are exact, explicit values—not wildcards. Origin checks protect all account writes; logout/progress writes also require the session-bound `X-CSRF-Token` header.
- The server derives user identity from the session, never a submitted user ID. SQL values are parameterized. Writes require the current progress revision; stale writes return 409 rather than overwrite another device's data.
- Scores/XP are still self-reported demo learning records, not authorization, verified execution, or trusted leaderboard data. Verified-test claims are rejected.
- Database connections are pooled (maximum five) with connection, acquisition, and query timeouts. Database failures return sanitized 503 errors. Migrations are explicit, transactional, checksum-checked, and do not create/drop databases.
- Run `python -m backend.prune_sessions` periodically with the configured database environment to delete at most 1,000 expired sessions per invocation. Authentication does not perform unbounded global cleanup.

The `SHERPA_DATABASE_URL` is a server-side secret. For production use a managed PostgreSQL database or properly operated service, TLS certificate verification appropriate to your provider, a least-privilege application role, separate migration credentials, backups with tested restore, and secret injection. Local Compose's database owner credentials and insecure-cookie setting are **not** production settings.

### Database verification

Use a **separate test database**, never the real learner database. After the local database is running:

```powershell
& $docker compose exec -T postgres createdb -U sherpa sherpa_test
$env:SHERPA_TEST_DATABASE_URL = $env:SHERPA_DATABASE_URL -replace '/sherpa$', '/sherpa_test'
.\.venv\Scripts\python.exe -W error -m unittest discover -v
```

The integration suite accepts a test-named database or an explicitly acknowledged isolated Supabase staging project as described in `SUPABASE_SETUP.md`. It applies migrations idempotently and verifies account behavior plus private-schema/RLS/API-role isolation. Without a configured test database, these three tests explicitly skip. `.github/workflows/checks.yml` supplies PostgreSQL in CI; the workflow itself has not been executed in this session.

Email verification, password recovery, MFA, account deletion, shared/durable quotas, and deployed HTTPS/backup verification remain release work. Duplicate registration currently returns 409 and can reveal whether an email is registered. No paid AI calls were needed for this implementation.

## Demo mode and optional AI

**OpenAI activation and test-case generation: [OPENAI_SETUP.md](OPENAI_SETUP.md).** The test-case button now refreshes changed prompts while preserving editor code. Optional source-aware AI suggestions require both AI opt-in and a separate code-sharing checkbox. The new **Check OpenAI availability** button checks backend configuration without a paid request. Use the explicit **Start backend (OpenAI opt-in preview)** task after configuring the key privately; the normal preview task intentionally forces AI off.

Demo mode is the default. It uses fixed examples and deterministic logic, needs no API key, and does not call a model. Frontend AI opt-in is off by default. HTTP requests can use real AI only when `SHERPA_ENABLE_PAID_AI=true`, the learner explicitly opts in, `OPENAI_API_KEY` is configured in the backend process, and all admission checks pass. A key alone does not enable paid HTTP requests. Otherwise requests use labeled demo output. The key is never sent to the browser or included in API responses. The OpenAI adapter uses Python's standard library HTTP client; no AI SDK or rate-limiting dependency is required. The default model is `gpt-4.1-mini`, configurable using `OPENAI_MODEL`.

When you choose to enable real AI later, configure the secret in the backend PowerShell session only, then launch Uvicorn from that same session:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-4.1-mini" # optional
$env:SHERPA_ENABLE_PAID_AI = "true" # explicit server opt-in; review admission limits first
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Do not put the key in frontend variables, source files, localStorage, screenshots, or version control. Requests to the real provider may incur charges. Tests mock OpenAI and make no paid calls. Keep AI opt-in off for demo-only use. Provider keys were not read, displayed, or activated during this integration work. No paid model call was made.

## Backend admission controls

The limits below are read once when the app is created. Invalid configuration fails startup. Restart after changing them. Defaults are deliberately conservative:

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `SHERPA_ENABLE_PAID_AI` | `false` | Explicit server permission for paid HTTP requests |
| `SHERPA_BODY_BYTES` | `65536` | Maximum actual request bytes, including chunked bodies, before JSON parsing |
| `SHERPA_BODY_TIMEOUT_SECONDS` | `5` | Total body-receive deadline |
| `SHERPA_REQUESTS_PER_WINDOW` | `20` | Attempts per peer IP across plan, hints, and mentor combined, including demo/invalid requests |
| `SHERPA_RATE_WINDOW_SECONDS` | `60` | Sliding client-rate window |
| `SHERPA_MAX_TRACKED_CLIENTS` | `4096` | Bounded quota-map size; unknown peers are rejected at capacity until entries expire |
| `SHERPA_PROVIDER_CONCURRENCY` | `4` | Maximum submitted provider tasks; no waiting admission queue |
| `SHERPA_PROVIDER_TIMEOUT_SECONDS` | `20` | End-to-end provider response deadline, including worker dispatch |
| `SHERPA_PAID_REQUESTS_PER_WINDOW` | `100` | Global per-process budget for admitted opted-in requests while paid AI is enabled |
| `SHERPA_PAID_WINDOW_SECONDS` | `86400` | Sliding paid-request budget window |

All learning routes share their limits: changing endpoints or the `use_ai` flag cannot obtain another client quota. Request-size checks apply to all HTTP endpoints. Models bound requirements to 12 nonblank strings of at most 500 characters, and mentor test results to 12 nonblank strings of at most 300 characters. `use_ai` must be an actual JSON boolean; unexpected model fields are rejected.

Rate, provider-capacity, and paid-budget exhaustion return **429** with `Retry-After`; oversized bodies return **413** before provider selection. Invalid model values return **422**, stalled body uploads return **408**, and provider deadline overruns return **504** with sanitized details. No automatic paid retry is performed. Output generation is capped at 1200 tokens per request; upstream response bytes are capped at 1,000,000. Redirects carrying provider credentials are not followed.

Paid reservations are shared across all peers and learning endpoints, conservatively charged for each admitted opted-in attempt even if it fails, times out, or falls back because no key exists. A capacity rejection does not consume a paid reservation. This is a **request-count budget, not an exact monetary/token billing quota**; set provider-account spending controls too.

Timed-out or cancelled calls keep their concurrency slots until their actual worker finishes. A deadline socket watchdog interrupts upstream response headers/body reads. Python threads cannot forcibly terminate every DNS/connect operation, so remaining workers can temporarily exhaust capacity; new work then receives 429 rather than accumulating. Process shutdown does not promise to instantly kill such threads. The isolated learner-code execution boundary remains disabled.

### Deployment boundary

These in-memory limits are **per application process**, reset on restart, and are not authentication. Use **one worker** unless a trusted ingress/distributed limiter enforces aggregate quotas. Multiple replicas multiply these budgets; durable organization-wide spend limits and identity-based quotas require gateway/shared storage controls. Keep paid AI off until those controls meet your deployment requirements.

For a single-process local service without trusted forwarding headers:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

The middleware uses the ASGI peer address and does not read `X-Forwarded-For` itself. If deploying behind a reverse proxy, explicitly configure Uvicorn's trusted proxy addresses, strip untrusted forwarding headers at ingress, and prevent direct access to the application port. Never use wildcard proxy trust on a public listener. Otherwise clients could spoof ASGI peer identities (or all proxied clients could share one quota). Production TLS, gateway authentication where required, durable budgets, monitoring, and the other readiness-report blockers remain separate release requirements.

## Checks

Run from the project folder:

```powershell
npm test
npm run build
.\.venv\Scripts\python.exe -m unittest discover -v
.\.venv\Scripts\python.exe -m py_compile backend\ai_provider.py backend\main.py backend\security.py backend\execution.py
```

Frontend tests use Node's built-in test runner. Backend tests use Python `unittest`, direct ASGI requests, mocks, and local socket pairs; no API key, external network, paid calls, or extra testing dependency is required. Admission tests cover shared/expiring quotas, mount prefixes, forged lengths, chunked/UTF-8 body sizes, list bounds, capacity/budget rejection before provider selection, deadlines, cancellation, worker-slot retention, token caps, and upstream cleanup.

## Safety boundary

FastAPI and the AI provider never execute learner source; `/api/execute` intentionally remains HTTP 503. Real **Run and test Python** execution instead uses fresh, resource-bounded CPython WASI browser workers with read-only virtual files and no JS bridge, sockets, host files, or server secrets. Source/results are not cloud-saved by that runner. AI source sharing remains separately opt-in. Reference coverage and Bug Detective fixtures are not actual run results; browser self-checks are not server-trusted grades and do not unlock the verified-tests achievement. See `PYTHON_EXECUTION.md` for limits, evidence, and deployment requirements.
