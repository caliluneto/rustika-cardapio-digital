-- 3D.5.2-A - NAO EXECUTADO. Como administrador do cluster: fecha a janela do bootstrap (sem login).
-- Execute SEMPRE apos o bootstrap, inclusive se ele falhar.
\set ON_ERROR_STOP on
ALTER ROLE cardapio_homolog_bootstrap NOLOGIN;
\echo 'Janela de bootstrap FECHADA. Em seguida execute 08-bootstrap-revoke.sql como cardapio_homolog_migrator.'
