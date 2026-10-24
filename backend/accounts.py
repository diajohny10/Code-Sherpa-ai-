"""Cookie accounts and self-reported learning progress, never verified results.

Duplicate registration intentionally returns 409 (email enumeration is not
hidden). Scores and XP are client claims, not authorization or correctness.
"""

import hashlib
import hmac
import ipaddress
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError, field_validator
from starlette.responses import JSONResponse

from .ai_provider import ProviderCapacityExceeded, ProviderDeadlineExceeded
from .database import DatabaseUnavailable, DuplicateEmail, RevisionConflict

DEFAULT_ORIGINS = (
    "http://127.0.0.1:5173", "http://localhost:5173",
    "http://127.0.0.1:4173", "http://127.0.0.1:5175",
)
COOKIE_NAME = "sherpa_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
DUMMY_HASH = ("$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$"
              "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
router = APIRouter()


@dataclass(frozen=True)
class AuthSettings:
    origins: tuple[str, ...] = DEFAULT_ORIGINS
    cookie_secure: bool = True

    def __post_init__(self):
        if not isinstance(self.cookie_secure, bool) or not self.origins:
            raise ValueError("Invalid auth settings")
        for origin in self.origins:
            try:
                parsed = urlsplit(origin)
                valid = (parsed.scheme in {"http", "https"} and parsed.hostname and
                         parsed.netloc and not parsed.username and not parsed.password and
                         not parsed.path and not parsed.query and not parsed.fragment and
                         origin == f"{parsed.scheme}://{parsed.netloc}" and
                         not any(character.isspace() for character in origin) and
                         "*" not in origin and parsed.port != 0)
                loopback = parsed.hostname == "localhost"
                if not loopback:
                    try:
                        loopback = ipaddress.ip_address(parsed.hostname).is_loopback
                    except ValueError:
                        loopback = False
                if not valid or (not self.cookie_secure and not loopback):
                    raise ValueError()
            except (ValueError, TypeError):
                raise ValueError("Auth origins must be explicit origins; insecure cookies require loopback origins") from None

    @classmethod
    def from_environ(cls):
        raw = os.environ.get("SHERPA_COOKIE_SECURE", "true").lower()
        if raw not in {"true", "false"}:
            raise ValueError("SHERPA_COOKIE_SECURE must be true or false")
        origins = os.environ.get("SHERPA_AUTH_ORIGINS")
        return cls(tuple(item.strip() for item in origins.split(","))
                   if origins is not None else DEFAULT_ORIGINS, raw == "true")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Credentials(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+", value):
            raise ValueError("Invalid email")
        return value

    @field_validator("password")
    @classmethod
    def password_valid(cls, value):
        if len(value.encode("utf-8")) > 1024:
            raise ValueError("Password too long")
        return value


Identifier = Annotated[str, Field(min_length=1, max_length=200, pattern=r"^[^\x00-\x20\x7f]+$")]
Count = Annotated[int, Field(ge=0, le=1_000_000)]
Score = Annotated[int, Field(ge=0, le=100)]
DateString = Annotated[str, Field(min_length=1, max_length=40)]


def valid_date(value):
    # Keep the persisted contract compatible with browser Date.parse. Python
    # also accepts compact/week ISO forms that JavaScript rejects on hydration.
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?(?:Z|[+-][0-9]{2}:[0-9]{2})", value):
        raise ValueError("Timestamp must use extended ISO 8601 with timezone")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include timezone")
    return value


class HistoryEntry(StrictModel):
    challengeId: Identifier
    kind: Literal["learning", "bug-detective"]
    completedAt: DateString
    score: Score
    hintsUsed: Annotated[int, Field(ge=0, le=100)]
    verifiedTestsPassed: StrictBool

    _date = field_validator("completedAt")(valid_date)

    @field_validator("verifiedTestsPassed")
    @classmethod
    def unverified(cls, value):
        if value:
            raise ValueError("Verified execution claims are not accepted")
        return value


class CoverageEntry(StrictModel):
    challengeId: Identifier
    recordedAt: DateString
    score: Score
    passed: Annotated[int, Field(ge=0, le=200)]
    missing: Annotated[int, Field(ge=0, le=200)]
    untested: Annotated[int, Field(ge=0, le=200)]

    _date = field_validator("recordedAt")(valid_date)


class ProgressState(StrictModel):
    version: Annotated[int, Field(ge=1, le=1)] = 1
    xp: Count = 0
    completedChallengeIds: list[Identifier] = Field(default_factory=list, max_length=1000)
    history: list[HistoryEntry] = Field(default_factory=list, max_length=200)
    coverageResults: list[CoverageEntry] = Field(default_factory=list, max_length=200)
    hintsUsed: Count = 0
    unlockedAchievements: list[Literal[
        "first-challenge", "solved-bug", "no-hints", "clear-explanation",
    ]] = Field(default_factory=list, max_length=4)
    rewardedEvents: list[Identifier] = Field(default_factory=list, max_length=2000)

    @field_validator("rewardedEvents")
    @classmethod
    def no_verified_reward(cls, value):
        if "achievement:passed-tests" in value:
            raise ValueError("Verified execution rewards are not accepted")
        return value


class ProgressWrite(StrictModel):
    progress: ProgressState
    revision: Annotated[int, Field(ge=0, le=2_147_483_646)]


async def parse(request, model):
    try:
        return model.model_validate(await request.json())
    except (ValidationError, ValueError, UnicodeError):
        raise HTTPException(422, "Request contains invalid values.") from None


def token_hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def csrf_token(raw):
    return hmac.new(raw.encode(), b"sherpa-csrf-v1", hashlib.sha256).hexdigest()


def cookie(request):
    raw = request.cookies.get(COOKIE_NAME, "")
    return raw if re.fullmatch(r"[A-Za-z0-9_-]{43}", raw) else ""


def store_for(request):
    store = request.app.state.accounts_store
    if store is None:
        raise HTTPException(503, "Database unavailable.")
    return store


async def database_call(operation, *args):
    try:
        return await operation(*args)
    except DatabaseUnavailable:
        raise HTTPException(503, "Database unavailable.") from None
    except DuplicateEmail:
        raise HTTPException(409, "Email is already registered.") from None
    except RevisionConflict:
        raise HTTPException(409, "Progress revision is stale.") from None


async def authenticated(request, *, csrf=False):
    store = store_for(request)
    raw = cookie(request)
    if not raw:
        raise HTTPException(401, "Invalid or expired session.")
    if csrf:
        supplied = request.headers.get("x-csrf-token", "")
        if not hmac.compare_digest(supplied.encode(), csrf_token(raw).encode()):
            raise HTTPException(403, "Invalid CSRF token.")
    snapshot = await database_call(store.session, token_hash(raw))
    if snapshot is None:
        raise HTTPException(401, "Invalid or expired session.")
    return store, raw, snapshot


def password_work(password, encoded=None):
    from argon2 import PasswordHasher, Type
    from argon2.exceptions import VerificationError

    hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, type=Type.ID)
    if encoded is None:
        return hasher.hash(password)
    try:
        return hasher.verify(encoded, password)
    except VerificationError:
        return False


async def hash_work(request, password, encoded=None):
    try:
        return await request.app.state.auth_runner.run(password_work, password, encoded)
    except ProviderCapacityExceeded:
        raise HTTPException(429, "Authentication capacity is exhausted.",
                            headers={"Retry-After": "1"}) from None
    except ProviderDeadlineExceeded:
        raise HTTPException(503, "Authentication unavailable.") from None


def signed_response(request, raw, snapshot):
    user, progress, revision = snapshot
    response = JSONResponse({"user": user, "csrf_token": csrf_token(raw),
                             "progress": progress, "revision": revision,
                             "database_enabled": True}, headers={"Cache-Control": "no-store"})
    response.set_cookie(COOKIE_NAME, raw, max_age=SESSION_SECONDS,
                        expires=datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS),
                        path="/api", httponly=True, samesite="lax",
                        secure=request.app.state.auth_settings.cookie_secure)
    return response


