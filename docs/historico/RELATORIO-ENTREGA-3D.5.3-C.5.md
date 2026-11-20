# RELATÓRIO DE ENTREGA — 3D.5.3-C.5
## Resolver compatibilidade de ownership e TLS com Neon Free

Data: 2026-11-07. **Alterações locais e testes offline, conforme autorizado.** Nenhuma migration foi executada, nenhum banco (Neon ou local) foi tocado, o Render não foi alterado, nada foi commitado nem publicado. Nenhum gate dos ambientes existentes foi enfraquecido.

---

## 1. Problemas comprovados

Pelos ensaios reais da C.3/C.4 (não repetidos aqui):
- **P-OWN** — `CREATE DATABASE ... OWNER cardapio_migrator` falhou com `SQLSTATE 42501` executado por `neondb_owner`; resolvido no mesmo ensaio com `GRANT cardapio_migrator TO <admin> WITH SET TRUE`. Causa: no Neon, uma role criada por `CREATE ROLE` (não `neon_superuser`) só concede `ADMIN` sobre si mesma a quem a criou, sem `SET`/`INHERIT` (comportamento do PostgreSQL ≥ 16).
- **P-TLS** — `pg_stat_ssl.ssl = false` mesmo com TLS externo 1.3 validado pelo cliente (cadeia, nome do servidor, protocolo). Causa: o TLS que o cliente comprova termina no proxy do Neon antes do processo PostgreSQL; o trecho proxy→compute não é observável pelo cliente (documentado na C.2.2, sem confirmação oficial do Neon sobre esse trecho interno).

## 2. Correção de ownership (Parte A)

Três arquivos novos, **específicos do provedor Neon**, que **não alteram nem substituem** `backend/ops/homolog/sql/01-09*.sql` (cluster dedicado):

- [`backend/ops/homolog/sql/neon/01-grant-set-true-migrator.sql`](backend/ops/homolog/sql/neon/01-grant-set-true-migrator.sql) — roda entre `01-cluster-roles.sql` e `02-create-replay-database.sql`. `GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT TRUE`. Guardas: exige banco `postgres`; recusa se `cardapio_migrator` não existir; recusa explicitamente se o executor ou o alvo for qualquer role de runtime/placeholder (`cardapio_test_app`, `cardapio_dev_app`, `cardapio_homolog_app`, `cardapio_homolog_placeholder`); idempotente (recusa repetir se a membership já existir); verifica o resultado antes de terminar.
- [`backend/ops/homolog/sql/neon/02-revoke-set-true-migrator.sql`](backend/ops/homolog/sql/neon/02-revoke-set-true-migrator.sql) — roda entre `04-finalize-rename.sql` e `05-post-migration-grants.sql`. `REVOKE cardapio_homolog_migrator FROM CURRENT_USER` (nome já renomeado; a membership segue o OID através do `ALTER ROLE RENAME`). Verifica que a membership foi removida **e** que o ownership do banco definitivo permanece com a role migradora (revogar a membership administrativa nunca transfere ownership).
- [`backend/ops/homolog/sql/neon/03-verify-ownership.sql`](backend/ops/homolog/sql/neon/03-verify-ownership.sql) — somente leitura (`BEGIN READ ONLY`/`ROLLBACK`); roda antes do passo 2 e depois do passo 6 para comparar "antes"/"depois": dono dos bancos, memberships da migradora, ausência de privilégios administrativos nas roles de runtime, ausência de roles do RÚSTIKA como membros de `neon_superuser`.

Nenhum identificador é interpolado dinamicamente nos scripts de escrita (sem `format`/`EXECUTE`): o alvo é sempre `CURRENT_USER`, e o nome da role migradora é um literal fixo — risco de injeção de SQL inexistente por desenho. A role de runtime (`cardapio_homolog_app`) nunca é mencionada em nenhum `GRANT`/`REVOKE` destes scripts.

## 3. Política de TLS proposta e implementada (Parte B)

