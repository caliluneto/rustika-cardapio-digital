# RELATÓRIO DE ENTREGA — 3D.5.3-C.2.1
## Auditoria final do Neon Probe e preparação da execução supervisionada

Data: 2026-11-06. Auditoria e correções locais de `backend/scripts/neon-probe.mjs`. **Modo write não executado e não autorizado nesta subetapa.** Sem banco local, migrations, Render, commit ou push. O script continua não rastreado e fora do manifesto de publicação.

## 1. Resultado da auditoria

O script original (C.2) não vazava segredos, mas tinha **8 falhas/fragilidades** corrigidas (seção 2). Após as correções:

| Item auditado | Resultado |
|---|---|
| Não imprime senha/connection string/host | OK — `mask()` troca host, senha e URL por `***`; verificado com host e senha falsos (a mensagem do servidor saiu sem a senha) |
| Credenciais não vão a arquivo/log | OK — a URL só existe em variável de ambiente do processo; o JSON de saída contém apenas resultados mascarados e agora **precisa ficar fora do repositório** |
| Identidade do projeto | OK, com limite honesto — endpoint digitado pelo proprietário (`ep-…`) deve coincidir com o da URL; região us-east-2; `neondb`/`neondb_owner`/PG 18.x/`pg_stat_ssl`; **novo**: compara `neon.project_id` com `aged-scene-47291697` quando o servidor o expõe (senão registra NÃO TESTADO) |
| TLS e hostname | OK — `rejectUnauthorized: true`, SNI = host, TLS ≥ 1.2; confere `tls.checkServerIdentity` no host real e prova que host falso é rejeitado; aborta se não comprovado |
| Endpoint direto | OK — recusa `-pooler`, exige `*.neon.tech` |
| Sem escrita no modo read | **Reforçado** — a sessão read é aberta com `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`; qualquer escrita seria rejeitada pelo servidor |
| Efeitos colaterais na importação | OK — nada executa antes da validação de argumentos; o Prisma agora roda em processo filho isolado |
| SQL injection em identificadores | OK — nomes de teste são constantes validadas por regex `^zz_probe_[a-z_]+$`; todos os identificadores passam por `qi()` (aspas); o usuário da URL só é interpolado após ser comprovado igual a `neondb_owner`, e ainda assim quoted |
| Limpeza só atinge objetos criados | OK — ver 4 |
| Falhas parciais | OK — ver 4 |

## 2. Falhas identificadas e correções

1. **Saída em `..\` (raiz do repositório)**: o JSON poderia ser commitado por engano. → o script **recusa** caminho dentro do repositório; usar `$env:TEMP`.
2. **Máscara escondia o usuário** (`neondb_owner` virava `***`, impedindo ler a identidade) e aceitava máscaras curtas. → o usuário não é segredo e deixa de ser mascarado; máscaras < 4 caracteres ignoradas.
3. **Prisma carrega `backend/.env` automaticamente** ao instanciar o client (existe `backend/.env` neste projeto, potencialmente com URLs locais). → o teste Prisma passou para **processo filho com ambiente mínimo** (só `PATH`, `SystemRoot`, `TEMP` e a URL de teste); o `.env` não entra no processo principal e nenhuma conexão local é feita (a URL de teste substitui o datasource). `NEON_PROBE_SKIP_PRISMA=yes` pula o teste.
4. **Limpeza dependia de sucesso do CREATE**: se a resposta do servidor se perdesse, o objeto ficaria órfão. → nomes são marcados como "tentados" **antes** do CREATE e a limpeza usa `DROP … IF EXISTS`, permitida apenas se a pré-checagem provou que nenhum `zz_probe_*` existia (`precheckPassed`). Assim a limpeza nunca alcança objeto preexistente.
5. **`GRANT … WITH SET/INHERIT` (E2) era automático**. → exige `NEON_PROBE_ALLOW_GRANT=yes` adicional; senão registra PENDENTE DE AUTORIZAÇÃO.
6. **Interrupção (Ctrl+C) no modo write** deixava objetos sem aviso. → handler de SIGINT lista os nomes possivelmente criados; rodar `read` lista remanescentes `zz_probe_*`.
7. **Modo read abortava se já houvesse `zz_probe_*`** (impedia inspecionar remanescentes). → em `read` apenas registra; em `write` continua abortando.
8. **Sem retry no cold start** (scale-to-zero). → uma única nova tentativa após 5 s, somente para timeout/rede; nunca para falha de TLS ou autenticação.

Outras melhorias: `session_user` também deve ser `neondb_owner`; `pg_stat_ssl.ssl` agora é exigido pela identidade; validação de esquema `postgresql://`.

