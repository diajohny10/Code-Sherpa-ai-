"""Dependency-free, process-local admission controls for the HTTP boundary.

Use one application worker, or enforce aggregate limits at a trusted gateway.
Peer addresses come from ASGI, never directly from forwarding headers here.
"""

import asyncio
import math
import os
import threading
import time
from collections import deque
from dataclasses import dataclass, fields, replace

from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class AuthCORSMiddleware(CORSMiddleware):
    def preflight_response(self, request_headers):
        response = super().preflight_response(request_headers)
        response.headers["Cache-Control"] = "no-store"
        return response


@dataclass(frozen=True)
class AdmissionLimits:
    body_bytes: int = 65_536
    body_timeout_seconds: float = 5.0
    requests_per_window: int = 20
    rate_window_seconds: float = 60.0
    max_tracked_clients: int = 4096
    provider_concurrency: int = 4
    provider_timeout_seconds: float = 20.0
    paid_requests_per_window: int = 100
    paid_window_seconds: float = 86_400.0
    enable_paid_ai: bool = False
    auth_requests_per_window: int = 5
    auth_rate_window_seconds: float = 60.0

    def __post_init__(self):
        for field in fields(self):
            value = getattr(self, field.name)
            if field.name == "enable_paid_ai":
                if not isinstance(value, bool):
                    raise ValueError("enable_paid_ai must be a boolean")
            elif field.name.endswith("seconds"):
                if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                        not math.isfinite(value) or value <= 0):
                    raise ValueError(f"{field.name} must be finite and positive")
            elif isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{field.name} must be a positive integer")

    @classmethod
    def from_environ(cls):
        """Invalid deployment configuration fails startup, never fails open."""
        values = {}
        for field in fields(cls):
            raw = os.environ.get(f"SHERPA_{field.name.upper()}")
            if raw is None:
                continue
            if field.name == "enable_paid_ai":
                if raw.lower() not in {"true", "false"}:
                    raise ValueError("SHERPA_ENABLE_PAID_AI must be true or false")
                values[field.name] = raw.lower() == "true"
            else:
                values[field.name] = float(raw) if field.name.endswith("seconds") else int(raw)
        return cls(**values)


class ClientRateLimiter:
    """A bounded sliding-window map shared across all learning endpoints.

    At map capacity reject unknown peers rather than evicting live quotas (which
    would permit bypass by cycling source addresses). Attempts are not refunded.
    """

    def __init__(self, limits: AdmissionLimits, clock=time.monotonic):
        self.limits = limits
        self.clock = clock
        self._clients = {}
        self._lock = threading.Lock()

    def retry_after(self, client: str) -> int | None:
        with self._lock:
            now = self.clock()
            cutoff = now - self.limits.rate_window_seconds
            history = self._clients.get(client)
            if history is None:
                if len(self._clients) >= self.limits.max_tracked_clients:
                    expired = [key for key, entries in self._clients.items()
                               if entries[-1] <= cutoff]
                    for key in expired:
                        del self._clients[key]
                if len(self._clients) >= self.limits.max_tracked_clients:
                    return max(1, math.ceil(self.limits.rate_window_seconds))
                history = self._clients[client] = deque()
            while history and history[0] <= cutoff:
                history.popleft()
            if len(history) >= self.limits.requests_per_window:
                return max(1, math.ceil(history[0] + self.limits.rate_window_seconds - now))
            history.append(now)
            return None


class AdmissionMiddleware:
    """Check quotas and buffer at most body_bytes before FastAPI parses JSON.

    Counting actual received bytes also covers chunked requests and forged or
    absent Content-Length headers. Body reading has its own total deadline.
    """

    LEARNING_PATHS = frozenset({
        "/api/learning/plan", "/api/learning/hints", "/api/learning/mentor",
        "/api/learning/test-cases",
    })

    def __init__(self, app: ASGIApp, *, limits: AdmissionLimits,
                 limiter: ClientRateLimiter, auth_origins=()):
        self.app = app
        self.limits = limits
        self.limiter = limiter
        self.auth_origins = frozenset(auth_origins)
        self.auth_limiter = ClientRateLimiter(replace(
            limits, requests_per_window=limits.auth_requests_per_window,
            rate_window_seconds=limits.auth_rate_window_seconds), limiter.clock)

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def reject(status, detail, headers=None):
            await JSONResponse({"detail": detail}, status_code=status,
                               headers=headers)(scope, receive, send)

        # All methods and both demo/AI requests share this quota. A client cannot
        # obtain another quota by changing endpoints or toggling use_ai.
        path = scope["path"]
        root = scope.get("root_path", "")
        # Match Starlette's mount/root_path semantics; do not strip a merely
        # similar prefix (e.g. /sherpa must not strip /sherpa-other).
        if root and (path == root or path.startswith(root + "/")):
            path = path[len(root):]
        path = path.rstrip("/")
        account_path = path.startswith("/api/auth/") or path == "/api/progress"
        if account_path:
            original_send = send

            async def no_store_send(message):
                if message["type"] == "http.response.start":
                    message = dict(message)
                    message["headers"] = [(key, value) for key, value in message["headers"]
                                          if key.lower() != b"cache-control"] + [
                                              (b"cache-control", b"no-store")]
                await original_send(message)

            send = no_store_send
            if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
                origins = [value.decode("latin-1") for key, value in scope.get("headers", [])
                           if key.lower() == b"origin"]
                if len(origins) != 1 or origins[0] not in self.auth_origins:
                    return await reject(403, "Origin is not allowed.")
            if path in {"/api/auth/login", "/api/auth/register"}:
                peer = scope.get("client")
                retry = self.auth_limiter.retry_after(peer[0] if peer else "unknown")
                if retry is not None:
                    return await reject(429, "Authentication request rate limit exceeded.",
                                        {"Retry-After": str(retry)})
        if path.rstrip("/") in self.LEARNING_PATHS:
            peer = scope.get("client")
            retry = self.limiter.retry_after(peer[0] if peer else "unknown")
            if retry is not None:
                return await reject(429, "Learning request rate limit exceeded.",
                                    {"Retry-After": str(retry)})

        lengths = [value for key, value in scope.get("headers", [])
                   if key.lower() == b"content-length"]
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit():
                return await reject(400, "Invalid Content-Length.")
            if len(lengths[0]) > 20 or int(lengths[0]) > self.limits.body_bytes:
                return await reject(413, "Request body exceeds the byte limit.")

        body = bytearray()
        try:
            async with asyncio.timeout(self.limits.body_timeout_seconds):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    if message["type"] != "http.request":
                        continue
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > self.limits.body_bytes:
                        return await reject(413, "Request body exceeds the byte limit.")
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
        except TimeoutError:
            return await reject(408, "Request body deadline exceeded.")

        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
