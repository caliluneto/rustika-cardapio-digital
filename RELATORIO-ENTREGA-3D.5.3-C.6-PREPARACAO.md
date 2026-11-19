# RELATÓRIO DE ENTREGA — 3D.5.3-C.6-PREPARACAO
## Preparação final do provisionamento Neon + Prisma

> **SUPERSEDIDO pela auditoria C.6 (2026-11-08):** este relatório descreve o fluxo antigo com `prisma migrate deploy`/rename, que foi bloqueado. Use `RELATORIO-ENTREGA-3D.5.3-C.6-AUDITORIA.md` e `backend/ops/homolog/provision-neon-c6.ts`.

Data: 2026-11-07. **Preparação offline concluída.**
O ambiente de homologação definitivo está com os scripts consolidados e validados offline, prontos para a execução final e supervisionada. Nenhuma alteração real foi feita no Neon ou no ambiente local (nenhum write, nenhuma migration executada).

### 1. Estado Técnico

Foi consolidado o script definitivo de provisionamento focado no Neon Free:
- **`backend/ops/homolog/provision-neon.ts`**: Script de etapa única, unificando as instruções que antes estavam divididas em 9 scripts SQL, agora adequadas à política restrita de `GRANT SET` sem superusuário exigida pelo PostgreSQL 16+ no Neon.
- **Auditoria das 7 migrations**: Elas permanecem inalteradas, seus checksums estão intactos. Nenhuma delas roda operações de DDL fora do seu escopo, e não afetam diretamente as permissões globais além dos `GRANT` de tabelas necessários.
- **Compatibilidade PostgreSQL 18.6**: Testada nas lógicas dos scripts (já exige `server_version_num >= 18`).
- **Política de Privilégio Mínimo**:
  - `cardapio_homolog_migrator`: Criada sem permissão administrativa global; ganha temporariamente `SET TRUE, INHERIT FALSE` (para `CREATE DATABASE ... OWNER`) e depois `INHERIT TRUE` (exclusivamente para o `ALTER DATABASE RENAME`), revogadas ao final.
  - `cardapio_homolog_app` (runtime): Não ganha nenhum privilégio elevado em nenhuma etapa; é conferida rigorosamente ao fim da execução (`rolsuper`, `rolcreaterole`, `rolcreatedb` = false).

### 2. Arquivos Alterados / Criados

- `backend/ops/homolog/provision-neon.ts` (NOVO): Script Node.js/TypeScript isolado que conduz o provisionamento sem expor senhas em argumentos de linha de comando ou variáveis ambientes de longa duração.
- `RELATORIO-ENTREGA-3D.5.3-C.6-PREPARACAO.md` (NOVO): Este documento.

Nenhum arquivo histórico (`prisma/migrations/*`, `serverIdentity.ts`, etc.) foi tocado. 

### 3. Checkpoints de Segurança Implementados

- **Nenhum ECHO de senhas:** O script `provision-neon.ts` consome o utilitário `readHiddenLine` já existente, exigindo input humano oculto no terminal interativo (TTY).
- **Verificação Externa de TLS:** Emprega a prova criptográfica cliente-servidor nativa (`node:tls`) sem bypass (`rejectUnauthorized: false` nunca é usado), validando explicitamente cadeia, hostname e recusa de bad-hosts.
- **Idempotência Limitada & Safety First:** O script aborta no `[2/8]` caso encontre bancos com prefixo `cardapio_` ou roles de escopo do projeto, impedindo deleções ou sobrescritas por acidente (o script proíbe comandos `DROP`).
- **Recusa de Identidade:** Recusa avançar caso `neon.project_id` ou sufixo DNS sejam diferentes do projetado para o banco descartável homolog (`aged-scene-47291697`).

### 4. Credenciais Necessárias (Condições para Execução Real)

Para a execução real da próxima etapa, o operador precisará ter em mãos:
1. **Connection String do `neondb_owner`** do projeto Neon homolog (`rustika-homolog-test`): `postgres://neondb_owner:***@ep-sweet-king-bd7i7ypb.us-east-2.aws.neon.tech/neondb`
2. **Nova senha forte (>= 16 chars) para a role migrator**: Será usada apenas nesta janela de bootstrap e inserida dinamicamente no `prisma migrate deploy`.

### 5. Plano de Recuperação (Rollback Manual)

Como o script recusa fazer `DROP` automáticos (para não causar destruições irrecuperáveis caso aponte para produção por acidente), qualquer falha após `[3/8]` gerará "sujeira" e deixará o Neon num estado intermediário.
- **Sintoma:** O script aborta e o log de console (mais o markdown de falha gerado) exibe o erro.
- **Ação:** O operador precisará abrir o SQL Editor da Neon e executar os seguintes DROPs explícitos antes de tentar novamente:
  ```sql
  DROP DATABASE IF EXISTS cardapio_digital_test;
  DROP DATABASE IF EXISTS cardapio_digital_homolog;
  DROP ROLE IF EXISTS cardapio_homolog_migrator, cardapio_homolog_app, cardapio_homolog_bootstrap, cardapio_homolog_placeholder;
  DROP ROLE IF EXISTS cardapio_migrator, cardapio_test_app, cardapio_dev_app, rustika_homolog_marker;
  ```

### 6. Próxima Ação Objetiva

Tudo está empacotado para a **execução real de homologação**. A próxima ação seria:
1. Autorizar a execução de `npx tsx ops/homolog/provision-neon.ts` via terminal iterativo pelo desenvolvedor/administrador.
2. Fornecer os inputs no prompt oculto.
3. Observar a emissão do arquivo de relatório `RELATORIO-PROVISIONAMENTO-C.6.md`.
4. Uma vez provisionado o Neon, partir para a implantação na Render.