# Code Sherpa AI

- **Team:** Cognito
- **Member:** Dia Johny — Frontend and Backend
- **Live demo:** [code-sherpa-ai.vercel.app](https://code-sherpa-ai.vercel.app/)
- **Repository:** [github.com/diajohny10/Code-Sherpa-ai-](https://github.com/diajohny10/Code-Sherpa-ai-)

## Problem statement

Beginners can write Python without knowing whether their code handles the cases that matter. They need a place to run code, understand errors, and connect their own test results to what they are learning.

## Users and context

Code Sherpa AI is for people learning Python, especially beginners practicing small programming tasks. Learners can use the workspace as guests; optional accounts save learning progress across sessions.

## Solution overview

Code Sherpa AI combines a Python learning dashboard with an editor, browser-based execution, editable test cases, requirement coverage, progressive hints, and Bug Detective debugging challenges. Learners can see actual results from the tests they run; demo examples and AI suggestions are labeled separately.

The prototype also includes an optional Code Mentor. The app remains usable in deterministic demo mode without an AI key or paid model calls.

## Build context

This repository contains an existing prototype; it is not represented as a clean-slate project built entirely during the event. The distinctive prototype feature is connecting actual browser Python test results to requirement coverage. Use the Git history to identify when changes were made.

## Product demo

Open the [hosted app](https://code-sherpa-ai.vercel.app/). Try a Python task, run the code, edit a test case, and review which linked requirements passed or failed.

## Technology and setup

- **Frontend:** React, TypeScript, and Vite
- **Python execution:** CPython 3.14.9 compiled to WebAssembly/WASI; it runs in bounded browser workers
- **Backend:** FastAPI and Python
- **Progress storage:** browser `localStorage` for guests; PostgreSQL for signed-in accounts
- **Optional AI:** OpenAI Responses API, with `gpt-4.1-mini` as the default configured model

### Run locally

Requirements: Node.js 24. To install dependencies, prepare the browser Python runtime, and start the frontend:

```bash
npm ci
npm run prepare:python
npm run dev
```

For account storage or optional AI features, configure the backend privately using `.env.example` and the setup guides: [Supabase](SUPABASE_SETUP.md) and [OpenAI](OPENAI_SETUP.md). Never commit `.env` or put API keys in frontend variables.

## Models and data

AI is optional. When enabled by both the learner and the server, the configured OpenAI model can help create learning plans, hints, mentor responses, and suggested test cases. The default is `gpt-4.1-mini`; deployments may configure a different supported model. Without AI, the app uses deterministic examples and local fallback behavior.

The project does not bundle a training dataset. Learner prompts are used to produce requested guidance. Editor code is sent for AI test suggestions only when the learner enables AI and separately opts in to share the code. Python execution happens in the browser and does not send source code to the backend for execution. The bundled CPython WASI runtime is from [Brett Cannon's CPython WASI builds](https://github.com/brettcannon/cpython-wasi-build); it is a runtime dependency, not a project dataset. Its license is distributed with the runtime.

## Evaluation and guardrails

- Python run results come from executing the learner's code in a bounded browser worker; AI does not execute or grade the code.
- AI-generated tests and learning suggestions are labeled as suggestions and are not presented as verified results.
- Requirement coverage uses the learner's actual linked assertions. Passing selected tests does not prove correctness for every possible input.
- AI is off by default. A real model request requires learner opt-in and explicit server configuration; editor-code sharing requires a separate opt-in.
- Prompts and code are treated as untrusted input. Provider output is validated before display; request size, time, concurrency, and paid-request budgets are bounded.
- OpenAI requests use `store: false`. This disables response storage in the API request but is not a claim of zero provider retention; see the provider's applicable data policies.

## Known limitations and risks

AI suggestions can be incorrect, incomplete, or reflect assumptions in a prompt. The app does not have a formal fairness or broad model-quality evaluation, and generated tests cannot establish correctness for all inputs. Account email verification, password recovery, MFA, and account deletion are not implemented. The hosted prototype is not a production deployment; review [production readiness](PRODUCTION_READINESS.md) before relying on it for production use.

## AI impact statement

Code Sherpa AI uses optional AI to help learners turn programming prompts into learning plans, hints, mentor guidance, and suggested tests. The default configured model is OpenAI `gpt-4.1-mini`; deterministic demo behavior is available when AI is off. No training dataset is bundled. Prompts are sent to the model only for opted-in requests; editor code is shared only after a separate consent choice for AI test suggestions. The model does not run or verify code. Test suggestions are labeled unverified, structured responses are checked before display, and requests have size, deadline, concurrency, and budget limits. Learners can run their Python locally in a bounded browser WASI worker and inspect test results. Outputs may still be wrong or incomplete, and passing selected tests does not prove correctness for all inputs. This can lower the barrier to practice while keeping the learner responsible for reviewing and testing suggestions.

## Team

**Cognito**

**Dia Johny** — Frontend and Backend
