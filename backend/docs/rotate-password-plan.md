# Plano de rotação — senhas PostgreSQL

**Estado: preparado, NÃO executado (12/11/2026).** Nenhuma senha, role ou ACL foi alterada.
O procedimento canônico, com comandos, verificações e rollback, é
[`secrets-rotation.md`](./secrets-rotation.md). Este arquivo é apenas o resumo operacional; nenhum
valor de senha, URL ou hash é registrado aqui.

## Resultado atual do `npm run secrets:audit`

A auditoria lê os sete segredos da pasta externa ao repositório/OneDrive e falha com código 1:

| Role | Situação | Ação obrigatória |
| --- | --- | --- |
| `cardapio_dev_app` | senha de 8 dígitos, compartilhada com outras roles | gerar senha distinta, ≥ 16 caracteres, não numérica |
| `cardapio_test_app` | senha de 8 dígitos, compartilhada com outras roles | gerar senha distinta, ≥ 16 caracteres, não numérica |
| `cardapio_migrator` | 8 dígitos nas URLs de Dev; 6 dígitos no shadow de Test; inconsistente entre arquivos | uma única senha forte em `migrate-dev.env` e `migrate-test.env`, tanto em `DATABASE_URL` quanto em `SHADOW_DATABASE_URL` |
| `cardapio_test_fixtures` | 26 caracteres, sem achado de força | manter ou rotacionar; a senha está embutida em scripts locais ignorados, então trate-a como exposta |

Achados `FAIL`: senha reutilizada entre três roles, senha curta/numérica e a inconsistência do
`cardapio_migrator`. A pasta de segredos está fora do repositório e do OneDrive, o que reduz o
vazamento por Git/backup, mas não elimina o risco local.

## Ordem segura (uma role por vez)

1. Parar backend, frontend, Vitest, Playwright e qualquer sessão que use as roles.
2. Copiar a pasta de segredos para um local protegido, fora do OneDrive (ponto de retorno).
3. Rotacionar `cardapio_test_fixtures` e atualizar `fixtures-test.env`.
4. Rotacionar `cardapio_test_app` e atualizar `app-test.env`.
5. Rotacionar `cardapio_dev_app` e atualizar `app-dev.env`.
6. Rotacionar `cardapio_migrator` e atualizar **os dois** perfis (`migrate-dev.env` e
   `migrate-test.env`), com a mesma senha em `DATABASE_URL` e `SHADOW_DATABASE_URL`.
7. Limpar a área de transferência e não registrar a senha em chat, log, commit ou relatório.
8. Executar `npm run secrets:audit` até sair com código 0 (sem `FAIL`).
9. Validar somente leitura: `npm run db:migrate:status:test`, `npm run e2e:inspect`, subir o backend
   com `DB_PROFILE=app-dev` e conferir `GET /api/health` e `GET /api/ready`.

## Compatibilidade com os perfis

- `app-dev` usa `cardapio_dev_app`; `app-test` usa `cardapio_test_app`.
- `migrate-dev` usa `cardapio_migrator` no banco `cardapio_digital_dev` e no shadow.
- `migrate-test` usa a **mesma role** `cardapio_migrator` no banco de teste e no shadow. Como o
  PostgreSQL tem uma única senha por role, os dois arquivos precisam concordar; essa é a correção
  do achado de inconsistência.
- Não alterar Neon, roles de homologação, `pg_hba.conf` ou permissões durante a rotação.

## Critério de conclusão

`npm run secrets:audit` retorna 0, as quatro roles autenticam nos perfis correspondentes e os testes
somente leitura continuam passando. Até lá, a auditoria permanece vermelha e a rotação continua
sendo uma operação que exige autorização explícita; nenhum `ALTER ROLE` foi executado.
