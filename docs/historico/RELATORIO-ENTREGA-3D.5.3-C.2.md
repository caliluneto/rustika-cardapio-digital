# RELATÓRIO DE ENTREGA — 3D.5.3-C.2
## Ensaio controlado de compatibilidade Neon Free

Data: 2026-11-06. **Status geral: PENDENTE — nenhum teste contra o Neon foi executado, porque não há credencial disponibilizada de forma segura nesta sessão.** Nenhuma senha, token ou connection string foi solicitada no chat. Nada foi escrito em banco; sem migrations, Render, deploy, commit ou push. Foi criada apenas uma ferramenta local de ensaio supervisionado (seção 3) e validada offline.

Legenda: COMPROVADO · INCOMPATÍVEL · NÃO TESTADO · PENDENTE DE AUTORIZAÇÃO.

## 1. Identificação do projeto

| Item | Valor informado (pelo proprietário) | Verificação |
|---|---|---|
| Projeto / ID | `rustika-homolog-test` / `aged-scene-47291697` | NÃO TESTADO (sem acesso ao console/API) |
| Branch / região | `production` / AWS us-east-2 | NÃO TESTADO |
| Banco / usuário | `neondb` / `neondb_owner` | NÃO TESTADO (será conferido pela ferramenta) |
| PostgreSQL | 18.6 (informado; ≥ 17 satisfaz as migrations) | NÃO TESTADO |
| CREATEDB / CREATEROLE | true / true (informado) | declarado; não prova operação |

O project ID e o nome do projeto **não são verificáveis por SQL**. A identidade do alvo será ancorada em: endpoint conferido pelo proprietário no console (`NEON_PROBE_CONFIRM_ENDPOINT`), região, `neondb`, `neondb_owner`, versão 18.x e ausência prévia de objetos `zz_probe_*`. Se algo divergir, a ferramenta aborta antes de escrever.

## 2. Conexão externa e TLS

**PENDENTE.** Sem `NEON_PROBE_URL` no ambiente (não procurei segredos em arquivos), sem `psql`/CLI Neon. Observação sobre `ssl_enabled=false` do SQL Editor: é uma sessão interna do console; só uma conexão externa prova TLS.

O que a ferramenta valida quando executada (todos critérios de aprovação, não resultados):
- endpoint **direto** (recusa `-pooler`), `*.neon.tech`, região us-east-2;
- `rejectUnauthorized: true` com validação da cadeia (raiz ISRG, no repositório de CAs do Node) **e** do nome do servidor (`tls.checkServerIdentity` aceita o host real e **rejeita** um host falso — prova de que a identidade é verificada, não só `sslmode=require`); TLS ≥ 1.2;
- `pg_stat_ssl.ssl = true` na própria sessão;
- driver do RÚSTIKA: Prisma 6.19.3 com `sslmode=require&sslaccept=strict` (o mesmo critério de `secrets.ts`, que aceita `verify-full` mas o Prisma não implementa `verify-full`; a validação estrita do certificado vem do `sslaccept=strict`) → registra `PRISMA_TLS_STRICT`. `channel_binding`: NÃO TESTADO.

## 3. Permissões testadas — ferramenta supervisionada

Arquivo: `backend/scripts/neon-probe.mjs` (não rastreado; **fora do manifesto**; não commitado). Validada offline: `node --check` OK e quatro guardas exercitadas sem rede (URL ausente, `-pooler`, endpoint divergente, `write` sem `NEON_PROBE_ALLOW_WRITE=yes` → todos abortam com código 2).

Execução (PowerShell, no terminal do proprietário; a URL é digitada com `Read-Host`, nunca no chat):
```powershell
cd backend
$env:NEON_PROBE_URL = Read-Host "URL direta do Neon"
$env:NEON_PROBE_CONFIRM_ENDPOINT = "<primeiro rótulo do host, ex.: ep-xxxx-xxxx-123456>"
node scripts/neon-probe.mjs read  ..\neon-probe-read.json
# somente após revisar a saída do modo read e autorizar:
$env:NEON_PROBE_ALLOW_WRITE = "yes"
node scripts/neon-probe.mjs write ..\neon-probe-write.json
Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_ALLOW_WRITE
```
Os JSONs de saída não contêm host, usuário, senha nem URL (valores mascarados); o proprietário pode colar apenas esse conteúdo no chat.

