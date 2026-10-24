"""FastAPI service for the Code Sherpa AI learning workflow."""

import math
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool

from .accounts import AuthSettings, router as accounts_router
from .database import DatabaseUnavailable, PostgresAccountsStore

from .ai_provider import (
    InvalidProviderResponse,
    LearningProviderError,
    ProviderBudgetExceeded,
    ProviderCapacityExceeded,
    ProviderDeadlineExceeded,
    ProviderTaskRunner,
    create_hints_safely,
    create_mentor_safely,
    create_plan_safely,
    create_test_cases_safely,
    select_provider,
)
from .execution import SandboxNotConfigured, UnavailableExecutor
from .security import AdmissionLimits, AdmissionMiddleware, AuthCORSMiddleware, ClientRateLimiter

router = APIRouter()
executor = UnavailableExecutor()


def nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("Value must not be blank")
    return value


Requirement = Annotated[str, Field(min_length=1, max_length=500), AfterValidator(nonblank)]
TestResult = Annotated[str, Field(min_length=1, max_length=300), AfterValidator(nonblank)]


class CodeSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=20_000)
    stdin: str = Field(default="", max_length=2_000)


class LearningPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: Annotated[str, Field(min_length=1, max_length=4_000), AfterValidator(nonblank)]
    use_ai: StrictBool = False


class TestCaseRequest(LearningPrompt):
    source: str = Field(default="", max_length=20_000)


class HintRequest(LearningPrompt):
    requirements: list[Requirement] = Field(default_factory=list, max_length=12)


class MentorRequest(HintRequest):
    test_results: list[TestResult] = Field(default_factory=list, max_length=12)
    challenge: str = Field(default="", max_length=1_000)
    learner_text: str = Field(default="", max_length=2_000)
    question: Annotated[str, Field(min_length=1, max_length=1_200), AfterValidator(nonblank)]


async def call_provider(http_request: Request, use_ai: bool, operation, *args):
    limits = http_request.app.state.admission_limits
    paid = use_ai and limits.enable_paid_ai

    def work():
        # Selection happens only after rate/body/schema, capacity, and budget
        # admission. Untrusted use_ai alone never enables a configured key.
        provider = select_provider(paid)
        return provider.mode, operation(provider, *args)

    try:
        return await http_request.app.state.provider_runner.run(work, paid=paid)
    except ProviderCapacityExceeded as exc:
        raise HTTPException(429, "Provider capacity is exhausted.", headers={"Retry-After": "1"}) from exc
    except ProviderBudgetExceeded as exc:
        raise HTTPException(429, "AI request budget is exhausted.", headers={
            "Retry-After": str(math.ceil(limits.paid_window_seconds)),
        }) from exc
    except ProviderDeadlineExceeded as exc:
        raise HTTPException(504, "Learning provider deadline exceeded.") from exc
    except InvalidProviderResponse as exc:
        raise HTTPException(502, "Learning provider returned invalid data.") from exc
    except ValueError as exc:
        raise HTTPException(422, "Learning request contains invalid values.") from exc
    except LearningProviderError as exc:
        raise HTTPException(502, "Learning provider request failed.") from exc


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "execution": "disabled"}


@router.get("/api/ai/status")
async def ai_status(http_request: Request, response: Response) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    configured = bool(key)
    enabled = http_request.app.state.admission_limits.enable_paid_ai
    model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini").strip()
    if (not re.fullmatch(r"(?:gpt-|chatgpt-|o[1-9])[A-Za-z0-9._-]{1,95}", model)
            or "sk-" in model.lower() or (key and key in model)):
        model = "gpt-4.1-mini"
    return {"provider": "openai", "configured": configured, "enabled": enabled,
            "available": configured and enabled, "model": model,
            "code_execution": "disabled"}


@router.get("/api/challenges/prime")
async def prime_challenge() -> dict[str, object]:
    return {
        "id": "prime-number-checker",
        "title": "Prime number checker",
        "mode": "deterministic-demo",
        "prompt": "Write a function that returns True if a number is prime, and False otherwise.",
        "requirements": [
            "Return False for numbers less than 2",
            "Return False when a divisor is found",
            "Return True when no divisor exists",
            "Handle 2 as a prime number",
        ],
        "execution_enabled": False,
    }