**Nada em `serverIdentity.ts` foi alterado.** A política do cluster PostgreSQL dedicado (perfil `app-homolog`) continua idêntica, inclusive exigindo `pg_stat_ssl.ssl === true`.

Para o Neon, um **perfil novo e opt-in**, `app-homolog-neon`, com política **diferente, não mais fraca**, implementada em módulos separados:

- [`backend/src/config/externalTlsCheck.ts`](backend/src/config/externalTlsCheck.ts) — verificação independente do TLS externo (cadeia/CA, nome do servidor com teste de rejeição de hostname errado, protocolo ≥ 1.2). Porta para TypeScript a lógica já auditada em `neon-probe-checks.mjs` (3D.5.3-C.2.2). Nunca usa `rejectUnauthorized: false`.
- [`backend/src/config/neonServerIdentity.ts`](backend/src/config/neonServerIdentity.ts) — `readNeonServerFacts` abre uma conexão **independente** (não a do Prisma, que não expõe o socket) só para inspecionar o TLS real e ler `neon.project_id`, a marca de homologação e a identidade; `evaluateNeonServerIdentity` recusa por: TLS externo não comprovado, PostgreSQL < 17, `neon.project_id` ausente ou divergente, marca de homologação ausente/divergente, banco/role incorretos, bancos de desenvolvimento/replay ainda presentes. **`pg_stat_ssl` nunca entra nessa lista** — é registrado como fato informativo (`pgStatSslActive`), documentado como divergência esperada, nunca como aprovação nem como reprovação por si só.
- **Reconhecimento humano obrigatório**: `assertNeonProxyTlsAck` exige `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK=accept-proxy-terminated-tls-pg-stat-ssl-false` exato, verificado **antes de qualquer conexão**. Nenhuma combinação de outras variáveis substitui essa decisão explícita — o perfil não liga "sozinho" por estar configurado.
- `backend/config/database-profiles.json` — perfil `app-homolog-neon` com o **mesmo** banco/role definitivos de `app-homolog` (`cardapio_digital_homolog`/`cardapio_homolog_app`): o objetivo é que o estado final seja idêntico, só o provedor e a verificação mudam.
- `backend/src/config/secrets.ts` — ambiente `homolog-neon` (aditivo, `HomologEnvironment` ganhou um terceiro valor); nova chave obrigatória `EXPECTED_PROJECT_ID` (formato Neon validado); recusa endpoint `-pooler`; todas as validações existentes (host proibido, TLS, UUID do cluster, credenciais, chaves permitidas) continuam valendo sem alteração para `app-homolog`.
- `backend/src/config/env.ts` e `backend/src/config/homologRuntime.ts` — os gates de produção passam a aceitar `app-homolog` **ou** `app-homolog-neon` (antes só o primeiro); todo o resto da política (CORS https exato, `NODE_ENV=test` exclusivo de `app-test`, qualquer outro perfil recusado em produção) é idêntico para os dois.
- `backend/src/server.ts` — novo ramo de inicialização: para `app-homolog-neon`, exige o reconhecimento humano, abre a verificação independente, e só chama `startListening()` se `evaluateNeonServerIdentity` devolver zero problemas; senão `process.exit(1)` sem aceitar tráfego. O ramo de `app-homolog` é o mesmo de antes, inalterado.

Decisão sobre "deixar bloqueado": optei por **não** deixar o perfil permanentemente bloqueado, porque a verificação independente de TLS + `neon.project_id` + marca de homologação é uma política real (ainda que diferente da de `pg_stat_ssl`), e o reconhecimento humano explícito evita que isso pareça uma falha silenciosamente contornada. Se, depois de revisar, você concluir que essa política não é aceitável, a reversão é de uma linha: não definir `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` mantém o perfil bloqueado (é o estado padrão).

## 4. Garantias mantidas

