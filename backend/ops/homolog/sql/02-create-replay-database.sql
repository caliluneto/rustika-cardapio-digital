-- 3D.5.2-A - NAO EXECUTADO. Via psql, como administrador do cluster de HOMOLOGACAO, conectado ao banco postgres, apos 01.
-- Cria o banco TRANSITORIO de replay (nome exigido pelas guardas das migrations historicas). Ele deixa de existir com este nome em 04.
-- Recusa sobrescrever; nao ha DROP em nenhum script deste procedimento.
\set ON_ERROR_STOP on
SELECT (EXISTS (SELECT 1 FROM pg_database WHERE datname IN ('cardapio_digital_test', 'cardapio_digital_homolog', 'cardapio_digital_dev', 'cardapio_digital_shadow'))
        OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker')) AS refuse \gset
\if :refuse
  \echo 'ABORT: ja existe banco cardapio_digital_* neste cluster ou o cluster nao foi preparado pelo script 01.'
  \quit
\endif
CREATE DATABASE cardapio_digital_test OWNER cardapio_migrator ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40;
REVOKE ALL ON DATABASE cardapio_digital_test FROM PUBLIC;
GRANT CONNECT ON DATABASE cardapio_digital_test TO cardapio_migrator, cardapio_test_app, cardapio_homolog_bootstrap;
\echo 'Banco de replay criado vazio. Proximo passo: npm run homolog:replay:status / homolog:replay:deploy (perfil migrate-homolog-replay).'
