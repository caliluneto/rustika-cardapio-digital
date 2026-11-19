# ADENDO AO RELATÓRIO 3D.3.9 — VERIFICAÇÃO DO BACKUP (3D.3.10)

Data: 04/11/2026 (America/Sao_Paulo)
Executor: OpenCode (DeepSeek V4.1 Flash Free), Windows 11
Escopo: correção documental comprovada; nenhuma restauração, criação ou exclusão de banco.

## Achado

O relatório 3D.3.9 registrou como existente o dump:

```text
C:\Users\u1n3c\AppData\Local\RustikaBackups\cardapio_test_pre3d38_20261104-012137.dump
```

Em 04/11/2026, antes de qualquer tentativa de restauração, o caminho foi consultado e o arquivo
**não existe**. O SHA-256 registrado
(`1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265`) não pôde ser reconferido.

## Consequência

- A seção 7 da 3D.3.9 ("Estado do backup") e a Operação B ("Backup e migrations em Test") **não
  podem ser executadas como escritas**, porque o artefato de origem não está disponível.
- Nenhuma restauração foi tentada; nenhum banco foi criado ou apagado; nenhum `pg_restore`,
  `createdb` ou `dropdb` foi executado.
- O restante do relatório 3D.3.9 permanece válido como registro histórico. A correção operacional
  está em `backend/docs/restore-backup.md` (plano com banco descartável, `--no-owner`,
  `--no-privileges`, `--single-transaction`, validação e limpeza).

## Ação necessária antes da Operação B

1. Gerar um novo dump do Test, com autorização, fora do OneDrive e do repositório.
2. Registrar o SHA-256 e a versão do `pg_dump`/`pg_restore` (18.6).
3. Repetir a inspeção do dump (`pg_restore --list`) e só então seguir o plano de restauração.
4. Não usar o caminho antigo como se o arquivo existisse.

Este adendo não altera os números de testes, as migrations ou o parecer histórico da 3D.3.9.
