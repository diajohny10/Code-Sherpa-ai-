-- OPTIONAL: run as the migration owner AFTER python -m backend.migrate.
-- This creates a non-login server role only. Set its login password privately
-- in your admin session before using it; never commit or share that password.
-- This is NOT a browser/API role and does not use Supabase Auth JWT identities.
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sherpa_backend') THEN
        RAISE EXCEPTION 'sherpa_backend already exists; audit it manually instead of reusing unknown privileges or memberships';
    END IF;
    CREATE ROLE sherpa_backend NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
        NOINHERIT NOBYPASSRLS;
END
$$;

GRANT USAGE ON SCHEMA sherpa_private TO sherpa_backend;
GRANT SELECT, INSERT ON sherpa_private.users TO sherpa_backend;
GRANT SELECT, INSERT, DELETE ON sherpa_private.sessions TO sherpa_backend;
GRANT SELECT, INSERT, UPDATE ON sherpa_private.progress TO sherpa_backend;

CREATE POLICY sherpa_server_read ON sherpa_private.users FOR SELECT TO sherpa_backend USING (true);
CREATE POLICY sherpa_server_insert ON sherpa_private.users FOR INSERT TO sherpa_backend WITH CHECK (true);

CREATE POLICY sherpa_server_read ON sherpa_private.sessions FOR SELECT TO sherpa_backend USING (true);
CREATE POLICY sherpa_server_insert ON sherpa_private.sessions FOR INSERT TO sherpa_backend WITH CHECK (true);
CREATE POLICY sherpa_server_delete ON sherpa_private.sessions FOR DELETE TO sherpa_backend USING (true);

CREATE POLICY sherpa_server_read ON sherpa_private.progress FOR SELECT TO sherpa_backend USING (true);
CREATE POLICY sherpa_server_insert ON sherpa_private.progress FOR INSERT TO sherpa_backend WITH CHECK (true);
CREATE POLICY sherpa_server_update ON sherpa_private.progress FOR UPDATE TO sherpa_backend USING (true) WITH CHECK (true);
COMMIT;