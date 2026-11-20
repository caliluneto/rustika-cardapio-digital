# RÚSTIKA — ENTREGA 3D.3.16-B

## Preservação Definitiva do Backup e Autorização da Prova de Restauração

### 1. Caminhos dos dumps copiados
- Destino 1: `C:\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump`
- Destino 2: `C:\RustikaBackups\cardapio_digital_test_pre3d38_20261104-012137.dump`

### 2. SHA-256 completo de cada cópia
- Cópia 1 (3D.3.11): `f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf` (20.928 bytes)
- Cópia 2 (3D.3.8): `1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265` (20.928 bytes)

### 3. Integridade de origem e destino
As cópias foram realizadas com sucesso. Os hashes SHA-256 no destino (`C:\RustikaBackups`) são perfeitamente idênticos aos da origem, comprovando preservação bit-a-bit e integridade total. O comando `pg_restore --list` no arquivo copiado retornou as 59 entradas do índice sem falhas.

### 4. Identidade do PostgreSQL
- **Instância**: PostgreSQL 18.6
- **Host/Porta**: 127.0.0.1:5432 (local)
- **Sessões e Extensões**: Consultas locais via psql exigem role administrativa/migrator que operará o restore.

### 5. Bancos protegidos
É expressamente proibido alterar os seguintes bancos (e os demais de outros projetos):
- `cardapio_digital_dev`, `cardapio_digital_test`, `cardapio_digital_shadow`
- `cardapio_restore_precheck`
- `plataforma_sites_ia*`, `rf004_lab_*`
- `postgres`, `template0`, `template1`

### 6. Nome do banco descartável
**`cardapio_restore_3d316`**
Este banco atualmente não existe e será criado de forma exclusiva para esta prova.

### 7. Comandos exatos propostos
Para garantir isolamento, a execução será feita em sessão única controlada, assumindo o acesso autorizado:

**A. Verificação de Inexistência e Criação:**
`powershell
 = "cardapio_restore_3d316"
 = "cardapio_migrator" # Role provisória para isolar o schema e criar bd

# Ponto de checagem. Deve retornar NADA.
psql -X -h 127.0.0.1 -p 5432 -U  -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = ''"

# Criação restrita
createdb -h 127.0.0.1 -p 5432 -U  
psql -X -h 127.0.0.1 -p 5432 -U  -d postgres -v ON_ERROR_STOP=1 -c "REVOKE ALL ON DATABASE  FROM PUBLIC"
``n
**B. Restauração Isolada:**
`powershell
 = "C:\RustikaBackups\cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump"
 = "C:\Users\u1n3c\AppData\Local\Temp\rustika_restore_3d316.log"

pg_restore -h 127.0.0.1 -p 5432 -U  -d  ` 
  --no-owner --no-privileges --single-transaction --exit-on-error ` 
  --verbose  2>&1 | Tee-Object -FilePath 
``n*(A ausência da flag `--create` previne recriação de bancos externos, garantindo que tudo caia em ``)*

**C. Validação:**
`powershell
psql -X -h 127.0.0.1 -p 5432 -U  -d  -v ON_ERROR_STOP=1 -f backend/docs/sql/verify-restore.sql
``n
### 8. Riscos e condições de parada
- **Condição de Parada 1:** `createdb` falhar (ex: banco já existente). Ação: Abortar imediatamente. Não forçar a exclusão ou sobrescrita do banco existente.
- **Condição de Parada 2:** `pg_restore` relatar qualquer erro e reverter a transação parcial (garantido por `--single-transaction` e `--exit-on-error`). Ação: Capturar logs de falha e abortar.
- **Condição de Parada 3:** Script de validação (`verify-restore.sql`) encontrar contagem/esquema inválido. Ação: Registrar evidência, interromper sem declarar sucesso.
- **Condição de Parada 4:** Erro de privilégios de owner/role administrativa ou perda de conexão. Ação: Não modificar ACLs de segurança globais; abortar operação de restore e registrar a anomalia do ambiente.

### 9. Estado Git
- Nenhuma alteração foi versionada ou `git add` executado neste commit.
- O novo relatório `RELATORIO-ENTREGA-3D.3.16-B.md` foi gerado no diretório atual de forma não-rastreada (untracked).

### 10. Parecer final
Os backups foram preservados em diretório externo e íntegro (`C:\RustikaBackups`). A identificação do cluster e os comandos pre-flight atestam total segurança e isolamento para execução restrita no banco de destino. Nenhuma escrita foi realizada ainda.

