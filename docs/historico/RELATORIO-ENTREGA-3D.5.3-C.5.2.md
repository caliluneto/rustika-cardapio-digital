# RELATÓRIO DE ENTREGA — 3D.5.3-C.5.2
## Validação final de SET TRUE, INHERIT FALSE no Neon Free

Data: 2026-11-07. **Preparação e auditoria offline, conforme autorizado.** Nenhum SQL de escrita foi executado contra o Neon nesta etapa. Nenhuma migration histórica foi executada, `cardapio_digital_homolog` não foi criado, nenhuma role definitiva foi criada, `serverIdentity.ts` não foi alterado, Render e bancos locais não foram tocados, nada foi commitado nem publicado.

Classificação usada: **COMPROVADO** (offline, nesta etapa) · **COMPROVADO NO ENSAIO REAL ANTERIOR** (C.3/C.4, com a variante antiga SET+INHERIT TRUE) · **PENDENTE** (depende da execução real desta etapa).

---

## 1. Script auditado

`backend/scripts/neon-probe.mjs` (já auditado nas C.2.1/C.2.2/C.3/C.4; não é parte do produto, fora do manifesto de publicação). O ensaio de membership existente (passo `E2`) usava `GRANT ... WITH SET TRUE, INHERIT TRUE` — a mesma combinação testada no ensaio real (C.4), nunca isolada. Adaptação mínima aplicada e **testada offline primeiro**, como pedido:

- `E2_GRANT_SET_TRUE_INHERIT_FALSE_NA_ROLE_DESCARTAVEL`: `GRANT ${roleName} TO ${baseUser} WITH SET TRUE, INHERIT FALSE` (antes: `INHERIT TRUE`).
- **Novo** `E2B_VERIFICAR_SET_TRUE_INHERIT_FALSE_SEM_ADMIN`: lê `pg_auth_members` e falha (lança erro, registrado como `INCOMPATIVEL`) se `set_option ≠ true`, `inherit_option ≠ false` ou `admin_option ≠ false` — prova objetivamente a opção 2 e 3 das "verificações exigidas" (seção 4), não apenas "o GRANT não deu erro".
- `E3_CREATE_DATABASE_APOS_GRANT`: inalterado (opção 4).
- `F_ALTER_DATABASE_RENAME`: inalterado (opção 5); seu resultado já lê o dono depois do rename (opção 6).
- **Novo** `G_REVOGAR_MEMBERSHIP_TEMPORARIA`: depois que o rename (F) é aprovado, `REVOKE ${roleName} FROM ${baseUser}`, seguido de duas verificações na mesma transação lógica: (a) a membership desapareceu de `pg_auth_members`; (b) o dono do banco renomeado **continua** sendo `roleName` (revogar a membership administrativa nunca deveria mudar o ownership) — opções 7 e parte da 6.
- Limpeza (`cleanup()`), remanescentes e comparação de inventário: inalterados desde a C.3 (opções 8 e 9) — já cobrem nomes únicos por execução, `assertOwned`, reconexão em caso de falha, e três tentativas por objeto.

Nenhum script definitivo do RÚSTIKA (`ops/homolog/sql/01-09` nem `ops/homolog/sql/neon/*`) foi alterado nesta etapa — a adaptação ficou só no probe, como pedido.

**Testes offline, antes de qualquer execução real** (`node --test` / `vitest`, `scripts/neon-probe-checks.test.mjs`): **23/23 aprovados** (eram 22; o novo teste confirma a ausência literal de `INHERIT TRUE` no arquivo, a presença de `INHERIT FALSE`, e a presença do passo de revogação). `node --check scripts/neon-probe.mjs`: sintaxe OK. Guardas de entrada (sem rede) revalidadas: `write` sem `NEON_PROBE_ALLOW_WRITE=yes` continua abortando com código 2; com credenciais falsas, falha limpo em `28P01` sem expor segredo.

## 2. Comandos de execução (preparados; NÃO executados)