- Perfil `app-homolog` (cluster dedicado): zero alteração de comportamento, zero teste alterado em `serverIdentity.ts`.
- Sete migrations históricas e seus checksums: intocadas (confirmado por `prisma/migrations/` sem diferença e pelos testes existentes, que passam).
- Nenhum `rejectUnauthorized: false`, nenhum TLS desligado, nenhuma exceção silenciosa.
- Role de runtime (`cardapio_homolog_app`) nunca recebe `SET`/`INHERIT`/privilégio administrativo, nos scripts SQL nem na política TypeScript.
- O perfil Neon exige **TLS + project id + marca + banco + role + versão**, não apenas um desses.
- Nenhuma alteração automática de produção: tudo opt-in, por variável de ambiente explícita.

## 5. Garantias ainda não comprovadas

- O trecho proxy→compute do Neon não é observável nem comprovável pelo cliente — isto é aceito e documentado, não resolvido.
- Os scripts `neon/01` e `neon/02` **não foram executados** contra o Neon real nesta etapa (só auditados estaticamente, como na C.3); a sequência completa com `02-create-replay-database.sql`/`04-finalize-rename.sql` reais ainda não foi ensaiada ponta a ponta.
- `neon.project_id` como GUC: sua disponibilidade foi observada no ensaio real da C.4, mas o comportamento em toda topologia do Neon (ex.: branches filhas) não está documentado oficialmente.
- A marca de homologação (`rustika_homolog_marker`) é herdada por branches filhas (risco já registrado na C.1); o perfil Neon não resolve isso — depende de disciplina operacional (uma única branch por ambiente).

## 6. Arquivos alterados

**Novos:**
`backend/src/config/externalTlsCheck.ts`, `backend/src/config/neonServerIdentity.ts`, `backend/src/types/pg.d.ts`, `backend/ops/homolog/sql/neon/01-grant-set-true-migrator.sql`, `backend/ops/homolog/sql/neon/02-revoke-set-true-migrator.sql`, `backend/ops/homolog/sql/neon/03-verify-ownership.sql`, `backend/ops/homolog/sql/neon/README.md`, `backend/tests/config/external-tls-check.test.ts`, `backend/tests/config/neon-server-identity.test.ts`, `backend/tests/config/neon-homolog-gate.test.ts`, `backend/tests/config/neon-homolog-profile.test.ts`, `backend/tests/scripts/neon-membership-grant.test.ts`.

**Modificados (aditivos):**
`backend/config/database-profiles.json`, `backend/src/config/env.ts`, `backend/src/config/secrets.ts`, `backend/src/config/homologRuntime.ts`, `backend/src/server.ts`, `backend/tests/config/homolog-profiles.test.ts` (ajuste da lista de perfis marcados), `backend/tests/scripts/homolog-provisioning.test.ts` (reconhece o novo subdiretório `neon/`).

**Correção avulsa encontrada ao rodar a suíte completa (não fazia parte do pedido, registrada por transparência):** `backend/scripts/neon-probe-checks.test.mjs` (criado na 3D.5.3-C.2.2) usava `node:test`, que `npm run test:ci` não executa (apareceu como "No test suite found", 0 dos 22 testes rodando no CI desde que foi criado). Troquei só o importe do runner (`node:test` → `vitest`, mantendo as mesmas asserções de `node:assert/strict`); os 22 testes agora rodam de fato no `test:ci`.

## 7. Testes executados

`npm run test:ci` (vitest, config unitária, sem rede): **1110 aprovados, 8 ignorados, 0 falhas** (era 1087/8/0 antes desta etapa; a diferença são os testes novos desta etapa mais os 22 do neon-probe-checks que passaram a ser contados).