Plano de limpeza por objeto (executado pela própria ferramenta, só para o que ela criou, e comprovado depois):

| Objeto | Criado em | Limpeza |
|---|---|---|
| role `zz_probe_role_a` → renomeada `zz_probe_role_b` | A / B | `DROP ROLE` (na ordem reader, role_b, role_a) |
| role `zz_probe_reader` (LOGIN, senha aleatória só em memória) | A2 | `DROP ROLE` |
| banco `zz_probe_db` → `zz_probe_db_renamed` | E / F | `pg_terminate_backend` nos zz e `DROP DATABASE` |
| membership criado por `GRANT … WITH SET/INHERIT` (E2, só na role zz) | E2 | removido pelo `DROP ROLE` |

Verificações antes/depois: abort se já existir qualquer `zz_probe_*`; inventário de bancos, roles e memberships preexistentes antes e depois (`INVENTARIO_DEPOIS_IGUAL_ANTES`); consulta final de remanescentes `zz_probe_%`. Nunca renomeia `neondb`, `postgres`, branch ou roles preexistentes; sem DROP de objetos preexistentes.

## 4. Resultado de cada operação

| Teste | Resultado |
|---|---|
| A. CREATE ROLE sem LOGIN (+ A2: LOGIN, CONNECTION LIMIT, NOINHERIT) | **NÃO TESTADO / PENDENTE DE AUTORIZAÇÃO** (sem acesso) |
| B. ALTER ROLE RENAME (role do teste) | NÃO TESTADO |
| C. COMMENT ON ROLE | NÃO TESTADO |
| D. Leitura do comentário por role sem privilégios | NÃO TESTADO |
| E. CREATE DATABASE … OWNER role descartável (E2/E3 diagnóstico de `SET`/`INHERIT`) | NÃO TESTADO |
| F. ALTER DATABASE RENAME (banco do teste) | NÃO TESTADO |
| G. Conexão ao banco `postgres` | NÃO TESTADO |
| H. Catálogos (fingerprint/ACL/identidade) | NÃO TESTADO |

## 5. Renomeação de roles
NÃO TESTADO. Hipótese a confirmar: no PG16+ o `CREATEROLE` não superuser só renomeia roles sobre as quais tem `ADMIN`; quem cria a role recebe `ADMIN` automaticamente, então o teste B deve passar — mas as roles legadas do RÚSTIKA seriam criadas pelo mesmo `neondb_owner`, o que é compatível.

## 6. Comentário de identidade
NÃO TESTADO (C, D). Requisito: `COMMENT ON ROLE rustika_homolog_marker` pelo administrador e leitura via `shobj_description` por qualquer role (o runtime lê a marca). Compatibilidade da marca no Neon tem uma ressalva já documentada na C.1: **branches filhas herdam a role e o comentário** — a marca só serve de prova de isolamento se houver uma única branch por ambiente.

## 7. Renomeação de banco
NÃO TESTADO (F). A documentação do Neon prevê `ALTER DATABASE … RENAME` (de outro banco, sem conexões ativas).

## 8. Acesso ao banco `postgres`
NÃO TESTADO (G). `04-finalize-rename.sql` aborta se `current_database() <> 'postgres'`. Se a conexão ao `postgres` falhar no Neon, qualquer adaptação (p.ex. conectar a `neondb`) altera uma guarda e **depende de decisão do proprietário**; não foi feita.

## 9. Ownership e membership
NÃO TESTADO. Análise estática das migrations (sem executá-las):
- `20261104…` e `20261105…` exigem `current_user = session_user = cardapio_migrator`, PG ≥ 17, **dono do banco = o próprio migrator**, banco `cardapio_digital_test` (replay) com as duas roles de runtime existentes e **sem** atributos perigosos nem membership em que as roles-alvo sejam `member`.
- Consequências para o Neon: (i) o migrator tem de ser uma role criada por SQL (não `neondb_owner`, que é `neon_superuser`) e conectar diretamente com ela; (ii) o banco de replay precisa ser criado com `OWNER cardapio_migrator` — exige que `neondb_owner` possa "SET ROLE" para o migrator (PG16+ pode requerer `GRANT cardapio_migrator TO neondb_owner WITH SET TRUE`; teste E/E2/E3 mede exatamente isso); (iii) memberships do criador sobre as roles (ADMIN) não violam a guarda, que só olha roles-alvo como `member`; (iv) `ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator` é executado pelo próprio migrator — OK; (v) a role marcadora não é tocada pelas migrations.
- Runtime com privilégios mínimos: roles criadas por SQL ficam sem `neon_superuser`, o que é favorável; precisam de `CONNECT` explícito e `USAGE` no schema (as migrations já concedem). Não há razão documentada para o runtime exigir mais do que no cluster local.

