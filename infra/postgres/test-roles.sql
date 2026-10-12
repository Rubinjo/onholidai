-- Disposable CI/local test cluster only. These are synthetic credentials.
CREATE ROLE onholidai_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD 'synthetic-migration';
CREATE ROLE onholidai_web LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD 'synthetic-web';
CREATE ROLE onholidai_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  PASSWORD 'synthetic-worker';
CREATE ROLE onholidai_test_untrusted NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