Cobertura desta etapa, por pedido da Parte C:
- **Membership com SET TRUE / ownership incorreto / privilégios excessivos** — `tests/scripts/neon-membership-grant.test.ts` (estático, SQL não executado): escopo fechado só em `cardapio_migrator`, recusa explícita de roles de runtime, idempotência, exigência de banco `postgres`, exigência de renomeação prévia no revoke, verificação somente-leitura, scripts 01-09 originais intactos.
- **TLS válido / certificado inválido / hostname incorreto** — `tests/config/external-tls-check.test.ts`.
- **Project ID incorreto / marca de homologação incorreta / banco incorreto / role incorreta / PostgreSQL < 17 / banco de desenvolvimento ainda presente** — `tests/config/neon-server-identity.test.ts`.
- **Falha de inicialização quando um gate obrigatório não é satisfeito** — `tests/config/neon-homolog-gate.test.ts` (reconhecimento ausente/incorreto, perfis de produção, CORS).
- **Carregamento do perfil (secrets.ts): project id ausente/formato inválido, pooler, banco/role/host/TLS/UUID incorretos** — `tests/config/neon-homolog-profile.test.ts`.
- **Regressão de `app-homolog`**: todos os testes pré-existentes de `homolog-profiles.test.ts`, `env-homolog.test.ts`, `server-identity-and-drift.test.ts` e `least-privilege-migration.test.ts` continuam passando sem alteração de comportamento.

Typecheck (`tsc --noEmit`): **sem novos erros**; o único erro restante é pré-existente e fora do escopo (`tests/scripts/verify-fixtures-rotation.ts`, um script avulso não publicado) — e, como efeito colateral de eu ter tipado `pg` para o meu próprio uso, esse arquivo caiu de 2 para 1 erro pré-existente. Build de produção (`npm run build`): OK.

## 8. Riscos residuais

- **R-C5.1** — O trecho proxy→compute do Neon não é comprovável; a aceitação disso é uma decisão humana explícita (o ack), não uma prova técnica.
- **R-C5.2** — Os scripts `neon/01`/`neon/02` ainda não foram ensaiados integrados com `02-create-replay-database.sql`/`04-finalize-rename.sql` reais; podem expor um detalhe não previsto (ex.: `pg_terminate_backend` concorrente).
- **R-C5.3** — `NEON_PROJECT_ID_PATTERN` é baseado no único exemplo observado (`aged-scene-47291697`); formatos futuros do Neon podem não casar (falha fechada seria "bloqueia", o que é seguro, mas pode exigir atualização do padrão).
- **R-C5.4** — Branches filhas do Neon herdando a marca de homologação continuam sendo um risco operacional, não técnico.
- **R-C5.5** — O ack por variável de ambiente pode ser copiado entre ambientes sem releitura da documentação; é uma mitigação de processo, não uma prova automática de que o humano leu `docs/neon-homolog.md` (ainda não escrito — ver pendências).

## 9. Critérios de aceitação

Antes de qualquer execução real contra o Neon (C.6, se autorizada):
1. Leitura deste relatório e decisão explícita sobre a política de TLS da seção 3 (aceitar, ajustar ou recusar).
2. `node --test`/`vitest` dos arquivos da seção 7 verdes (já comprovado agora).
3. `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` definido deliberadamente, nunca copiado "porque sim".
4. Execução supervisionada de `neon/01-grant-set-true-migrator.sql` → `02-create-replay-database.sql` → … → `04-finalize-rename.sql` → `neon/02-revoke-set-true-migrator.sql`, com `neon/03-verify-ownership.sql` antes e depois, no projeto descartável — ainda não feita.
5. Primeira subida real do perfil `app-homolog-neon` contra esse mesmo banco, confirmando que `evaluateNeonServerIdentity` aprova e que o processo aceita tráfego.

## 10. Pendências para provisionamento e Render

- Escrever `docs/neon-homolog.md` (citado por `assertNeonProxyTlsAck`) com o detalhamento desta política, para quem for definir o ack.
- Executar (com autorização específica, fora desta etapa) a sequência de provisionamento completa no projeto Neon descartável, incluindo os dois scripts novos.
- Só depois, ensaiar o boot do perfil `app-homolog-neon` contra esse banco.
- Deploy no Render (3D.5.3-D) continua fora de escopo até os passos acima serem concluídos e avaliados.