Pré-voo (modo read; pode ser rodado sem autorização adicional — só confirma o estado, nenhuma escrita):

```powershell
cd "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
$sec = Read-Host "Cole a connection string DIRETA do Neon (entrada oculta)" -AsSecureString
$env:NEON_PROBE_URL = [System.Net.NetworkCredential]::new('', $sec).Password
$env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-SEU-ENDPOINT-AQUI"
node scripts/neon-probe.mjs read "$env:TEMP\neon-probe-preflight-c552.json"
Get-Content "$env:TEMP\neon-probe-preflight-c552.json"
```

Modo write (**exige autorização específica do proprietário**, dada depois de revisar o pré-voo acima):

```powershell
$env:NEON_PROBE_ALLOW_WRITE = "yes"
$env:NEON_PROBE_ALLOW_GRANT = "yes"
node scripts/neon-probe.mjs write "$env:TEMP\neon-probe-write-c552.json"
"codigo de saida=$LASTEXITCODE"
Get-Content "$env:TEMP\neon-probe-write-c552.json"
```

Limpeza do ambiente local (sempre, inclusive se algo falhar):

```powershell
Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_CONFIRM_ENDPOINT, Env:NEON_PROBE_ALLOW_WRITE, Env:NEON_PROBE_ALLOW_GRANT -ErrorAction SilentlyContinue
Remove-Variable sec
```

Destino único permitido: projeto `rustika-homolog-test` (`aged-scene-47291697`), branch `production`, endpoint direto (sem `-pooler`), autenticado como `neondb_owner`. Nenhum outro destino é aceito pelo script (guardas de endpoint/região/projeto já auditadas na C.3/C.4).

## 3. Resultados reais

**Nenhum. Não autorizado nesta etapa.** O script não foi executado contra o Neon. Todas as linhas de "resultado real" abaixo ficam `PENDENTE` até você autorizar o passo 2 da seção 2 e colar o JSON produzido.

## 4. Membership efetivo

**PENDENTE** (depende da execução real). O que a adaptação **vai medir**, objetivamente, se executada: `set_option`, `inherit_option` e `admin_option` lidos de `pg_auth_members` depois do `GRANT`, comparados aos valores esperados (`true`/`false`/`false`) — não apenas "o comando não deu erro". Fundamentação (já usada na C.5.1, não repetida por completo): a documentação oficial do PostgreSQL liga `CREATE DATABASE ... OWNER`/`ALTER ... OWNER TO` à opção `SET`, não à `INHERIT`.

## 5. Ownership

**PENDENTE.** O script mede o dono do banco descartável em três momentos: logo depois do `CREATE DATABASE` (`E3`), logo depois do `ALTER DATABASE RENAME` (`F`), e logo depois do `REVOKE` da membership temporária (`G`) — este último prova especificamente que revogar a habilidade de `SET ROLE` da role administrativa **não** devolve nem altera o ownership do banco.

## 6. Segurança

Confirmado nesta auditoria (reaproveitando guardas já existentes, não reescritas):
- Identidade do projeto Neon: `neon.project_id` comparado a `aged-scene-47291697`, obrigatório no modo write (`mode === 'write' && !head.pid` aborta).
- Endpoint direto: recusa qualquer host com `-pooler`.
- TLS externo: `inspectExternalTls` (cadeia, nome do servidor, rejeição de hostname falso, protocolo).
- Banco e usuário: `IDENTIDADE` com `neondb`/`neondb_owner`, versão ≥ 17 (18.x esperado).
- Ausência de objetos `zz_probe_*` preexistentes: pré-checagem recusa o modo write se houver qualquer resíduo.
- Inventário antes/depois: capturado logo após a pré-checagem e comparado ao final.
- Limpeza em falha parcial: `cleanup()` com reconexão e três tentativas por objeto; `assertOwned` impede que a limpeza alcance qualquer nome fora desta execução (nomes únicos por `runId`).
- Nenhum dado real é usado; nenhuma credencial é impressa ou gravada fora do JSON de saída, que não contém segredos.

