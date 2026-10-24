"""Server execution boundary; browser CPython WASI is a separate frontend feature.

This API stays fail-closed. Never evaluate learner source in the web process.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool = False


class IsolatedExecutor(Protocol):
    """Contract for a future external, isolated execution service."""

    async def execute(self, source: str, stdin: str = "") -> ExecutionResult: ...


class SandboxNotConfigured(RuntimeError):
    pass


class UnavailableExecutor:
    """Default implementation fails closed; it never evaluates source code."""

    async def execute(self, source: str, stdin: str = "") -> ExecutionResult:
        raise SandboxNotConfigured(
            "Code execution is disabled until an isolated sandbox is configured."
        )
