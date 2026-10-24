# Supabase hosted PostgreSQL setup (no Docker)

## What changes, and what does not

Supabase hosts the PostgreSQL database. The React frontend still calls FastAPI; FastAPI owns authentication, CSRF checks, sessions, and authorization. The frontend never connects directly to PostgreSQL or the Supabase Data API. **This does not switch accounts to Supabase Auth** and therefore does not automatically add email verification or password recovery. Existing app users are not entries in Supabase's `auth.users` table.

Hosted setup has now established a certificate- and hostname-verified Supabase connection and applied migrations 001/002, with idempotency and RLS checks. The user-supplied public CA is stored at `certs/supabase-ca.crt`; its path and a privately encoded database URL are configured in the ignored `.env`. See `PRODUCTION_READINESS.md` for the latest account-test/runtime status. Docker is not a prerequisite.

The current staging configuration also uses the dedicated restricted `sherpa_backend` database role, with the owner URL kept separately for migrations. All **97 backend tests, including the three live hosted integration tests, passed with zero skips**; all **103 frontend tests** and the build passed. A live hosted smoke test repeated through the restricted runtime role verified registration, saving, conflicts/isolation, CSRF, session rotation/expiry, logout, and cleanup. Safe result summaries are in `verification/` and contain no credentials.

## Running the connected workspace

VS Code tasks now provide:

- **Start backend (Supabase local preview):** `127.0.0.1:18000`, loads the private `.env`, overrides only loopback-preview origin/cookie settings, and disables paid AI.
- **Start frontend (Supabase local preview):** <http://127.0.0.1:5176/>, proxies `/api` to that backend. Port 8000 was occupied and was not replaced.
- **Verify hosted Supabase staging:** live smoke test (temporary accounts, staging-only).
- **Run backend and live Supabase tests:** full backend suite, explicitly enables the approved staging integration tests and writes a redacted summary.
- **Configure restricted Supabase runtime role:** one-time credential bootstrap; subsequent calls verify the already-configured role without rotating its password.
- **Check connected preview HTTP**, **Test frontend**, and **Build frontend**.

The equivalent staging-only CLI checks are `python -m backend.verify_hosted --staging` and `python -m backend.verify_hosted --staging --all-tests`. Their `--staging` flag acknowledges permission to create/remove temporary test accounts; never use it against real-user production data. `python -m backend.configure_runtime` handles private credential generation and saving only after verified-TLS authentication and privilege checks; it never displays the password. Local preview HTTP checks passed. Integrated-browser navigation timed out in this session, so deployed/browser end-to-end verification remains a separate gate.

These are **local application services connected to hosted Supabase**, not a publicly deployed HTTPS frontend/backend. Production still requires its own hosting, domain/ingress, Secure cookies, account-lifecycle features, monitoring and restore verification.

## 1. Create your project

1. Open <https://supabase.com/dashboard> and sign in yourself. Create/select a project in your organization and choose an appropriate region/plan. Project creation may incur charges; review the plan yourself.
2. Keep the database password private. Do not send passwords, complete database URLs, access tokens, secret/service-role keys, or screenshots containing them through chat.
3. Prefer a separate project/branch for staging. Never use a database containing real users for integration tests.
4. In **Connect**, copy the **Session pooler** URI for this persistent FastAPI service if your network is IPv4-only. Use the exact host and username displayed; do not guess the pooler hostname from the region. Session mode uses port **5432**. Direct mode is suitable when IPv6 or the IPv4 add-on is available. Transaction pooling on 6543 is supported by disabling statement caching, but session/direct connections are preferred for this long-running backend and migrations.

Example shapes only, not real credentials:

```text
Session: postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@POOLER_HOST:5432/postgres
Direct:  postgresql://postgres:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
```

Percent-encode reserved password characters. Do not paste these placeholders literally. Supabase API/project URLs and publishable keys are not PostgreSQL connection strings.

## 2. Configure secrets in your backend terminal

The backend reads process environment variables or hosting-provider secrets. It does not automatically load `.env`.

From your own PowerShell terminal in the repository, the optional helper accepts connection URLs through hidden input and does not save them to disk:

```powershell
# For testing the frontend locally against the HOSTED database:
.\scripts\configure-supabase.ps1 -Origin http://127.0.0.1:5173 -LocalHttp

# For a deployed HTTPS app instead, omit -LocalHttp:
# .\scripts\configure-supabase.ps1 -Origin https://your-app.example
```

Type secrets directly into those terminal prompts; do not send them through chat. If PowerShell script policy blocks this helper, configure equivalent environment variables privately in your terminal/hosting secret manager. No execution-policy or administrator change is required. `.env.supabase.example` documents the names, not real values.

| Variable | Purpose |
| --- | --- |
| `SHERPA_DATABASE_URL` | Server-only runtime PostgreSQL URI |
| `SHERPA_MIGRATION_DATABASE_URL` | Optional separate owner URI for migrations; otherwise uses the runtime URI |
| `SHERPA_DATABASE_CA_FILE` | Optional root-certificate file downloaded from Supabase Database settings |
| `SHERPA_AUTH_ORIGINS` | Exact frontend origin(s), comma-separated, with no trailing slash or wildcard |
| `SHERPA_COOKIE_SECURE` | `true` for HTTPS production; `false` accepted only for loopback HTTP origins |
| `SHERPA_ENABLE_PAID_AI` | Keep `false` until the separate paid-AI release controls are verified |

For non-loopback database hosts, the driver always verifies the certificate **and hostname**. It extends system trust with `SHERPA_DATABASE_CA_FILE` if configured. Weaker DSN plaintext-fallback options are rejected. If certificate verification fails, install the correct root certificate; never disable validation. The certificate must match the endpoint in use (direct/pooler).

