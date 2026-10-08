-- Cria o banco PRÓPRIO do DBM (spec §0.14, §0.16).
-- Rode como superusuário do Postgres:
--   sudo -u postgres psql -f dev/criar-banco.sql
--
-- As tabelas são criadas pelo Flyway ao subir a aplicação.

DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'astral_dbm') THEN
      CREATE ROLE astral_dbm LOGIN PASSWORD 'astral_dbm';
   END IF;
END
$$;

-- CREATE DATABASE não roda dentro de bloco/transação: use \gexec.
SELECT 'CREATE DATABASE astral_dbm OWNER astral_dbm'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'astral_dbm')\gexec

GRANT ALL PRIVILEGES ON DATABASE astral_dbm TO astral_dbm;