## 3. Segurança do modo read

- Sessão read-only no servidor; todas as consultas são `SELECT` em catálogos (`pg_database`, `pg_roles`, `pg_auth_members`, `pg_class`, `pg_proc`, `pg_trigger`, `pg_policy`, `pg_event_trigger`, `pg_db_role_setting`, `pg_default_acl`, `pg_stat_activity`, `pg_prepared_xacts`, `pg_replication_slots`, `pg_stat_ssl`, `shobj_description`).
- Abre também uma conexão ao banco `postgres` (teste G) em modo read-only.
- Executa uma consulta `SELECT` via Prisma (processo filho) para comprovar `sslmode=require&sslaccept=strict`.
- Nenhum `CREATE`, `ALTER`, `DROP`, `GRANT`, `COMMENT`, `SET ROLE`. Em `read`, o bloco de escrita não é alcançável (`else if` só em `mode === 'write'`).
- A saída lista nomes de bancos/roles do projeto descartável (não são segredos); pode ser colada no chat. **Não cole a connection string.**

## 4. Segurança do modo write (revisão específica para aprovação futura)

Exige `NEON_PROBE_ALLOW_WRITE=yes`. Nada abaixo foi executado.

| Passo | Operação | Alvo | Pré-condição | Limpeza |
|---|---|---|---|---|
| A | `CREATE ROLE zz_probe_role_a NOLOGIN …` | nova role | nenhum `zz_probe_*` existente | `DROP ROLE IF EXISTS` |
| A2 | `CREATE ROLE zz_probe_reader LOGIN PASSWORD '<aleatória em memória>' … CONNECTION LIMIT 2` | nova role | idem | `DROP ROLE` |
| B | `ALTER ROLE zz_probe_role_a RENAME TO zz_probe_role_b` | role do teste | A ok | `DROP ROLE` de ambos os nomes |
| C | `COMMENT ON ROLE zz_probe_role_b IS 'zz-probe-marker:<uuid>'` | role do teste | B/A ok | removido com a role |
| D | login como `zz_probe_reader` (read-only) e leitura do comentário | leitura | C ok | `end()` |
| E | `CREATE DATABASE zz_probe_db OWNER zz_probe_role_b … CONNECTION LIMIT 40` | novo banco | A ok | `pg_terminate_backend` (só `zz_probe_*`) + `DROP DATABASE IF EXISTS` |
| E2/E3 | `GRANT zz_probe_role_b TO neondb_owner WITH SET TRUE, INHERIT TRUE`, depois repetir E | só a role de teste | E falhou **e** `NEON_PROBE_ALLOW_GRANT=yes` | membership some com `DROP ROLE` |
| E4 | `REVOKE ALL … FROM PUBLIC` e `GRANT CONNECT … TO zz_probe_reader` | só o banco de teste | E ok | some com o banco |
| F | `ALTER DATABASE zz_probe_db RENAME TO zz_probe_db_renamed` | banco de teste | E ok | `DROP DATABASE` |

Final: verifica `zz_probe_%` remanescentes em `pg_database`/`pg_roles` e igualdade do inventário preexistente antes/depois. Nunca toca `neondb`, `postgres`, `production` nem roles existentes. Riscos residuais: (a) a senha aleatória do `zz_probe_reader` trafega num `CREATE ROLE` (pode aparecer em logs de consulta do Neon; role descartada em seguida; Neon não aceita senha já com hash); (b) se a limpeza falhar o script marca "BLOQUEIO CRÍTICO" e lista o resíduo — a remoção manual deve ser feita só para os nomes `zz_probe_*` listados.

## 5. Dependências necessárias