The application pool has at most five connections per process; review aggregate limits against your Supabase plan. `statement_cache_size=0` prevents transaction-pooler prepared-statement conflicts. DSN certificate options such as `sslrootcert`, `sslcrl`, client certificate/key options are explicitly rejected rather than silently ignored by the custom context. Use `SHERPA_DATABASE_CA_FILE` for added root trust; CRL/client-certificate authentication is not implemented.

Passwords containing `@`, `#`, and other URL-reserved characters must be percent-encoded in connection URIs. This changes URI representation, not the database password. Unescaped `@` credentials are rejected before asyncpg can misinterpret them as a hostname. Do not disable TLS verification when a certificate chain is missing: download the CA from Supabase's SSL configuration and set `SHERPA_DATABASE_CA_FILE`.

## 3. Apply migrations once, from an owner connection

Review the selected target and take any required backup before changing an existing database. Then run from the same privately configured terminal:

```powershell
.\.venv\Scripts\python.exe -m backend.migrate
```

The command verifies migration checksums, takes a transaction-scoped migration lock, and applies all pending files in one transaction. Do not manually paste migration 001 into the SQL Editor: that would omit the migration ledger and the privacy migration. Do not change previously applied migration files or reset a production database to fix a migration error.

Migration 002 moves `users`, `sessions`, and `progress` into **`sherpa_private`**, preserving data, foreign keys, and indices. It enables RLS and revokes grants from PUBLIC and existing Supabase `anon`, `authenticated`, and `service_role` roles. The public migration ledger is protected too. The account tables have **no client policies**. Do not expose `sherpa_private` in Supabase API settings or create public views/security-definer functions that bypass these controls. If this project uses no other Data API features, disable the Data API as defense in depth.

Initial owner-based smoke testing can use the migration owner's runtime connection. Before production, run `deploy/supabase-runtime-role.sql` as the owner, configure a login/password for `sherpa_backend` privately in your database administration session, and use that role's URL for runtime access. Shared pooler usernames for custom roles use `sherpa_backend.PROJECT_REF`. Keep the owner URI only in migration tooling. Never grant the backend role to Supabase client roles.

The optional role script creates a **NOLOGIN**, non-superuser, non-BYPASSRLS role with the necessary schema/table grants and role-specific server policies only. It intentionally does not create or print a password. It is a one-time bootstrap and **fails closed if the role already exists**; audit existing role privileges/memberships manually rather than assuming it is safe or rerunning the bootstrap. These policies allow the trusted backend to access account rows; FastAPI's session checks, not `auth.uid()`, enforce individual user ownership. A newly bootstrapped runtime role cannot manage schemas or the migration ledger.

## 4. Start the application

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers
```

Use `npm.cmd run dev` in a second terminal for local frontend testing. For production, deploy the FastAPI service and built `dist` separately or behind one trusted same-origin HTTPS ingress. **Supabase's PostgreSQL service does not host this FastAPI process or static frontend for you.** Configure `/api` routing and exact proxy trust as described in README. Do not expose Vite development/preview servers publicly.

When variables are stored in the private project `.env` rather than already set in the terminal, include `--env-file .env` in that Uvicorn command. The file is parsed privately by python-dotenv, including quoted values; never print it to diagnose connection problems. Production hosting should inject its own secrets instead of relying on a workstation file.

Check registration, logout, re-login, and progress reload. Confirm failed/expired sessions and stale revisions do not overwrite another account/device's data. Never inspect or share raw session cookies/password hashes in screenshots.

## 5. Hosted staging verification (no local PostgreSQL)

Use a separate, disposable Supabase staging project/branch containing no real users. Privately configure its **owner** URI as `SHERPA_TEST_DATABASE_URL`. Because hosted Supabase normally names the database `postgres`, you must explicitly acknowledge isolation:

```powershell
# First set SHERPA_TEST_DATABASE_URL PRIVATELY in this terminal to STAGING, not production.
$env:SHERPA_TEST_ISOLATED_PROJECT = 'true'
.\.venv\Scripts\python.exe -W error -m unittest tests.test_postgres_integration -v
```

The acknowledgement is required for Supabase hosts whose database is `postgres`; ordinary PostgreSQL test databases must still have a standalone `test` segment in their name. The suite migrates that staging project and creates/removes its own accounts, verifies session/progress behavior, and checks schema/RLS/effective API-role privileges. Never set the acknowledgement to force tests onto production. Optional server-only policies are permitted; client/public policies are not.

This hosted run has now succeeded against the user-approved staging project. That establishes the covered migrations/TLS/account/isolation behavior, not public deployment readiness. Repeat it on isolated staging after relevant changes. CI's isolated PostgreSQL service remains useful as an additional test, but you do not need local Docker.

## Still required before public release

- Deploy and verify HTTPS, Secure cookies, correct origins/proxy trust, private networking/secrets, and the least-privilege runtime role.
- Configure and test provider-plan backups/PITR and restores; do not assume every Supabase plan includes the same backup/retention or availability guarantees.
- Add the required email verification/recovery/deletion account lifecycle, monitoring/alerts, load tests, and durable/shared quotas where needed.
- Keep paid AI behind its explicit permission/budget controls and server-side learner execution disabled. The separate browser WASI self-check runner is now implemented and tested; it does not use database credentials or save source/execution reports to Supabase. See `PYTHON_EXECUTION.md`.

References: [connections and pooling](https://supabase.com/docs/guides/database/connecting-to-postgres), [securing data](https://supabase.com/docs/guides/database/secure-data), [RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).