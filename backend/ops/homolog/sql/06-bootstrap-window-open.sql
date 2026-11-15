-- NAO EXECUTADO. Como administrador do cluster: abre a janela do bootstrap (login da role). Feche com 07.
\set ON_ERROR_STOP on
ALTER ROLE cardapio_homolog_bootstrap LOGIN;
\echo 'Janela de bootstrap ABERTA. Execute o comando de bootstrap e, em seguida, 07-bootstrap-window-close.sql.'
