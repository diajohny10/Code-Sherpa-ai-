# OpenAI setup

OpenAI is integrated through the backend Responses API for planning, progressive hints, contextual mentoring, and source-aware test suggestions. No key belongs in React, localStorage, Supabase tables, or a `VITE_*` variable. No paid API calls were made during implementation or tests.

## Activate privately

1. Create an API key in your own [OpenAI API account](https://platform.openai.com/api-keys) and configure API billing/spending limits as appropriate. A ChatGPT subscription does not configure this backend's API billing.
2. Add the following **privately** to the real, ignored `.env` file (the placeholder below is not a key):

   ```dotenv
   OPENAI_API_KEY=your-private-api-key
   OPENAI_MODEL=gpt-4.1-mini
   SHERPA_ENABLE_PAID_AI=true
   ```

   Do not send your key through chat, screenshots, or browser forms. Model access depends on your API account; choose a supported model with Responses API structured-output support.
3. Stop the ordinary **Start backend (Supabase local preview)** task if it is running. That task intentionally forces paid AI **off**, regardless of `.env`. Do not try to run two backend tasks on port 18000.
4. Run the VS Code task **Start backend (OpenAI opt-in preview)**. It loads the private `.env`, explicitly enables AI in that loopback development process, and keeps the existing rate/cost/concurrency controls. The Supabase connection and account/session system remain unchanged.
5. Open the frontend at <http://127.0.0.1:5176/> and click **Check OpenAI availability**. This uses `GET /api/ai/status`, which reports key presence, server permission, and a safe model label. It does **not** contact OpenAI, validate the credential, confirm billing, or incur model charges.
6. Enable **Allow configured AI for this request (may incur cost)**. If desired, separately enable **Include editor code in AI test suggestions**. Never include credentials or private data in the editor/prompt.
7. Click **Generate AI test cases**. This is the point where a configured model request can incur API charges. Hints, plan generation, and mentoring also require the explicit AI opt-in when requesting real model output.

The `.env` is not a checked-in config file. On production hosting, use the provider's secret manager and restart the backend after changing configuration. Loopback HTTP preview overrides are not production cookie/TLS settings.

## What the test-case button does

- For a changed prompt, it creates fresh cases rather than revealing a stale previous plan. It preserves your pasted editor code, including when switching challenge types.
- With AI enabled, it calls `POST /api/learning/test-cases` with the prompt. Editor source is included only when **both** AI use and code sharing are selected. Ordinary plan generation, hints, and mentor requests do not automatically include editor source.
- OpenAI is instructed to treat prompt/code as untrusted data, distinguish function calls from stdin/stdout scripts, derive expected behavior from the task rather than assume buggy code is correct, and never claim execution. Structured output is validated before display.
- Cases are explicitly labeled **AI-generated suggestions**, not actual outputs or a correctness guarantee. The separate **Run and test Python** panel now runs actual CPython WASI locally in isolated browser workers. It does not call OpenAI; `/api/execute` remains disabled on the server. See `PYTHON_EXECUTION.md`.
- Without OpenAI, recognized tasks such as Armstrong use concrete deterministic reference suggestions. Generic backend placeholders no longer replace richer local examples. Unknown tasks retain honest placeholders requiring explicit input/output definitions.
- The UI announces fresh cases and focuses the result panel. Reset, prompt/code-sharing changes, account transitions, and request cancellation discard stale completions.

## Bounds and privacy

The new test-case endpoint shares the existing learning-route rate limit, provider concurrency limit, response deadline, and paid-request budget. Source is capped at 20,000 characters and HTTP request bytes at 65,536. Oversized or over-budget requests are rejected before paid-provider work. Client fetch/body deadlines allow the backend deadline plus network overhead; aborted requests do not repopulate reset UI.

Responses API requests include `store: false` to disable response persistence. This is not a claim of zero provider retention; consult OpenAI's applicable account data policies. Prompts/source are transmitted to OpenAI when you opt in and configure the server. Backend keys are never returned by status or learning endpoints.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Demo-generated output | UI AI opt-in, server flag, backend key, and whether the AI-off preview task is running |
| Status route unavailable | Restart the backend after this code update; an older running process may not have the new routes |
| Key present but server disabled | Start the explicit OpenAI opt-in task; the ordinary preview task intentionally stays disabled |
| “Ready” configuration but a request fails | Availability is not credential/billing validation; verify API key/model access, billing, network, and sanitized backend errors |
| 429 from backend | Shared request rate, concurrency capacity, or paid-request budget has been reached; honor Retry-After |
| Source not used | Select both opt-in checkboxes; demo responses never analyze editor source |
| Generic cases | Describe the actual task in the programming prompt; editor source is not implicitly sent, and no Python is executed |

Tests mock OpenAI and cover source-consent privacy, safe status responses, cancellation, malformed provider data, shared admission limits, deadlines, concrete fallback cases, and UI feedback. Live API quality and paid integration remain unverified until an explicitly authorized real request succeeds.