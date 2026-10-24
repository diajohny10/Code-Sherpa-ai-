"""Check the loopback Supabase preview without cookies or credential output."""

import json
import urllib.request
from pathlib import Path


def main():
    checks = {}
    targets = {
        "backend_health": "http://127.0.0.1:18000/api/health",
        "backend_session": "http://127.0.0.1:18000/api/auth/session",
        "frontend": "http://127.0.0.1:5176/",
        "frontend_session_proxy": "http://127.0.0.1:5176/api/auth/session",
        "openai_configuration": "http://127.0.0.1:5176/api/ai/status",
    }
    for name, url in targets.items():
        try:
            with urllib.request.urlopen(url, timeout=8) as response:
                entry = {"status": response.status}
                body = response.read(200_000)
                if name.endswith("session") or name.endswith("proxy"):
                    entry["database_enabled"] = json.loads(body).get("database_enabled") is True
                if name == "openai_configuration":
                    status = json.loads(body)
                    entry.update({key: status.get(key) is True
                                  for key in ("configured", "enabled", "available")})
                checks[name] = entry
        except Exception as error:
            checks[name] = {"error_type": type(error).__name__}
    output = Path(__file__).resolve().parent.parent / "verification" / "preview-http.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
    print("PREVIEW_HTTP=" + json.dumps(checks))
    raise SystemExit(0 if all(item.get("status") == 200 for item in checks.values()) else 1)


if __name__ == "__main__":
    main()