@router.post("/api/auth/register")
async def register(request: Request):
    store = store_for(request)
    credentials = await parse(request, Credentials)
    encoded = await hash_work(request, credentials.password)
    raw = secrets.token_urlsafe(32)
    snapshot = await database_call(
        store.register, credentials.email, encoded, token_hash(raw),
        datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS),
        token_hash(cookie(request)), ProgressState().model_dump())
    return signed_response(request, raw, snapshot)


@router.post("/api/auth/login")
async def login(request: Request):
    store = store_for(request)
    credentials = await parse(request, Credentials)
    user = await database_call(store.find_user, credentials.email)
    valid = await hash_work(request, credentials.password,
                            user["password_hash"] if user else DUMMY_HASH)
    if not valid or user is None:
        raise HTTPException(401, "Invalid email or password.")
    raw = secrets.token_urlsafe(32)
    snapshot = await database_call(
        store.login, user["id"], token_hash(raw),
        datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS), token_hash(cookie(request)))
    if snapshot is None:
        raise HTTPException(401, "Invalid email or password.")
    return signed_response(request, raw, snapshot)


@router.get("/api/auth/session")
async def session(request: Request):
    store = request.app.state.accounts_store
    raw = cookie(request)
    snapshot = await database_call(store.session, token_hash(raw)) if store and raw else None
    if snapshot is None:
        return {"user": None, "csrf_token": None, "progress": None, "revision": None,
                "database_enabled": store is not None}
    user, progress, revision = snapshot
    return {"user": user, "csrf_token": csrf_token(raw), "progress": progress,
            "revision": revision, "database_enabled": True}


@router.post("/api/auth/logout")
async def logout(request: Request):
    store, raw, _ = await authenticated(request, csrf=True)
    await parse(request, StrictModel)
    await database_call(store.logout, token_hash(raw))
    response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
    response.delete_cookie(COOKIE_NAME, path="/api", httponly=True, samesite="lax",
                           secure=request.app.state.auth_settings.cookie_secure)
    return response


@router.get("/api/progress")
async def get_progress(request: Request):
    _, _, (_, progress, revision) = await authenticated(request)
    return {"progress": progress, "revision": revision}


@router.put("/api/progress")
async def put_progress(request: Request):
    store, raw, _ = await authenticated(request, csrf=True)
    body = await parse(request, ProgressWrite)
    result = await database_call(store.save_progress, token_hash(raw),
                                 body.progress.model_dump(), body.revision)
    if result is None:
        raise HTTPException(401, "Invalid or expired session.")
    progress, revision = result
    return {"progress": progress, "revision": revision}