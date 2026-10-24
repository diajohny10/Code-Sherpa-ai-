"""Verified hosted PostgreSQL connections; local loopback remains optional TLS."""

import ipaddress
import os
import ssl
from urllib.parse import parse_qs, urlsplit


def connection_options(dsn: str) -> dict:
    # Never include DSNs, usernames or passwords in validation messages.
    try:
        parsed = urlsplit(dsn)
        host = parsed.hostname
        # asyncpg splits at the first @; urllib splits at the last. Reject
        # ambiguous credentials before a misleading DNS request is attempted.
        if parsed.netloc.count("@") > 1 or parsed.fragment:
            raise ValueError()
        if parsed.scheme not in {"postgres", "postgresql"} or not host or not parsed.path.lstrip("/"):
            raise ValueError()
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            raise ValueError()
        local = host == "localhost"
        if not local:
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local = False
        query = parse_qs(parsed.query, keep_blank_values=True)
        if {"sslrootcert", "sslcrl", "sslcrldir", "sslcert", "sslkey", "sslpassword"}.intersection(query):
            raise ValueError()
        modes = query.get("sslmode", [])
        if len(modes) > 1:
            raise ValueError()
        mode = modes[0] if modes else None
        if mode not in {None, "disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
            raise ValueError()
        if not local and mode in {"disable", "allow", "prefer"}:
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("Invalid database connection configuration; hosted databases require verified TLS.") from None

    options = {"timeout": 5, "command_timeout": 5, "statement_cache_size": 0}
    if local and mode in {None, "disable"}:
        options["ssl"] = False
    else:
        context = ssl.create_default_context()
        certificate = os.environ.get("SHERPA_DATABASE_CA_FILE")
        if certificate:
            context.load_verify_locations(cafile=certificate)
        # Explicit context overrides weaker DSN SSL options. Never use an
        # unverified context to work around a missing provider certificate.
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        options["ssl"] = context
    return options