## 10. Evidências de limpeza
Não aplicável: nada foi criado no Neon. A ferramenta produz as evidências (`LIMPEZA_*`, `REMANESCENTES_zz_probe`, `INVENTARIO_DEPOIS_IGUAL_ANTES`). Limpeza completa **não é afirmada** enquanto o ensaio não rodar.

## 11. Integridade dos objetos originais
NÃO TESTADO no Neon (nada foi alterado). No repositório: `migrations/` não foi tocado; a ferramenta é um arquivo novo não rastreado.

## 12. Compatibilidade com migrations
Pendente de comprovação prática. Pontos que o ensaio decide: versão 18.6 (≥ 17 ✔ informado); `CREATE DATABASE OWNER` com membership (E); rename de roles/banco (B/F); conexão ao `postgres` (G); `pg_stat_ssl` (identidade); leitura da marca por role comum (D). **Replay das sete migrations: NÃO TESTADO e NÃO AUTORIZADO nesta etapa.**

## 13. Bloqueios encontrados
1. **Sem credencial segura** → todos os testes contra o Neon ficaram pendentes (único bloqueio concreto).
2. Nenhuma incompatibilidade comprovada.

## 14. Riscos de segurança
- A URL da role `neondb_owner` (CREATEROLE, BYPASSRLS, `pg_write_all_data`) é uma credencial poderosa: digitar só no terminal local, não salvar em arquivo, remover `NEON_PROBE_URL` ao final e **rotacionar/redefinir a senha depois do ensaio** (recomendado, é um projeto descartável).
- `GRANT … WITH SET TRUE, INHERIT TRUE` (E2) amplia privilégios do `neondb_owner` somente sobre uma role `zz_probe_*`, removido pelo `DROP ROLE`; é diagnóstico e pode ser ajustado ou removido do script antes de rodar.
- Guardas não foram enfraquecidas: sem TLS permissivo, sem editar `04-finalize-rename.sql`, sem tocar migrations.
- Branch herdando a marca (R-N3 da C.1).

## 15. Custos
R$ 0. O ensaio é curto (segundos de compute); respeita os 100 CU-h do Free; sem recurso pago; scale-to-zero pode causar um cold start na primeira conexão (a ferramenta usa timeout de 30 s).

## 16. Recomendações
1. O proprietário rodar `read`, conferir a saída e colar no chat apenas o JSON mascarado.
2. Autorizar o modo `write` (somente `zz_probe_*`) após revisar o `read`; ler as linhas `E_*`/`F_*`/`G_*`.
3. Redefinir a senha de `neondb_owner` ao concluir.
4. Só depois decidir adaptações (membership via `GRANT … WITH SET`, conexão ao banco administrativo) — sem implementá-las agora.

## 17. Próxima etapa
**3D.5.3-C.2 (execução supervisionada)**: executar `read` → avaliar → `write`; relatório de resultados com a classificação COMPROVADO/INCOMPATÍVEL por teste. Em seguida **C.3** (replay das sete migrations em branch descartável) apenas se E, F, G e D forem comprovados, e **3D.5.3-D** (Render) somente depois. Nenhuma adaptação de scripts ou deploy antes da avaliação do ChatGPT.

---

# ADENDO — verificação independente (2026-11-06, mesma etapa C.2)

Esta seção foi acrescentada por uma segunda sessão que repetiu as pré-verificações. **O status geral continua PENDENTE**: `NEON_PROBE_URL`, `NEON_PROBE_CONFIRM_ENDPOINT`, `NEON_PROBE_ALLOW_WRITE` e `DATABASE_URL` não estão definidos no ambiente (conferido só por presença, sem ler valores); nenhuma conexão ao Neon foi feita; nada foi escrito, criado ou removido em banco algum; o PostgreSQL local não foi tocado; sem migrations, Render, deploy, commit ou push.

