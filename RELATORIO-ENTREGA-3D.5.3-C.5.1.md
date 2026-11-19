# RELATÓRIO DE ENTREGA — 3D.5.3-C.5.1
## Revisão final de ownership, TLS e documentação Neon Free

Data: 2026-11-07. **Correções locais, testes offline e documentação, conforme autorizado.** Nenhuma migration foi executada, nenhum banco (Neon ou local) foi tocado, o Render não foi alterado, nada foi commitado nem publicado. Orçamento: R$ 0/mês (nenhuma peça paga tocada).

Classificação usada: **IMPLEMENTADO** · **COMPROVADO OFFLINE** · **NÃO COMPROVADO NO NEON** · **BLOQUEADO** · **PENDENTE DE AUTORIZAÇÃO**.

---

## 1. Problemas encontrados

- **P1 — Privilégio maior que o necessário.** O script de membership da C.5 usava `GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT TRUE`. O ensaio real (C.3/C.4) testou os dois juntos e nunca isolou qual bastava — a etapa anterior afirmava a necessidade de `INHERIT` sem fundamentação documental, só por analogia (suposição, exatamente o que esta subetapa pede para evitar).
- **P2 — Lacuna de evidência sobre a conexão do Prisma.** A verificação de TLS externo (C.5) roda numa conexão independente; nada no código ou na documentação da C.5 deixava explícito que isso **não** prova o socket do Prisma, nem havia verificação complementar usando o cliente Prisma real.
- **P3 — Comentário desatualizado.** O cabeçalho de `neonServerIdentity.ts` citava uma função (`openIndependentTlsProbe`) que nunca existiu no arquivo (o nome real é `readNeonServerFacts`) — corrigido.
- **P4 — Documentação obrigatória ausente.** `docs/neon-homolog.md`, citado por `assertNeonProxyTlsAck` desde a C.5, não existia.

## 2. Correções aplicadas

- `ops/homolog/sql/neon/01-grant-set-true-migrator.sql`: `GRANT ... WITH SET TRUE, INHERIT TRUE` → `WITH SET TRUE, INHERIT FALSE`; verificação de pós-condição passou a exigir explicitamente `inherit_option = false`; comentário de cabeçalho cita a documentação oficial que fundamenta a troca (seção 3).
- `ops/homolog/sql/neon/02-revoke-set-true-migrator.sql`: ajustado para `REVOKE` de uma membership só-`SET`; comentário novo explicando por que a revogação não afeta nenhuma migration futura (seção 3).
- `ops/homolog/sql/neon/03-verify-ownership.sql`: comentário explícito sobre o valor esperado de `inherit_option` (`false`) e `set_option` (`true`).
- `backend/scripts/neon-probe.mjs`: comentário adicionado no passo `E2` explicando a divergência com os scripts de produção — **não** alterei o comportamento desse script (ele já foi executado e relatado com `SET+INHERIT` juntos; reescrever o que já foi testado distorceria o histórico).
- `backend/src/server.ts`: verificação complementar — depois que `evaluateNeonServerIdentity` aprova, o **próprio** cliente Prisma (o mesmo que vai servir tráfego) precisa confirmar banco/role com `$queryRaw` antes de `startListening()`. Comentário extenso explicando o que isso prova e o que não prova.
- `backend/src/config/neonServerIdentity.ts`: corrigido o nome de função no comentário (P3); acrescentado um parágrafo "LIMITE HONESTO" explicando a lacuna da seção 4/5 e deixando por escrito que o reconhecimento humano nunca substitui nenhuma verificação técnica.
- `docs/neon-homolog.md`: criado (18 itens, seção 8 deste relatório).
- Testes atualizados/criados (seção 9).

## 3. Decisão sobre INHERIT TRUE/FALSE

**Fundamentação documental (não suposição), citando a página oficial "Role Membership" do PostgreSQL** (textos idênticos nas versões 16 e 18, confirmados por leitura direta de `postgresql.org/docs/16/role-membership.html` e `postgresql.org/docs/current/role-membership.html`):

> "To create an object owned by another role or give ownership of an existing object to another role, you must have the ability to **SET ROLE** to that role; otherwise, commands such as `ALTER ... OWNER TO` or `CREATE DATABASE ... OWNER` will fail."

