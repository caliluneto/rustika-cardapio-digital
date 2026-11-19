-- RF004 2.3C.2: SQL incremental preparado offline contra 20261023000000_initial_schema.
-- A aplicação deve permanecer parada durante qualquer aplicação futura autorizada.
-- Nenhuma linha legada é apagada ou promovida automaticamente para AVAILABLE.
-- Se houver pedidos preexistentes, o SQL falha sem aplicar o novo schema.

BEGIN;
LOCK TABLE "orders" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "orders") THEN
        RAISE EXCEPTION 'RF004 exige orders vazia: pedidos legados requerem outra estratégia antes desta migration'
            USING ERRCODE = '23514';
    END IF;
END
$$;

CREATE TYPE "product_availability" AS ENUM ('UNKNOWN', 'AVAILABLE', 'UNAVAILABLE');
CREATE TYPE "comanda_status" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

ALTER TABLE "categories" ADD COLUMN "public_key" VARCHAR(64);

ALTER TABLE "products"
    ADD COLUMN "public_key" VARCHAR(80),
    ADD COLUMN "source_code" VARCHAR(64),
    ADD COLUMN "source_name" TEXT,
    ADD COLUMN "source_group" TEXT,
    ADD COLUMN "description_source" TEXT,
    ADD COLUMN "image_alt" TEXT,
    ADD COLUMN "availability_state" "product_availability" NOT NULL DEFAULT 'UNKNOWN';

-- As colunas antigas permanecem e seus valores existentes são preservados.
ALTER TABLE "orders"
    ALTER COLUMN "tracking_token_hash" DROP NOT NULL,
    ALTER COLUMN "customer_name" DROP NOT NULL,
    ALTER COLUMN "table_or_reference" DROP NOT NULL,
    ADD COLUMN "request_digest" CHAR(64) NOT NULL,
    ADD COLUMN "comanda_id" UUID NOT NULL,
    ADD COLUMN "session_id" UUID NOT NULL;

ALTER TABLE "order_items" ADD COLUMN "product_public_key_snapshot" VARCHAR(80);

CREATE TABLE "comandas" (
    "id" UUID NOT NULL,
    "number" VARCHAR(6) NOT NULL,
    "status" "comanda_status" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    CONSTRAINT "comandas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comandas_number_format" CHECK ("number" ~ '^[0-9]{1,6}$'),
    CONSTRAINT "comandas_status_closed_at_consistent" CHECK (
        ("status" = 'OPEN' AND "closed_at" IS NULL) OR
        ("status" IN ('CLOSED', 'CANCELLED') AND "closed_at" IS NOT NULL AND "closed_at" >= "opened_at")
    )
);

CREATE TABLE "comanda_invitations" (
    "id" UUID NOT NULL,
    "comanda_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "issued_by_admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "comanda_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comanda_invitations_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "comanda_invitations_times_valid" CHECK (
        "expires_at" > "created_at" AND
        ("consumed_at" IS NULL OR "consumed_at" >= "created_at") AND
        ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
    )
);

CREATE TABLE "comanda_sessions" (
    "id" UUID NOT NULL,
    "comanda_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "credential_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    CONSTRAINT "comanda_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comanda_sessions_credential_hash_format" CHECK ("credential_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "comanda_sessions_times_valid" CHECK (
        "expires_at" > "created_at" AND
        ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
    )
);

-- Chaves públicas opcionais preservam registros antigos até reconciliação aprovada.
ALTER TABLE "categories" ADD CONSTRAINT "categories_public_key_format"
    CHECK ("public_key" IS NULL OR "public_key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "products" ADD CONSTRAINT "products_source_identity_consistent" CHECK (
    ("public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL)
    OR
    ("public_key" IS NOT NULL AND "source_code" IS NOT NULL AND "source_code" ~ '^[0-9]+$'
      AND "source_name" IS NOT NULL AND length(btrim("source_name")) > 0
      AND "source_group" IS NOT NULL AND length(btrim("source_group")) > 0
      AND "public_key" = 'rustika-' || "source_code")
);

ALTER TABLE "products" ADD CONSTRAINT "products_available_price_positive"
    CHECK ("availability_state" <> 'AVAILABLE' OR "price" > 0);

-- Todo pedido exige vínculos e digest; o banco precisa estar vazio antes desta alteração.
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_scope_consistent" CHECK (
    "request_digest" ~ '^[0-9a-f]{64}$' AND "idempotency_key" ~ '^[0-9a-f]{64}$'
);

