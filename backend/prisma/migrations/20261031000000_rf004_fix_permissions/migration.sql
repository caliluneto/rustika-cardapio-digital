-- Correção de Permissões (Entrega 3C.3)
-- Corrige o acesso da aplicação aos objetos gerados pela migration anterior.

BEGIN;

DO $$
DECLARE
    target_role VARCHAR;
    current_db VARCHAR := current_database();
BEGIN
    IF current_db = 'cardapio_digital_dev' THEN
        target_role := 'cardapio_dev_app';
    ELSIF current_db = 'cardapio_digital_test' THEN
        target_role := 'cardapio_test_app';
    ELSE
        RAISE EXCEPTION 'Acesso negado: banco desconhecido %', current_db;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
        RAISE EXCEPTION 'Role % nao encontrada no banco %', target_role, current_db;
    END IF;

    -- USAGE on schema public
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', target_role);

    -- Permissões de SELECT e INSERT para tabelas de catálogo e sessão, com os direitos necessários do fluxo
    EXECUTE format('GRANT SELECT ON TABLE "admins", "categories", "products" TO %I', target_role);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE "orders", "order_items", "order_status_history", "comanda_sessions" TO %I', target_role);

    -- Permissões extras em comandas e convites por causa do upsert/updateMany do comandaAccess.service.ts
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE "comandas", "comanda_invitations" TO %I', target_role);

    -- Acesso as sequences obrigatórias para funcionamento do autoincrement (ex: orders_order_number_seq)
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE "orders_order_number_seq" TO %I', target_role);

END
$$;

COMMIT;
