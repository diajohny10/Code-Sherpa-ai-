CREATE SCHEMA sherpa_private;

ALTER TABLE public.users SET SCHEMA sherpa_private;
ALTER TABLE public.sessions SET SCHEMA sherpa_private;
ALTER TABLE public.progress SET SCHEMA sherpa_private;

-- The migrator/table owner retains its normal RLS bypass. A dedicated server
-- runtime role needs explicit grants and policies; clients receive no policies.
ALTER TABLE sherpa_private.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sherpa_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sherpa_private.progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sherpa_schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA sherpa_private FROM PUBLIC;
REVOKE ALL ON TABLE sherpa_private.users, sherpa_private.sessions,
    sherpa_private.progress, public.sherpa_schema_migrations FROM PUBLIC;

DO $$
DECLARE
    api_role TEXT;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON SCHEMA sherpa_private FROM %I', api_role);
            EXECUTE format(
                'REVOKE ALL ON TABLE sherpa_private.users, sherpa_private.sessions, '
                'sherpa_private.progress, public.sherpa_schema_migrations FROM %I',
                api_role);
        END IF;
    END LOOP;
END
$$;