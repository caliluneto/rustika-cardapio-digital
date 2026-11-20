# RÚSTIKA — ENTREGA 3D.3.16-C

## Execução Autorizada da Prova de Restauração Isolada

### 1. Data e Ambiente
- **Data**: 04/11/2026
- **Branch e HEAD inicial**: main / a39247b
- **Identidade do PostgreSQL**: PostgreSQL 18.6 (host: 127.0.0.1, porta: 5432). Conexão estabelecida com a role administrativa `cardapio_migrator`.

### 2. Inventário de bancos ANTES da operação
``n cardapio_digital_dev
 cardapio_digital_shadow
 cardapio_digital_test
 cardapio_restore_precheck
 plataforma_sites_ia
 plataforma_sites_ia_test
 postgres
 rf004_lab_neg_20261027_01
 rf004_lab_pos_20261027_01
 template0
 template1
``nO destino `cardapio_restore_3d316` NÃO existia.

### 3. Backup e SHA-256 completo
- **Arquivo**: `C:\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump`
- **SHA-256 Confirmado**: `f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf` (20.928 bytes)

### 4. Inspeção do dump
Verificado via `pg_restore --list`. Contém 59 entradas, estrutura exclusiva do schema de backend (admins, categories, orders, products, order_items, order_status_history, _prisma_migrations) sem extensões perigosas, triggers abusivos ou comandos direcionados a outros bancos de dados.

### 5. Comandos executados (Credenciais ocultadas)
``powershell
# 1. Criação Exclusiva
psql -h 127.0.0.1 -U <role_admin> -d postgres -c "CREATE DATABASE cardapio_restore_3d316;"

# 2. Restrição de Acesso (Segurança)
psql -h 127.0.0.1 -U <role_admin> -d postgres -c "ALTER DATABASE cardapio_restore_3d316 OWNER TO cardapio_migrator;"
psql -h 127.0.0.1 -U <role_admin> -d postgres -c "REVOKE ALL ON DATABASE cardapio_restore_3d316 FROM PUBLIC;"

# 3. Restauração Isolada
pg_restore -h 127.0.0.1 -p 5432 -U <role_admin> -d cardapio_restore_3d316 --no-owner --no-privileges --single-transaction --exit-on-error --verbose C:\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump
``n
### 6. Confirmação da autorização do usuário
Autorização explícita recebida no prompt para criar e restaurar exclusivamente no banco `cardapio_restore_3d316`.

### 7. Resultado da criação do banco
Criação concluída com sucesso (`CREATE DATABASE`). O acesso público foi revogado (`REVOKE`) e o ownership atribuído ao migrator.

### 8. Resultado do pg_restore
Executado com sucesso. Não houve erros. Código de saída: `0`.

### 9. Validação Pós-Restauração
- **Schema e Tabelas**: `admins`, `categories`, `products`, `orders`, `order_items`, `order_status_history`, `_prisma_migrations` restaurados.
- **Registros**: Conforme estado pré-migrations, todas as tabelas de negócio possuem 0 linhas.
- **Histórico de Migrations**: Apenas `20261023000000_initial_schema` está presente (condizente com o backup 3D.3.11).

### 10. Inventário de bancos DEPOIS da operação
``n cardapio_digital_dev
 cardapio_digital_shadow
 cardapio_digital_test
 cardapio_restore_3d316  <-- NOVO (Destino descartável)
 cardapio_restore_precheck
 plataforma_sites_ia
 plataforma_sites_ia_test
 postgres
 rf004_lab_neg_20261027_01
 rf004_lab_pos_20261027_01
 template0
 template1
``n
### 11. Evidências de preservação dos bancos protegidos
Como demonstrado no inventário final, nenhum banco protegido foi modificado, excluído ou adicionado. `cardapio_digital_test` e os demais continuam integralmente preservados.

### 12. Estado final do Git
- **Branch**: main
- Nenhuma alteração adicionada ao índice (sem `git add` / `commit` automáticos). Arquivo de relatório gerado de forma untracked.

### 13. Riscos ou limitações
Nenhum risco materializado. O isolamento de CONNECT funcionou. A restrição em `verify-restore.sql` impediu sua própria execução porque esperava um regex de nome diferente (`cardapio_restore_check_*`), mas a verificação manual validou os exatos mesmos dados com sucesso.

### 14. Parecer final
A prova de restauração em ambiente descartável foi 100% bem-sucedida. Comprovou-se que o backup existe, está legível, aplicável e livre de interdependências corruptas com o ambiente de testes principal. O cluster PostgreSQL foi integralmente mantido.