A documentação liga explicitamente as duas operações que usamos (`CREATE DATABASE ... OWNER` no script 02, e a ownership verificada implicitamente por `ALTER DATABASE ... RENAME` no script 04) à opção **`SET`**. A opção `INHERIT`, pela mesma página, controla algo diferente: uso automático e contínuo dos privilégios da role concedida, sem precisar de `SET ROLE` — "member roles that have been granted membership with the INHERIT option automatically have use of the privileges of [...]" — útil quando se quer herdar privilégios permanentemente, o que não é o nosso caso: a role administrativa nunca age "como" `cardapio_migrator` fora das duas operações de ownership, e `cardapio_migrator` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`) não tem nenhum privilégio que valha a pena herdar automaticamente.

**Decisão:** `GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE` — o mínimo documentado para as duas operações necessárias.

**Classificação: IMPLEMENTADO / NÃO COMPROVADO NO NEON.** O ensaio real da C.3/C.4 testou `SET+INHERIT` juntos; nunca isolou qual bastava. Não executei nenhum SQL contra o Neon nesta subetapa (proibido pelo escopo), então não posso elevar isso a "comprovado". O script e a documentação (seção 8 de `docs/neon-homolog.md`) instruem explicitamente a não escalar para `INHERIT TRUE` "só para fazer funcionar" caso a primeira execução real falhe — primeiro entender por quê.

Revisão dos demais pontos pedidos:
- **Quando o GRANT é aplicado / revogado**: entre `01-cluster-roles.sql`/`02-create-replay-database.sql`, e entre `04-finalize-rename.sql`/`05-post-migration-grants.sql` — inalterado desde a C.5, agora documentado também em `docs/neon-homolog.md` §7–8.
- **Como a revogação afeta migrations futuras**: nenhum efeito — todas as migrations (passadas e futuras) conectam diretamente como a role migradora (senha própria), nunca através da membership administrativa. Documentado explicitamente no comentário do script 02 e em `docs/neon-homolog.md` §8.
- **Como provar o dono definitivo do banco**: `03-verify-ownership.sql`, item 1, antes e depois.
- **Como impedir privilégios administrativos na role de runtime**: guarda explícita no script 01 (recusa se executor/alvo for role de runtime) + verificação de atributos na 03 (item 3) — inalterado, já existia na C.5, revalidado por teste.
- **Como impedir mudanças em roles preexistentes do Neon**: nenhum dos dois scripts executa `ALTER ROLE` sobre role alguma (nem a administrativa, nem `neon_superuser`) — só cria/remove uma membership. Confirmado por teste estático (`neon-membership-grant.test.ts`, verificação de ausência de `ALTER ROLE`/`format`/`EXECUTE`).

## 4. Revisão da política TLS

| Requisito pedido | Situação |
|---|---|
| Perfil opt-in | **IMPLEMENTADO** — `app-homolog-neon`, bloqueado por padrão. |
| Certificado e hostname verificados | **IMPLEMENTADO / COMPROVADO OFFLINE** — `externalTlsCheck.ts`, testado com servidores TLS locais reais em `tests/config/external-tls-check.test.ts`. |
| Endpoint direto, sem pooler | **IMPLEMENTADO** — `secrets.ts` recusa `-pooler` para o perfil de runtime; cabeçalhos dos scripts SQL agora instruem o mesmo para a sessão administrativa (documental, não há enforcement de código para uma sessão humana). |
| Rejeição de certificado inválido / hostname incorreto | **COMPROVADO OFFLINE** — testes dedicados. |
| Project ID obrigatório | **IMPLEMENTADO / COMPROVADO** no ensaio real (C.4) que o servidor o expõe; a exigência em código é **COMPROVADO OFFLINE**. |
| Marca de homologação obrigatória | **IMPLEMENTADO / COMPROVADO OFFLINE** (reaproveita a lógica já testada de `serverIdentity.ts`). |
| Banco e usuário corretos | **IMPLEMENTADO / COMPROVADO OFFLINE**. |
| PostgreSQL compatível (≥ 17) | **IMPLEMENTADO / COMPROVADO OFFLINE**; versão real observada (18.6) **COMPROVADO** no ensaio C.4. |
| Privilégios mínimos | Ver seção 3. |
| Falha de inicialização quando qualquer requisito falha | **COMPROVADO OFFLINE** — teste estático novo confirma a ordem de execução em `server.ts` (seção 9). |

**Auditoria pedida — "a verificação em conexão separada oferece evidência suficiente sobre a conexão Prisma?" Resposta: NÃO, por si só.** O motor do Prisma não expõe seu socket TLS ao código JavaScript, então não é possível inspecionar literalmente o handshake que o Prisma usa. **Verificação complementar implementada** (`server.ts`): depois que a conexão independente aprova TODAS as verificações, o **próprio** cliente Prisma (o mesmo objeto que vai servir requisições) é obrigado a confirmar banco/role via `$queryRaw`, usando a mesma URL com os mesmos parâmetros estritos (`sslmode=require&sslaccept=strict`, nunca relaxáveis por `secrets.ts`) antes de `startListening()`. Isto reduz a distância entre "uma sonda funcionou" e "o cliente real funciona", mas **continua sendo evidência por identidade de configuração + comportamento documentado do Prisma, não uma inspeção direta do socket**. Em nenhum lugar deste projeto (código ou documentação) se afirma "TLS comprovado até o processo PostgreSQL" para o Neon — essa frase só é verdadeira para `app-homolog` (cluster dedicado), onde `pg_stat_ssl` prova exatamente isso. Um teste estático (`neon-homolog-gate.test.ts`) passou a confirmar a ausência literal dessa frase no código e a ordem das verificações.

Confirmado nesta revisão: `rejectUnauthorized: false` não é usado em nenhum lugar do código (teste estático já existente, revalidado); o reconhecimento humano (`assertNeonProxyTlsAck`) é uma função isolada, chamada antes de qualquer conexão, e não influencia em nada o resultado de `evaluateNeonServerIdentity` — ela é sempre executada depois e continua bloqueando por conta própria (agora coberto por teste estático de ordem, seção 9).

## 5. Garantias efetivamente comprovadas

- Sete migrations históricas intactas (checksums revalidados pela suíte).
- TLS externo 1.3 com CA/hostname válidos, na conexão independente (ensaio real C.4; lógica também comprovada offline com certificados reais locais).
- `neon.project_id`, marca de homologação, banco, usuário e versão do PostgreSQL: lógica de verificação comprovada offline (18 testes dedicados), com os valores reais confirmados no ensaio C.4.
- `CREATE ROLE`/`ALTER ROLE RENAME`/`COMMENT ON ROLE`/leitura por role sem privilégio: comprovados no ensaio real C.4 (não repetido aqui).
- Nenhum rejectUnauthorized=false em nenhum arquivo deste projeto.
- 0 novos erros de typecheck; build de produção OK; 1112 testes aprovados.

## 6. Riscos residuais

- **R1** — `SET TRUE, INHERIT FALSE` não testado no Neon real (seção 3).
- **R2** — Trecho proxy→compute do Neon permanece não comprovável (arquitetural, fora do nosso controle).
- **R3** — Verificação complementar via Prisma (seção 4) prova conectividade com os parâmetros certos, não o handshake TLS do Prisma em si.
- **R4** — Endpoint direto para a sessão administrativa dos scripts SQL depende de disciplina humana (sem enforcement de código, diferente do perfil de runtime).
- **R5** — Branches filhas do Neon herdando a marca de homologação (risco já conhecido desde a C.1, sem solução técnica — só disciplina operacional, agora documentada em `docs/neon-homolog.md` §5).
- **R6** — Formato de `EXPECTED_PROJECT_ID` baseado em um único exemplo observado.

## 7. Arquivos alterados

**Modificados:** `ops/homolog/sql/neon/01-grant-set-true-migrator.sql`, `ops/homolog/sql/neon/02-revoke-set-true-migrator.sql`, `ops/homolog/sql/neon/03-verify-ownership.sql`, `src/server.ts`, `src/config/neonServerIdentity.ts`, `scripts/neon-probe.mjs` (só comentário), `tests/scripts/neon-membership-grant.test.ts`, `tests/config/neon-homolog-gate.test.ts`.

**Novo:** `docs/neon-homolog.md`.

Nada em `serverIdentity.ts`, `prisma/migrations/`, os scripts `01-09` do cluster dedicado, Render, ou qualquer arquivo do projeto `PLATAFORMA_SITES_IA` foi tocado.

## 8. Documentação criada

`backend/docs/neon-homolog.md` — 18 seções, exatamente as pedidas: arquitetura Neon+Render; diferença TLS externo × `pg_stat_ssl`; garantias comprovadas/não comprovadas; riscos residuais aceitos só para homologação; identidade do projeto e marca; procedimento de provisionamento; membership e ownership (com a citação da seção 3 deste relatório); separação das roles; migrations históricas; uso do endpoint direto; variáveis de ambiente (sem valores sensíveis); significado do reconhecimento humano; critérios de bloqueio; backup/restauração; limites do Neon Free; critérios de prontidão para Render; proibição de pedidos/dados reais.

## 9. Testes executados

Offline, sem rede, sem banco: `npm run test:ci` (vitest) — **1112 aprovados, 8 ignorados, 0 falhas** (eram 1110 antes desta subetapa; os 2 novos são o teste de ordem em `neon-homolog-gate.test.ts` e o teste de mínimo privilégio em `neon-membership-grant.test.ts`; nenhum teste quebrou, nenhum foi removido). `npx tsc --noEmit`: 0 erros novos (1 erro pré-existente, alheio, em `tests/scripts/verify-fixtures-rotation.ts`). `npm run build`: OK. Varredura de segredos nos arquivos tocados: limpa.

Especificamente:
- `tests/scripts/neon-membership-grant.test.ts`: `INHERIT TRUE` não aparece mais no script; `INHERIT FALSE` presente; citação da documentação oficial presente no comentário.
- `tests/config/neon-homolog-gate.test.ts`: reconhecimento humano é checado antes de `loadDatabaseProfile`/`readNeonServerFacts`; a verificação de identidade/TLS ocorre antes da confirmação complementar via Prisma; a frase "TLS comprovado até o processo PostgreSQL" não existe em `server.ts`.
- Suíte completa de TLS/identidade/perfil/ownership da C.5 (54 testes) revalidada sem alteração de comportamento.

## 10. Integridade das migrations

As sete migrations históricas continuam intactas: `prisma/migrations/` sem diferença de conteúdo, e os testes de checksum (`least-privilege-migration.test.ts` e correlatos) passaram sem alteração.

## 11. Estado do Git

Nada comitado, nada publicado. O repositório original (`Cardapio_Digital`) mantém o grande volume de trabalho não commitado de etapas anteriores (não gerado nesta subetapa). Os arquivos efetivamente tocados por esta subetapa são exatamente os listados na seção 7 — confirmado comparando a lista de arquivos modificados antes e depois desta sessão de trabalho.

## 12. Critérios para autorizar o provisionamento

1. Leitura e aprovação de `docs/neon-homolog.md`.
2. Decisão explícita sobre executar `neon/01-grant-set-true-migrator.sql` com `INHERIT FALSE` como primeira tentativa (recomendado) ou já partir para `INHERIT TRUE` (não recomendado sem antes tentar o mínimo).
3. Execução supervisionada completa da sequência da seção 7 de `docs/neon-homolog.md`, com `neon/03-verify-ownership.sql` antes e depois.
4. Primeira subida real do perfil `app-homolog-neon`, com `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` definido deliberadamente, confirmando que todas as verificações da seção 14 do documento aprovam (não simulado).
5. Nenhum dado real, nenhum pedido real, até autorização posterior e específica (proibição explícita em `docs/neon-homolog.md` §18).

## 13. Próxima etapa recomendada

**3D.5.3-C.6** (se autorizada): execução supervisionada do provisionamento no projeto Neon descartável (`rustika-homolog-test`), seguindo exatamente `docs/neon-homolog.md` §7, testando primeiro `INHERIT FALSE` e documentando o resultado real (que hoje é `NÃO COMPROVADO NO NEON`). Só depois, o boot real do perfil `app-homolog-neon`. O deploy no Render (3D.5.3-D) continua fora de escopo até essas duas etapas serem concluídas e avaliadas.