## 7. Limpeza

**Automática, independente de autorização adicional, parte do próprio script.** Ordem: termina sessões nos bancos `zz_probe_<id>_*` → `DROP DATABASE` (db e dbRenamed) → `DROP ROLE` (reader, roleB, roleA — o que remove, de qualquer forma, qualquer membership residual, inclusive se o passo `G` não tiver sido alcançado por uma falha anterior). Se `G` (revogação explícita) falhar, o `SQLSTATE` é registrado em `G_REVOGAR_MEMBERSHIP_TEMPORARIA` e a limpeza automática no `finally` ainda tenta remover os objetos; se mesmo assim sobrar algo, o código de saída é `3` e o JSON lista exatamente o que precisa de limpeza supervisionada (nunca "limpeza completa" é afirmada sem a comprovação de `REMANESCENTES_zz_probe` vazio).

## 8. Diferenças entre resultado offline e real

| Item | Offline (comprovado agora) | Real (pendente) |
|---|---|---|
| Sintaxe e lista fechada de SQL | 23/23 testes aprovados | — |
| `GRANT ... WITH SET TRUE, INHERIT FALSE` é a única variante no código | Comprovado (teste estático) | Se o Neon aceita essa combinação para `CREATE DATABASE OWNER`/`ALTER DATABASE RENAME`: **não testado** (C.3/C.4 testaram `INHERIT TRUE`) |
| Guardas de endpoint/projeto/credenciais | Comprovadas (abortam sem rede) | Comportamento contra o endpoint real: **não repetido nesta etapa** (já comprovado na C.4) |
| Revogação da membership + preservação do ownership | Lógica presente e testada estaticamente | Execução real: **pendente** |

## 9. Pendências para provisionamento completo

1. Autorização explícita para o passo 2 (modo write) da seção 2.
2. Resultado real colado aqui, com o JSON completo (sem a connection string).
3. Se `E2B`/`G` falharem de forma inesperada: registrar o `SQLSTATE`, **não** escalar automaticamente para `INHERIT TRUE` — primeiro entender o motivo (igual já instruído em `docs/neon-homolog.md` e no comentário do script de produção).
4. Só depois desta validação: aplicar a mesma decisão (já aplicada) aos scripts de produção `ops/homolog/sql/neon/01-02` — eles já usam `SET TRUE, INHERIT FALSE` desde a C.5.1, mas continuam classificados como **NÃO COMPROVADO NO NEON** até uma execução real (desta etapa ou de uma C.6 dedicada aos scripts de produção).
5. Replay das sete migrations históricas, criação de `cardapio_digital_homolog` e deploy no Render continuam fora de escopo.

---

## ATUALIZAÇÃO — Pré-voo real executado (modo READ)

Data/hora: 2026-11-07T16:21:52Z. Executado por mim diretamente no terminal local do proprietário (`neon-probe.mjs read`), com a connection string digitada só nesse terminal, nunca enviada ao chat, nunca gravada em arquivo. Variáveis de ambiente sensíveis removidas ao final. **Somente leitura — nenhum SQL de escrita.**

### 1. Resultado do terminal (sem credenciais)