CREATE UNIQUE INDEX "categories_public_key_key" ON "categories"("public_key");
CREATE UNIQUE INDEX "products_public_key_key" ON "products"("public_key");
CREATE UNIQUE INDEX "products_source_code_key" ON "products"("source_code");
CREATE INDEX "products_is_active_availability_state_idx" ON "products"("is_active", "availability_state");
CREATE UNIQUE INDEX "comandas_number_key" ON "comandas"("number");
CREATE UNIQUE INDEX "comanda_invitations_token_hash_key" ON "comanda_invitations"("token_hash");
CREATE UNIQUE INDEX "comanda_invitations_id_comanda_id_key" ON "comanda_invitations"("id", "comanda_id");
CREATE INDEX "comanda_invitations_comanda_id_expires_at_idx" ON "comanda_invitations"("comanda_id", "expires_at");
CREATE INDEX "comanda_invitations_issued_by_admin_id_idx" ON "comanda_invitations"("issued_by_admin_id");
CREATE UNIQUE INDEX "comanda_sessions_invitation_id_key" ON "comanda_sessions"("invitation_id");
CREATE UNIQUE INDEX "comanda_sessions_invitation_id_comanda_id_key" ON "comanda_sessions"("invitation_id", "comanda_id");
CREATE UNIQUE INDEX "comanda_sessions_credential_hash_key" ON "comanda_sessions"("credential_hash");
CREATE UNIQUE INDEX "comanda_sessions_id_comanda_id_key" ON "comanda_sessions"("id", "comanda_id");
CREATE INDEX "comanda_sessions_comanda_id_expires_at_idx" ON "comanda_sessions"("comanda_id", "expires_at");
CREATE INDEX "orders_session_id_created_at_id_idx" ON "orders"("session_id", "created_at", "id");

ALTER TABLE "comanda_invitations" ADD CONSTRAINT "comanda_invitations_comanda_id_fkey"
    FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "comanda_invitations" ADD CONSTRAINT "comanda_invitations_issued_by_admin_id_fkey"
    FOREIGN KEY ("issued_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "comanda_sessions" ADD CONSTRAINT "comanda_sessions_comanda_id_fkey"
    FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "comanda_sessions" ADD CONSTRAINT "comanda_sessions_invitation_id_comanda_id_fkey"
    FOREIGN KEY ("invitation_id", "comanda_id") REFERENCES "comanda_invitations"("id", "comanda_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_comanda_id_fkey"
    FOREIGN KEY ("comanda_id") REFERENCES "comandas"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_comanda_id_fkey"
    FOREIGN KEY ("session_id", "comanda_id") REFERENCES "comanda_sessions"("id", "comanda_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Manter SELECT/INSERT legados para a criação transacional; impedir UPDATE/DELETE
-- direto de pedidos, snapshots e histórico pela aplicação nesta onda.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
    ON TABLE "orders", "order_items", "order_status_history"
    FROM cardapio_test_app, cardapio_dev_app, PUBLIC;

-- Menor privilégio: não habilitar emissão de convites, sessões ou comandas nesta onda.
-- Default ACLs do migrator podem conceder permissões sobre novas tabelas: revogar explicitamente.
REVOKE ALL PRIVILEGES ON TABLE "comandas", "comanda_invitations", "comanda_sessions"
    FROM cardapio_test_app, cardapio_dev_app, PUBLIC;
-- A tabela de controle de migrações permanece inacessível às roles de aplicação.
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations"
    FROM cardapio_test_app, cardapio_dev_app, PUBLIC;
-- Revisar grants herdados de roles de grupo e default ACLs antes de liberar a aplicação.

-- Bloco separável: apenas amplia o enum para coincidir com os contratos TypeScript.
-- Sem autenticação administrativa futura, nenhuma operação de cancelamento é autorizada.
-- O valor novo não é utilizado por comandos desta migration.
ALTER TYPE "order_status" ADD VALUE 'CANCELLED';
COMMIT;