Todas já instaladas em `backend/node_modules`: Node v24.20.0, `pg` 8.23.1, `@prisma/client` 6.19.3 (client gerado). **Nada a instalar.** `psql` não é necessário.

## 6. Comandos PowerShell exatos (somente modo read)

**Obter a connection string direta (sem expor a senha no chat):** console Neon → projeto `rustika-homolog-test` → botão **Connect** → Branch `production`, Database `neondb`, Role `neondb_owner` → **desligue** a opção *Connection pooling* (o host não pode conter `-pooler`) → copie a connection string pelo botão de copiar (a senha fica oculta na tela, mas é incluída na cópia). Anote só o primeiro trecho do host, `ep-…` (nome do endpoint), que aparece na própria tela.

Em um PowerShell **novo** (não cole a URL em nenhuma outra janela nem no chat):

```powershell
cd "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
```
```powershell
$sec = Read-Host "Cole a connection string DIRETA do Neon (a entrada fica oculta)" -AsSecureString
$env:NEON_PROBE_URL = [System.Net.NetworkCredential]::new('', $sec).Password
$env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-SEU-ENDPOINT-AQUI"
```
```powershell
node scripts/neon-probe.mjs read "$env:TEMP\neon-probe-read.json"
```
Limpeza obrigatória ao terminar:
```powershell
Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_CONFIRM_ENDPOINT, Env:NEON_PROBE_ALLOW_WRITE -ErrorAction SilentlyContinue
Remove-Variable sec
```
(`Read-Host -AsSecureString` não grava a URL no histórico do PSReadLine nem em `.env`.) Para enviar o resultado: `Get-Content "$env:TEMP\neon-probe-read.json"` e cole **apenas esse JSON** no chat.

## 7. Resultado esperado (modo read bem-sucedido)