## A1. Localização e inspeção (COMPROVADO, repositório)
- O projeto RÚSTIKA é `C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital` (branch `main`, HEAD `3b857ad`; a árvore já tinha muitas alterações não commitadas anteriores a esta etapa). Os scripts 01–09 estão em `backend/ops/homolog/sql/`; as sete migrations em `backend/prisma/migrations/`. **Nenhuma foi modificada** por esta etapa.
- `backend/scripts/neon-probe.mjs` revisado linha a linha: recusa `-pooler`, exige `NEON_PROBE_CONFIRM_ENDPOINT`, `*.neon.tech` em us-east-2, `rejectUnauthorized: true` + verificação do nome do servidor, aborta se existir `zz_probe_*`, só cria nomes fixos `zz_probe_*`, limpa só o que criou e compara o inventário antes/depois. Reverificado offline: `node --check` OK; execução sem URL aborta com código 2. Sem credenciais embutidas.

## A2. Achados da análise estática (NÃO executado; hipóteses a serem decididas pelo ensaio)
1. **Tensão entre `03-verify-replay.sql` e a membership do criador.** Desde o PostgreSQL 16, quando uma role não superusuária com `CREATEROLE` (caso de `neondb_owner`, via `neon_superuser`) executa `CREATE ROLE`, ela recebe automaticamente `ADMIN OPTION` na role nova (linha em `pg_auth_members` com `roleid = cardapio_migrator`, `member = neondb_owner`). O `03` aborta com `ROLES: memberships inesperadas` se **qualquer** linha tiver `roleid` ou `member` `LIKE 'cardapio\_%'`. Ou seja, o `03` provavelmente falharia no Neon mesmo com tudo correto. As migrations (guarda `member IN (target_role, other_role)`) e o `09` (`member IN roles do projeto`) **não** seriam afetados, pois o membro ali é `neondb_owner`. Isto corrige o item (iii) da seção 9 acima, que só considerava as migrations. Comportamento do PG16 vem da documentação do PostgreSQL, não da do Neon (que não o descreve).
2. **Dependência cruzada 02/04.** `CREATE DATABASE … OWNER cardapio_migrator` (script 02) e `ALTER ROLE … RENAME` (script 04) exigem, no PG16+, que o administrador não superusuário tenha respectivamente poder de `SET ROLE` e `ADMIN` sobre a role. Então remover a membership antes do `03` (`REVOKE`) provavelmente quebraria o `04`. O ensaio mede isso (teste A: `membershipsDoCriador`; B; E/E2/E3). Resultado: NÃO TESTADO.
3. **Conexão ao banco `postgres` (script 04, guarda `current_database() <> 'postgres'`).** A documentação do Neon reserva o nome `postgres`, mas **não afirma** que o banco exista nem aceite conexão; ela orienta renomear a partir de *outro* banco da mesma branch (ex.: `neondb`). Teste G decide. Se falhar, a adaptação seria trocar a guarda para um banco administrativo — **mudança de guarda; decisão do proprietário; não feita**.
4. **Guardas de catálogo do `03`** (zero event triggers, policies, funções/views/triggers em `public`, um único schema não-`pg_`): o Neon concede `CREATE EVENT TRIGGER` à `neon_superuser` e pode haver objetos próprios em bancos criados por ele; o ensaio só *conta* esses catálogos no `neondb` (H). Sugestão para a execução supervisionada: também listar schemas e event triggers do banco `zz_probe_db` criado a partir de `template0`. Isso **não** está na ferramenta atual (não implementado).
5. **Fingerprint/ACL:** `ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator` é executado pelo próprio migrator → compatível. `current_user = session_user = cardapio_migrator` exige login direto com a senha da role; o endpoint direto serve; o *pooler* (PgBouncer em modo transaction) não é apropriado para migrations, por isso `-pooler` é proibido.

