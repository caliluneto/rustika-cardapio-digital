# Inspeção de permissões do PostgreSQL

Os arquivos desta pasta são **somente leitura** e não aplicam `GRANT`, `REVOKE`
ou mudanças de ownership.

- `inspect-dev.sql`: execute conectado a `cardapio_digital_dev`.
- `inspect-test.sql`: execute conectado a `cardapio_digital_test`.
- `inspect-shadow.sql`: execute conectado a `cardapio_digital_shadow`.

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
