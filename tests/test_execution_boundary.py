import unittest

from backend.execution import SandboxNotConfigured, UnavailableExecutor


class UnavailableExecutorTests(unittest.TestCase):
    def test_submitted_source_is_rejected_when_sandbox_is_not_configured(self):
        executor = UnavailableExecutor()

        with self.assertRaisesRegex(SandboxNotConfigured, "isolated sandbox"):
            # The default implementation raises before its first await. Advancing
            # that coroutine directly avoids needing to start an event loop.
            executor.execute("print('this must never run')").send(None)


if __name__ == "__main__":
    unittest.main()
