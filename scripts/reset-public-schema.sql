-- Wipe public schema (use once on Railway when migrations are stuck). No production data only.
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO public;