@router.post("/api/learning/plan")
async def learning_plan(request: LearningPrompt, http_request: Request) -> dict[str, object]:
    """Return validated requirements and suggested cases; never execute code."""
    mode, plan = await call_provider(http_request, request.use_ai, create_plan_safely, request.prompt)
    return {"mode": mode, "ai_unavailable": request.use_ai and mode != "openai",
            "results_are_suggestions": True,
            "code_execution": "disabled", **plan.as_dict()}


@router.post("/api/learning/test-cases")
async def learning_test_cases(request: TestCaseRequest, http_request: Request) -> dict[str, object]:
    """Suggest cases using optional source as data; never execute learner code."""
    mode, plan = await call_provider(http_request, request.use_ai, create_test_cases_safely,
                                     request.prompt, request.source)
    return {"mode": mode, "ai_unavailable": request.use_ai and mode != "openai",
            "results_are_suggestions": True, "code_execution": "disabled",
            "source_used_for_suggestions": bool(request.source.strip()) and mode == "openai",
            **plan.as_dict()}


@router.post("/api/learning/hints")
async def progressive_hints(request: HintRequest, http_request: Request) -> dict[str, object]:
    """Return an ordered hint list; the client should reveal one item at a time."""
    mode, hints = await call_provider(http_request, request.use_ai, create_hints_safely,
                                      request.prompt, request.requirements)
    return {"mode": mode, "ai_unavailable": request.use_ai and mode != "openai",
            "reveal_policy": "one-at-a-time",
            "code_execution": "disabled", "hints": hints.hints}


@router.post("/api/learning/mentor")
async def mentor_reply(request: MentorRequest, http_request: Request) -> dict[str, object]:
    """Return contextual teaching guidance; it accepts no source code to run."""
    context = {"prompt": request.prompt, "requirements": request.requirements,
               "test_results": request.test_results, "challenge": request.challenge,
               "learner_text": request.learner_text}
    mode, reply = await call_provider(http_request, request.use_ai, create_mentor_safely,
                                      context, request.question)
    return {"mode": mode, "ai_unavailable": request.use_ai and mode != "openai",
            "code_execution": "disabled", "message": reply.message,
            "guiding_question": reply.guiding_question, "hints": reply.hints}


@router.post("/api/execute")
async def execute_code(submission: CodeSubmission) -> dict[str, str]:
    """Fail closed. Never run learner code in the FastAPI process."""
    try:
        await executor.execute(submission.source, submission.stdin)
    except SandboxNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    raise HTTPException(status_code=503, detail="No isolated executor is configured.")


def create_app(limits: AdmissionLimits | None = None, *, clock=time.monotonic,
               accounts_store=None, auth_settings: AuthSettings | None = None) -> FastAPI:
    limits = AdmissionLimits.from_environ() if limits is None else limits
    auth_settings = AuthSettings.from_environ() if auth_settings is None else auth_settings
    if accounts_store is None and os.environ.get("SHERPA_DATABASE_URL"):
        accounts_store = PostgresAccountsStore(os.environ["SHERPA_DATABASE_URL"])
    auth_runner = ProviderTaskRunner(max_concurrency=2, timeout_seconds=5)
    runner = ProviderTaskRunner(
        max_concurrency=limits.provider_concurrency,
        timeout_seconds=limits.provider_timeout_seconds,
        paid_request_limit=limits.paid_requests_per_window,
        paid_window_seconds=limits.paid_window_seconds,
        clock=clock,
    )

    @asynccontextmanager
    async def lifespan(application):
        try:
            if accounts_store is not None:
                try:
                    await accounts_store.start()
                except DatabaseUnavailable:
                    pass
            yield
        finally:
            runner.shutdown()
            auth_runner.shutdown()
            if accounts_store is not None:
                await accounts_store.close()

    application = FastAPI(title="Code Sherpa AI", version="0.1.0", lifespan=lifespan)
    application.state.admission_limits = limits
    application.state.provider_runner = runner
    application.state.auth_runner = auth_runner
    application.state.accounts_store = accounts_store
    application.state.auth_settings = auth_settings
    application.add_middleware(AdmissionMiddleware, limits=limits,
                               limiter=ClientRateLimiter(limits, clock),
                               auth_origins=auth_settings.origins)
    application.add_middleware(AuthCORSMiddleware, allow_origins=list(auth_settings.origins),
                               allow_credentials=True, allow_methods=["GET", "POST", "PUT"],
                               allow_headers=["Content-Type", "X-CSRF-Token"])
    application.include_router(router)
    application.include_router(accounts_router)
    return application


app = create_app()
