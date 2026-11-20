# RÚSTIKA — ENTREGA 3D.3.17-PREFLIGHT

## Pré-voo para Aplicação das Migrations no PostgreSQL Test

### 1. Identidade do destino
- **Cluster**: PostgreSQL 18.6
- **Host/Porta**: 127.0.0.1:5432
- **Banco de Destino**: `cardapio_digital_test`
- **Role de Conexão e Migração**: `cardapio_migrator`
- **Tabelas de Negócio**: Atualmente vazias (0 registros confirmados nas tabelas inspecionadas).
- **Sessões concorrentes**: Nenhuma (0 PID concorrente conectado ao Test).

### 2. Histórico Prisma
- **Migration Aplicada**:
  - `20261023000000_initial_schema`
- **Migrations Pendentes (nesta ordem)**:
  1. `20261027000000_rf004_comandas_catalogo_pedidos`
  2. `20261031000000_rf004_fix_permissions`
  3. `20261102000000_update_products_source_identity_constraint`
  4. `20261104000000_runtime_least_privilege`
- **Verificações de integridade**: O checksum das 4 migrations pendentes está matematicamente idêntico ao já aprovado em relatórios anteriores. O .gitattributes as preserva como arquivos binários. Não há falhas anteriores ou intervenções no banco Test original.

### 3. Evidência de backup restaurável
- **Backup**: `C:\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump`
- **Comprovação**: Restore realizado com sucesso na 3D.3.16-C retornando exit code 0 no banco descartável.

### 4. Possíveis efeitos das migrations
As migrations aplicarão o schema das comandas (RF004), o ajuste de constrições e a elevação de segurança limitando os privilégios da role de aplicação de maneira granular (menor privilégio). Nenhuma alteração afetará `cardapio_digital_dev` ou outros bancos que residem no cluster.

### 5. Comando exato de execução
O comando que será utilizado para aplicar as migrations adere estritamente ao mecanismo de deploy homologado via pacote interno, isolado em perfil Test:
``powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
# O script interno prisma-run.ts irá usar as configurações seguras com o segredo em \secrets\migrate-test.env
 = 'YES_MIGRATE_TEST'
npm run db:migrate:deploy:test
``n
### 6. Critérios de Parada
- O banco ou o host alvo diferir do previsto.
- Erros ou alertas do Prisma durante a execução ou falha ao adquirir lock.
- Exigência de permissões externas (como `CREATE ROLE` ou superusuário), pois a migration 20261104 já foi ajustada e refatorada para NÃO depender disso, limitando-se aos GRANTS apenas em objetos internos de `cardapio_digital_test`.

### 7. Procedimento de Validação Posterior
- Rodar `npm run db:migrate:status:test` e confirmar o status sincronizado das 5 migrations.
- Validar histórico no PostgreSQL através de `SELECT migration_name, checksum FROM _prisma_migrations;`.

### 8. Parecer e Status
**3D.3.17 — PRÉ-VOO APROVADO, MIGRATIONS AGUARDANDO AUTORIZAÇÃO.**

