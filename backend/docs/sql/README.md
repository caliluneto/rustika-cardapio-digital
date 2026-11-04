# Scripts SQL do PostgreSQL

## Inspeção (somente leitura)

- `inspect-dev.sql`: execute conectado a `cardapio_digital_dev`.
- `inspect-test.sql`: execute conectado a `cardapio_digital_test`.
- `inspect-shadow.sql`: execute conectado a `cardapio_digital_shadow`.
- `verify-test-fixtures.sql`: confere atributos, ACLs efetivas, sequências e violações da role
  `cardapio_test_fixtures`; execute conectado a `cardapio_digital_test`.
- `verify-restore.sql`: confere schema, dados e `_prisma_migrations` de um banco descartável de
  restauração; execute somente no banco `cardapio_restore_check_*`.

## Provisão da role de fixtures (3D.3.10, preparada e NÃO executada)

Os arquivos de provisão alteram o cluster e exigem autorização específica, role
administrativa local com `SUPERUSER` e conferência prévia de `pg_hba.conf`/ACLs de `PUBLIC`:

- `provision-test-fixtures.sql`: cria a role `NOLOGIN` e aplica a matriz mínima em Test.
- `enable-test-fixtures-login.sql`: habilita `LOGIN` depois do `\password` manual (a senha não fica no arquivo).
- `rollback-test-fixtures.sql`: revoga privilégios conhecidos e remove a role.

Nenhum deles foi executado. Leia `backend/docs/fixture-role.md` antes de qualquer uso.

Não informe senha na linha de comando. Use `PGPASSWORD` temporário ou um arquivo
`pgpass` localizado fora do OneDrive. Exemplo, sem exibir a senha:

```powershell
$env:PGPASSWORD = '<senha-lida-de-fonte-local>'
psql -h 127.0.0.1 -p 5432 -U cardapio_migrator -d cardapio_digital_dev `
  -f backend/docs/sql/inspect-dev.sql
Remove-Item Env:PGPASSWORD
```

Nenhuma alteração de privilégio deve ser aplicada antes da revisão destes
resultados e de autorização específica.