```
[COMPROVADO] TLS_EXTERNO - authorized=true nomeConfere=true nomeErradoRejeitado=true protocolo=TLSv1.3 cifra=TLS_AES_256_GCM_SHA384 emissor=Let's Encrypt/YR2 validoAte=Jan 20 12:46:09 2027 GMT
[COMPROVADO] IDENTIDADE - banco=neondb usuario=neondb_owner sessionUser=neondb_owner versao=18.6 (ac70818) (num 180006)
[DIVERGENCIA_REGISTRADA] PG_STAT_SSL_SESSAO_INTERNA - pg_stat_ssl.ssl=false version=null com TLS externo comprovado; GUC ssl=off; enderecoDoCliente(visto pelo PostgreSQL) privado=true nulo=false
[COMPROVADO] PROJETO_NEON_ID - neon.project_id confere com o esperado
[COMPROVADO] PRIVILEGIOS_DECLARADOS - {"rolsuper":false,"rolcreaterole":true,"rolcreatedb":true,"rolreplication":true,"rolbypassrls":true}
[COMPROVADO] INVENTARIO_ANTES - bancos=neondb,postgres,template0,template1 roles=21 memberships=12
[COMPROVADO] PRISMA_TLS_STRICT - sslmode=require&sslaccept=strict; banco=neondb; pg_stat_ssl.ssl=false (ver divergência acima)
[COMPROVADO] G_CONEXAO_BANCO_POSTGRES - conectou a postgres
[COMPROVADO] H_* (16 catálogos lidos: pg_database=4, pg_roles=21, pg_auth_members=12, pg_stat_activity=11, pg_replication_slots=2, pg_policy=0, pg_event_trigger=0, pg_prepared_xacts=0, pg_default_acl=2, marker_role=0 — ainda não provisionado)
[COMPROVADO] H_roles_preexistentes - cloud_admin(super) / neon_service / neon_superuser / neondb_owner / token_roles
[COMPROVADO] H_dono_dos_bancos - neondb:neondb_owner; postgres:cloud_admin
[PENDENTE DE AUTORIZACAO] ESCRITA - modo read: nenhum teste de escrita executado
[COMPROVADO] REMANESCENTES_zz_probe - databases=[] roles=[]
[COMPROVADO] INVENTARIO_DEPOIS_IGUAL_ANTES - bancos, roles e memberships preexistentes identicos
```

### 2. Código de saída

`0`.

### 3. Verificações aprovadas (contra os critérios exigidos)

| Critério exigido | Resultado |
|---|---|
| `TLS_EXTERNO = COMPROVADO` | ✅ |
| `IDENTIDADE = COMPROVADO` | ✅ |
| `PROJETO_NEON_ID = COMPROVADO` | ✅ |
| `PRISMA_TLS_STRICT = COMPROVADO` | ✅ |
| `REMANESCENTES_zz_probe = nenhum` | ✅ (`databases: []`, `roles: []`) |
| `INVENTARIO_DEPOIS_IGUAL_ANTES = COMPROVADO` | ✅ |
| Código de saída `0` | ✅ |

### 4. Divergências

- `PG_STAT_SSL_SESSAO_INTERNA = DIVERGENCIA_REGISTRADA` (`pg_stat_ssl.ssl=false`), exatamente como documentado em `docs/neon-homolog.md` §2 — não é uma falha, é a divergência esperada do proxy do Neon. Permanece documentada, não foi contornada nem escondida.
- `neondb_owner` tem `rolcreaterole`, `rolcreatedb`, `rolreplication`, `rolbypassrls` todos `true` (mas `rolsuper=false`) — confirma o comportamento já descrito na C.1/C.5.1 (não é superusuário real, mas tem privilégios amplos via `neon_superuser`).
- `rustika_homolog_marker` ainda não existe (`H_marker_role.count=0`) — esperado, pois `01-cluster-roles.sql` ainda não foi executado neste projeto.

### 5. Objetos remanescentes

Nenhum. `REMANESCENTES_zz_probe` veio vazio em bancos e roles.

### 6. Conclusão

**APROVADO.** Todos os sete critérios de aceitação do pré-voo foram satisfeitos, código de saída 0. O projeto Neon está no estado esperado para prosseguir: TLS externo e identidade comprovados, nenhum resíduo de ensaios anteriores, nenhuma marca de homologação ainda criada (consistente com "nada provisionado ainda").

**O modo write continua NÃO executado e PENDENTE DE AUTORIZAÇÃO explícita**, conforme o escopo desta solicitação ("Não avançar automaticamente para WRITE ou provisionamento definitivo").