`[COMPROVADO]` para: `TLS` (authorized=true, nomeConfere=true, nomeErradoRejeitado=true, TLSv1.3, emissor Let's Encrypt/ISRG), `IDENTIDADE` (banco=neondb, usuario=neondb_owner, versão 18.6, ssl=true), `PROJETO_NEON_ID` (COMPROVADO ou NAO TESTADO), `PRIVILEGIOS_DECLARADOS`, `INVENTARIO_ANTES`, `PRISMA_TLS_STRICT`, `G_CONEXAO_BANCO_POSTGRES`, `H_*`, `REMANESCENTES_zz_probe` e `INVENTARIO_DEPOIS_IGUAL_ANTES`; e `ESCRITA = PENDENTE DE AUTORIZACAO`. `H_marker_role` deve mostrar `count=0`.

## 8. Como interpretar falhas

- **ABORT … (exit 2)**: argumento/URL recusado antes de qualquer conexão (pooler, endpoint divergente, região, esquema). Nada foi enviado.
- **28P01 password authentication failed**: senha/role incorretas ou URL copiada com outra role; refaça a cópia no console. TLS já foi validado se chegou até aqui.
- **Erro com `CERT`/`self signed`/`hostname`**: TLS não comprovado — **não contornar**; investigar rede/proxy corporativo/antivírus que interceptam TLS.
- **timeout / ECONNRESET**: cold start do Neon (autosuspend); rode de novo após 1 min.
- **`IDENTIDADE` INCOMPATÍVEL** (banco/usuário/versão): o script aborta; conferir branch/role escolhidas no console.
- **`PROJETO_NEON_ID` INCOMPATÍVEL**: URL de outro projeto — pare e revise.
- **`PRISMA_TLS_STRICT` INCOMPATÍVEL** com os demais OK: incompatibilidade do driver Prisma com o TLS do Neon; relevante para o Render (a política atual do RÚSTIKA aceita `verify-full`, o Prisma 6 não o implementa).
- **`G_CONEXAO_BANCO_POSTGRES` INCOMPATÍVEL**: o script histórico `04` (que exige estar em `postgres`) precisará de adaptação — decisão do proprietário.
- **`H_*` INCOMPATÍVEL**: catálogo restrito; anotar qual.
- **`REMANESCENTES_zz_probe` ≠ vazio**: em read não deveria ocorrer; indica objetos de outra execução.

## 9. Pendências antes de autorizar escrita

1. Executar o modo read e avaliar o JSON (identidade, TLS, Prisma, G).
2. Aprovação específica da tabela da seção 4 (principalmente E2/E3 com `NEON_PROBE_ALLOW_GRANT=yes`).
3. Decidir se `rustika_homolog_marker`/branches filhas exigem política de branch única.
4. Combinar redefinição da senha de `neondb_owner` após o ensaio.
5. Backup não aplicável (projeto descartável sem dados).

**Nota de transparência sobre a validação offline:** o teste de mascaramento usou um host `ep-fake-000000.us-east-2.aws.neon.tech` com senha falsa; o DNS curinga do Neon resolveu e o servidor respondeu `28P01 password authentication failed`. Ou seja, houve uma **tentativa de autenticação com credenciais falsas contra a infraestrutura pública do Neon, sem relação com seu projeto**; a validação de certificado foi aceita (TLS completou) e a mensagem foi exibida sem vazar a senha. Nenhum banco local foi acessado.


---

# ATUALIZAÇÃO 3D.5.3-C.2.2 — Divergência entre TLS externo e `pg_stat_ssl`

Data: 2026-11-06. Somente `neon-probe.mjs` (diagnóstico) e testes offline. Sem banco, sem SQL de escrita, sem migrations, sem Render, sem commit/push. Modo write não executado.

## 1. Causa comprovada ou hipótese remanescente

**Comprovado pela própria execução real (leitura):** o cliente validou TLS externo (`authorized=true`, nome confere, hostname falso rejeitado, TLSv1.3) e, na mesma sessão, o PostgreSQL 18.6 reportou `pg_stat_ssl.ssl=false`, `version=null`. Logicamente, se o PostgreSQL tivesse terminado esse TLS, `pg_stat_ssl` seria `true`. Logo, **o TLS validado pelo cliente não termina no processo PostgreSQL**; termina antes (componente do provedor).

**Hipótese remanescente (não documentada pelo Neon):** que esse componente seja o proxy do Neon e que o trecho proxy→compute seja não criptografado/interno. As páginas oficiais lidas (connect-securely, architecture-overview, connection-pooling, connection-errors) afirmam apenas "Neon requer SSL/TLS" e que o roteamento usa SNI; **não dizem onde o TLS termina, nem o que `pg_stat_ssl` reporta, nem se o trecho interno é cifrado**. Não encontrei relato oficial de `ssl=false`. Para fechar a hipótese: ticket de suporte Neon ou documento oficial.

## 2. Evidências técnicas

| Camada | Quem comprova | Evidência |
|---|---|---|
| TLS externo (cliente↔borda do Neon) | o cliente | cadeia/CA (ISRG), nome do servidor, rejeição de nome falso, TLSv1.3 |
| Sessão interna (proxy↔PostgreSQL) | o PostgreSQL via `pg_stat_ssl` | `ssl=false`, `version=null` |
| Documentação | Neon | "rejeita conexões sem SSL/TLS"; SNI; nada sobre terminação ou `pg_stat_ssl` |

O probe agora também coleta, em leitura: o GUC `ssl` do servidor e se o endereço do cliente visto pelo PostgreSQL é privado (indício de que o par é um proxy interno). Esses valores aparecem em `PG_STAT_SSL_SESSAO_INTERNA` e servem para fechar a hipótese na próxima leitura.

## 3. Código alterado

- **Novo** `backend/scripts/neon-probe-checks.mjs` (funções puras): `inspectExternalTls`, `evaluateIdentity`, `classifyServerSideSsl`, `decideProbeConnection`.
- **`backend/scripts/neon-probe.mjs`**: o antigo `TLS` virou `TLS_EXTERNO` (mesmos critérios: CA, nome, rejeição de nome falso, protocolo ≥ 1.2; aborta se não comprovado). `IDENTIDADE` deixou de incluir `pg_stat_ssl`. Novo registro `PG_STAT_SSL_SESSAO_INTERNA`: `COMPROVADO` se `ssl=true`; **`DIVERGENCIA_REGISTRADA`** (não aborta) se `ssl` falso/nulo **com** TLS externo comprovado; `INCOMPATIVEL` e aborta se o TLS externo não estiver comprovado. O teste Prisma passou a ser COMPROVADO quando a conexão com `sslmode=require&sslaccept=strict` funciona e o banco confere; o `pg_stat_ssl` visto por ele é informado à parte. O JSON de saída ganhou o campo `interpretacao`.
- **Novo** `backend/scripts/neon-probe-checks.test.mjs` (18 testes offline).
- Nenhuma validação de produção do RÚSTIKA foi alterada.

## 4. Testes (offline, `node --test`, 18/18 aprovados)

Servidores TLS locais em 127.0.0.1 com certificados gerados na hora: TLS válido (comprovado); certificado inválido (CA não confiável → conexão recusada; socket não autorizado não comprova); hostname incorreto (cadeia válida/nome errado → recusado; nome diferente do certificado não comprova); certificado que aceitaria o nome falso não comprova; TLS < 1.2 não comprova; banco, usuário, `session_user` e versão incorretos bloqueiam; `pg_stat_ssl=false` com TLS externo comprovado → divergência registrada e prossegue; `pg_stat_ssl=false`/`null` sem TLS externo → aborta; `pg_stat_ssl=true` não compensa TLS externo não comprovado; identidade/projeto incorretos continuam bloqueando; garantia estática: nenhum `rejectUnauthorized: false` nem `NODE_TLS_REJECT_UNAUTHORIZED` no probe. Também: `node --check` OK e guarda `-pooler` ainda aborta.

## 5. Garantias de segurança preservadas

Validação de certificado, CA e hostname; teste de rejeição de hostname incorreto; nenhum `rejectUnauthorized=false`; endpoint direto obrigatório; identidade de banco/usuário/`session_user`/versão e (quando exposto) `neon.project_id` continuam bloqueando; modo read em sessão read-only; modo write inalterado e não executado; nada de credenciais impressas.

**Implicação para o RÚSTIKA (não alterada):** `src/config/serverIdentity.ts` exige `pg_stat_ssl.ssl=true` (`sslActive`) antes de qualquer escrita de homologação. No Neon essa verificação falharia — **incompatibilidade real com o gate atual**, não do probe. Opções (decisão do proprietário, nenhuma implementada): (a) manter o gate e descartar o Neon; (b) mudar a política com justificativa explícita e por perfil (ex.: aceitar `ssl=false` somente com TLS externo validado pelo cliente via `sslaccept=strict` e endpoint `*.neon.tech`), registrando que o trecho interno é de responsabilidade do provedor; (c) outro provedor onde o PostgreSQL termine o TLS. Isso enfraqueceria uma garantia (cifragem comprovada até o PostgreSQL), por isso exige aprovação.

## 6. Novo comando de leitura

Mesmo procedimento da seção 6 (nenhuma dependência nova; `neon-probe-checks.mjs` fica ao lado do script). Em PowerShell novo:

    cd "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
    $sec = Read-Host "Cole a connection string DIRETA do Neon (entrada oculta)" -AsSecureString
    $env:NEON_PROBE_URL = [System.Net.NetworkCredential]::new('', $sec).Password
    $env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-SEU-ENDPOINT-AQUI"
    node scripts/neon-probe.mjs read "$env:TEMP\neon-probe-read.json"
    Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_CONFIRM_ENDPOINT -ErrorAction SilentlyContinue
    Remove-Variable sec

Resultado esperado: `TLS_EXTERNO` COMPROVADO; `IDENTIDADE` COMPROVADO; `PG_STAT_SSL_SESSAO_INTERNA` `DIVERGENCIA_REGISTRADA` (com GUC `ssl` e indicador de endereço privado); o restante da leitura (Prisma, banco `postgres`, catálogos, inventário) é executado e gera o JSON.

## 7. Pendências para a C.2

1. Reexecutar o modo read e avaliar o JSON completo (Prisma, `postgres`, catálogos).
2. Decidir sobre a política de `pg_stat_ssl` (item 5) antes de qualquer replay/uso real do Neon: o gate de produção hoje rejeita o Neon.
3. Opcional: ticket ao suporte Neon para confirmar a terminação de TLS no proxy e a proteção do trecho interno.
4. Só depois, aprovação específica do modo write (tabela da seção 4 deste relatório).