## A3. Documentação oficial do Neon consultada em 2026-11-06 (neon.com/docs)
| Tema | O que a página diz | Lacuna |
|---|---|---|
| Roles (`manage/roles`, atualizada 2026-11-05) | `neon_superuser` é NOLOGIN e inclui CREATEDB, CREATEROLE ("pode alterar e remover roles"), BYPASSRLS, REPLICATION, `pg_read/write_all_data`, event triggers. A role padrão (`neondb_owner`) pertence a `neon_superuser`. Roles criadas por `CREATE ROLE` **não** recebem `neon_superuser` e só têm privilégios básicos. Senha por SQL, texto puro, ≥ 60 bits de entropia. Máx. 500 roles/branch; nomes `pg_*`, `neon_superuser`, `cloud_admin` etc. reservados. | Não afirma ADMIN automático do criador, `createrole_self_grant`, nem se CREATEROLE renomeia roles; não trata de comentários de role. |
| Bancos (`manage/databases`, 2026-10-03) | Dono = role que executa `CREATE DATABASE`; `ALTER DATABASE … RENAME` é instantâneo, não se renomeia o banco conectado (conectar a outro banco da branch), `pg_terminate_backend` para sessões bloqueantes; dados/roles/grants preservados; `postgres`, `template0`, `template1` reservados; 500 bancos/branch; bancos são copiados para branches filhas. | Não diz se o banco `postgres` aceita conexão. |
| TLS (`connect/connect-securely`, 2026-06-05) | TLS obrigatório; `sslmode`: `require` < `verify-ca` < `verify-full` (recomendado); raiz **ISRG Root X1**; `channel_binding=require` opcional. | Não cobre node-postgres. |
| Erros de conexão (`connect/connection-errors`, 2026-09-16) | Prisma Migrate **não** suporta pooler. Cita `ssl: {'sslmode': 'require'}` para node-postgres, forma que não confere com a API do `pg`; não usada (a ferramenta usa `rejectUnauthorized: true`). | — |
| Pooler (`connect/connection-pooling`, 2026-10-19) | PgBouncer em modo *transaction*; sem `SET`/`RESET`, `LISTEN/NOTIFY`, advisory locks de sessão; migrations e tarefas administrativas devem usar conexão **direta**. | — |
| Plano Free (`introduction/plans`, 2026-11-04) | 100 CU-h/projeto/mês, 1 GB/projeto, 10 branches, scale-to-zero após 5 min (não desativável), 5 GB de transferência. | Máx. de conexões do Free não está nesta página; a de compatibilidade dá 839 para 0,25–2 CU (os `CONNECTION LIMIT` dos scripts cabem). |
| Compatibilidade (`reference/compatibility`, 2026-09-17) | PG 14–18; não há conexão como `superuser`; `CREATE TABLESPACE` gera erro; `password_encryption = scram-sha-256`. | `ALTER SYSTEM` e `pg_hba` não documentados na página. |
| Branches | Branches filhas **duplicam roles** (exceto as de ponto no tempo anteriores à criação da role) e copiam bancos. | **Não** documenta comentários de role; a herança da marca de identidade segue como risco a confirmar (R-N3 da C.1). |

Nota: duas das consultas vieram de um agente auxiliar de leitura e a página de planos foi parcialmente resumida; valores de plano devem ser reconferidos no console antes de qualquer decisão financeira. Custo desta etapa: R$ 0 (nenhum recurso pago, nenhum `neon deploy`).

## A4. Classificação consolidada dos testes (todos sem conexão)
A, B, C, D, E (incl. E2/E3/E4), F, G, H → **NÃO TESTADO** (causa única: credencial não fornecida de forma segura). Execução **PENDENTE DE AUTORIZAÇÃO do proprietário** conforme a seção 3. Limpeza: nada a limpar; nenhum `zz_probe_*` foi criado. Integridade dos objetos originais: nenhum objeto Neon foi tocado; migrations e scripts SQL do repositório permanecem como estavam.

## A5. Decisões para o proprietário/ChatGPT antes de qualquer adaptação
1. Executar o `read` e, se aprovado, o `write` da ferramenta (instruções na seção 3), colando no chat apenas o JSON mascarado.
2. Se o teste A confirmar a membership automática, decidir como compatibilizar o `03` (exceção explícita para o administrador do cluster, mantendo a verificação entre as roles `cardapio_*`) — **não implementado**.
3. Se G falhar, decidir a guarda alternativa do `04`.
4. Redefinir a senha de `neondb_owner` após o ensaio. Nada de Render até a C.2 ser concluída.
