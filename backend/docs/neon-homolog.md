# Homologação RÚSTIKA no Neon Free (perfil `app-homolog-neon`)

**Status: perfil bloqueado por padrão.** Nenhum tráfego é aceito sob este perfil a menos que `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` seja definido com o valor exato documentado na seção 13, **e** todas as verificações das seções 3–6 passem. Esta é a leitura exigida antes de definir essa variável (3D.5.3-C.5/C.5.1). Autorização coberta: correções locais, testes offline e esta documentação — **nada aqui autoriza provisionamento real, migrations, deploy ou dados reais** (seção 18).

## 1. Arquitetura: Neon Free + Render Free

```
Navegador → HTTPS → Render (Web Service, Free, Express)
                        │  frontend estático (dist) + /api
                        │  Prisma (perfil app-homolog-neon)
                        ▼
                  Proxy do Neon (termina o TLS externo, roteia por SNI)
                        │
                        ▼
                  Compute PostgreSQL do Neon (branch `production`)
```

Dois serviços gratuitos, cada um com seu próprio ciclo de suspensão: o Render Free dorme por inatividade e o compute do Neon Free também ("scale to zero", após ~5 min). O primeiro acesso depois de qualquer um dos dois dormir sofre *cold start* (latência alta na primeira requisição). Orçamento obrigatório desta homologação: **R$ 0/mês** — nenhuma peça paga em nenhuma das duas pontas.

## 2. TLS externo × `pg_stat_ssl`: a diferença central

- **TLS externo**: o que ESTE processo comprova sobre a conexão que ele mesmo abriu até o Neon — cadeia de certificado (CA, aqui o ISRG Root X1 do Let's Encrypt), nome do servidor (SNI) e protocolo (TLS ≥ 1.2). Implementado em `src/config/externalTlsCheck.ts`, auditado em 3D.5.3-C.2.2 com servidores TLS locais reais (não mocks de rede) e reusado por `src/config/neonServerIdentity.ts`.
- **`pg_stat_ssl.ssl`**: o que o **processo PostgreSQL** vê sobre a sessão que chega até ele. No Neon, o TLS do cliente termina no **proxy** do provedor; o trecho proxy→compute não passa necessariamente pelo mesmo TLS, e por isso `pg_stat_ssl.ssl` aparece como `false`/`null` mesmo quando o TLS externo foi validado com sucesso (comprovado no ensaio real da C.4: TLS 1.3 com CA/hostname válidos, e ainda assim `pg_stat_ssl.ssl=false`).
- **Por que isso não é tratado como falha automática**: o cluster PostgreSQL dedicado (perfil `app-homolog`, usado fora do Neon) continua exigindo `pg_stat_ssl.ssl=true` sem exceção (`src/config/serverIdentity.ts`, inalterado). Essa exigência não é **preservável** no Neon por uma razão de arquitetura do provedor, não por uma falha de configuração nossa — por isso o Neon tem uma política **diferente**, nunca uma versão "relaxada" da mesma política.
- **Limite honesto, mantido explicitamente no código** (`neonServerIdentity.ts`): a verificação de TLS externo roda numa conexão **independente**, aberta só para isso — não a conexão que o Prisma usa para servir tráfego (o motor do Prisma não expõe o socket TLS ao código JavaScript). A verificação complementar em `src/server.ts` faz o **próprio** cliente Prisma confirmar banco/role antes de aceitar tráfego, usando os mesmos parâmetros estritos de URL (`sslmode=require&sslaccept=strict`, nunca relaxáveis por `secrets.ts`). Isso reduz a distância entre "uma sonda separada funcionou" e "o cliente real funciona", mas **não é** prova do socket do Prisma em si. Em nenhum lugar deste projeto se afirma "TLS comprovado até o processo PostgreSQL" para o perfil Neon — essa frase só vale para `app-homolog` (cluster dedicado), onde `pg_stat_ssl` prova exatamente isso.

## 3. Garantias comprovadas

- TLS externo 1.3, com CA e hostname validados, na conexão independente (ensaio real C.4; lógica auditada com testes de certificado inválido e hostname incorreto em `tests/config/external-tls-check.test.ts`).
- `neon.project_id` exposto pelo servidor e conferido contra o projeto esperado (ensaio real C.4).
- `CREATE ROLE` (sem/com LOGIN), `ALTER ROLE RENAME`, `COMMENT ON ROLE` e leitura do comentário por role sem privilégio administrativo: aprovados no ensaio real (C.4).
- `CREATE DATABASE ... OWNER` falha com `SQLSTATE 42501` sem a membership adequada, e passa a funcionar depois do `GRANT ... WITH SET TRUE, INHERIT FALSE` (ensaio real C.4; confirmado na documentação do PostgreSQL que vincula o owner creation à habilidade de SET ROLE).
- `ALTER DATABASE ... RENAME` exige elevação adicional (`INHERIT TRUE`), pois a verificação interna de ownership durante a renomeação (has_privs_of_role) exige herança. O incidente 42501 no ensaio C.5.2 foi diagnosticado e mitigado separando as permissões na etapa C.5.3 (script `01b-elevate-inherit-for-rename.sql`).
- Limpeza completa dos objetos de ensaio e inventário preexistente preservado (ensaio real C.4).
- As sete migrations históricas e seus checksums permanecem intactos (verificado nesta e em todas as etapas anteriores; nenhuma migration foi alterada para acomodar o Neon).

## 4. Garantias não comprovadas

- O trecho proxy→compute do Neon não é observável nem comprovável pelo cliente — nenhuma documentação oficial do Neon confirma ou nega que esse trecho seja criptografado (3D.5.3-C.2.2).
- `GRANT cardapio_migrator TO <admin> WITH SET TRUE, INHERIT FALSE` seguido de elevação com `INHERIT TRUE` para `ALTER DATABASE RENAME` foram auditados localmente na C.5.3, pendente o novo ensaio real.
- Os scripts `ops/homolog/sql/neon/01-grant-set-true-migrator.sql`, `01b-elevate-inherit-for-rename.sql` e `02-revoke-set-true-migrator.sql` não foram executados contra o Neon.
- O boot real do perfil `app-homolog-neon` contra um banco Neon definitivo (`cardapio_digital_homolog`) ainda não foi ensaiado.
- O comportamento de `neon.project_id` em branches filhas do mesmo projeto não está documentado pelo Neon.

## 5. Riscos residuais aceitos exclusivamente para homologação

Nenhum destes é aceitável para produção real sem reavaliação:
- **TLS do trecho interno não comprovável** — mitigado por TLS externo validado + `neon.project_id` + marca de homologação, nunca "resolvido".
- **Branches filhas herdam a role-marca** (`rustika_homolog_marker`) — disciplina operacional exigida: uma única branch por ambiente, nunca criar branch filha da branch de homologação.
- **Cold start duplo** (Render + Neon) — aceitável só porque não há SLA de homologação.
- **Formato do `EXPECTED_PROJECT_ID`** validado por um padrão observado num único exemplo (`aged-scene-47291697`); falha fechada se o Neon mudar o formato.
- **Credencial administrativa do projeto** (`neondb_owner`) é poderosa (`CREATEDB`, `CREATEROLE`); o procedimento da seção 8 limita a exposição dela no tempo (janela de `GRANT`/`REVOKE`), mas ela mesma nunca é restringida por este projeto — é a role que o Neon cria.

## 6. Identidade do projeto e marca do RÚSTIKA

Quatro verificações independentes, todas obrigatórias (`evaluateNeonServerIdentity`, em `neonServerIdentity.ts`):
1. **TLS externo** (seção 2).
2. **`neon.project_id`** — GUC exposto pelo servidor, comparado a `EXPECTED_PROJECT_ID` (formato `palavra-palavra-dígitos`, ex. `aged-scene-47291697`).
3. **Marca de homologação** — a mesma técnica do cluster dedicado: uma role `NOLOGIN` chamada `rustika_homolog_marker`, com um comentário (`COMMENT ON ROLE`) contendo um UUID (`EXPECTED_CLUSTER_ID`), criada pelo script `01-cluster-roles.sql` (comum aos dois procedimentos).
4. **Banco, role, versão do PostgreSQL (≥ 17) e ausência de bancos de desenvolvimento/replay** (`cardapio_digital_dev`, `cardapio_digital_shadow`, `cardapio_digital_test`).

Falhar qualquer uma destas quatro verificações impede o boot (seção 14).

## 7. Procedimento de provisionamento (ordem completa, nada executado)

Ver `backend/ops/homolog/sql/neon/README.md`. Resumo:

1. `../01-cluster-roles.sql` (comum; cria as roles legadas e a marca).
2. **`neon/01-grant-set-true-migrator.sql`** — concede a habilidade de `SET ROLE` sobre `cardapio_migrator` à role administrativa do projeto (seção 8).
3. `../02-create-replay-database.sql` — `CREATE DATABASE ... OWNER cardapio_migrator`.
4. `../03-verify-replay.sql` — depois do replay das sete migrations pelo Prisma, autenticado como `cardapio_migrator`.
5. `../04-finalize-rename.sql` — renomeia banco e roles para a identidade definitiva.
6. **`neon/02-revoke-set-true-migrator.sql`** — fecha a janela de privilégio.
7. `../05-post-migration-grants.sql` em diante — inalterados.

`neon/03-verify-ownership.sql` (leitura) deve rodar antes do passo 2 e depois do passo 6, para comparar o inventário "antes"/"depois".

## 8. Membership e ownership — por que `SET TRUE, INHERIT FALSE` seguido de `INHERIT TRUE`

No Neon, uma role criada por `CREATE ROLE` comum (não `neon_superuser`) só recebe `ADMIN` sobre si mesma para quem a criou — sem `SET` nem `INHERIT` (PostgreSQL ≥ 16). Sem um dos dois, `CREATE DATABASE ... OWNER cardapio_migrator` e `ALTER DATABASE ... RENAME` falham com `SQLSTATE 42501` para a role administrativa do projeto (ensaio real, 3D.5.3-C.3/C.4).

A documentação oficial do PostgreSQL (página "Role Membership", texto idêntico nas versões 16 e 18) é explícita sobre **qual** dos dois resolve a **criação do dono**:

> "To create an object owned by another role or give ownership of an existing object to another role, you must have the ability to **SET ROLE** to that role; otherwise, commands such as `ALTER ... OWNER TO` or `CREATE DATABASE ... OWNER` will fail."

Contudo, `ALTER DATABASE ... RENAME` exige a checagem interna de `has_privs_of_role`, que requer **INHERIT**. No ensaio 3D.5.3-C.5.2, a ausência de `INHERIT` causou falha na renomeação.

**Decisão implementada na 3D.5.3-C.5.3:**
1. `GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE` (para `CREATE DATABASE ... OWNER`).
2. Elevação temporária com `INHERIT TRUE` exclusivamente para o `ALTER DATABASE ... RENAME` via `01b-elevate-inherit-for-rename.sql`.
3. Revogação completa logo após o rename (`02-revoke-set-true-migrator.sql`).

**Quando é concedido / revogado**: concedido depois de `01-cluster-roles.sql` e antes de `02-create-replay-database.sql`; elevado antes do script `04`; revogado depois de `04-finalize-rename.sql` e antes de `05-post-migration-grants.sql`. A membership segue o OID da role através do `ALTER ROLE RENAME`, então o script de revogação usa o nome **já renomeado** (`cardapio_homolog_migrator`).

**Efeito da revogação sobre migrations futuras**: nenhum. Toda migration (passada ou futura) conecta-se **diretamente** como `cardapio_homolog_migrator`, com a senha própria dessa role — nunca através da membership da role administrativa, que só serve para as duas operações de ownership dos scripts 02 e 04.

**Prova do dono definitivo do banco**: `03-verify-ownership.sql`, item 1 — `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'cardapio_digital_homolog'`, antes e depois.

## 9. Separação das roles

- `01-grant-set-true-migrator.sql` concede **somente** à role `cardapio_migrator` (a migradora legada). Um guarda explícito (`RAISE EXCEPTION`) recusa o script se o executor ou o alvo for qualquer role de runtime/placeholder (`cardapio_test_app`, `cardapio_dev_app`, `cardapio_homolog_app`, `cardapio_homolog_placeholder`) — mesmo que o script seja copiado ou adaptado por engano.
- A role de runtime (`cardapio_homolog_app`) nunca aparece em nenhum `GRANT`/`REVOKE` destes dois scripts.
- `03-verify-ownership.sql`, item 3, confirma a ausência de `rolsuper`/`rolcreaterole`/`rolcreatedb`/`rolreplication`/`rolbypassrls` nas quatro roles de runtime/placeholder; item 4 confirma que nenhuma role do RÚSTIKA é membro de `neon_superuser`.
- Nenhum dos dois scripts executa `ALTER ROLE` sobre qualquer role preexistente do Neon (`neondb_owner`, `neon_superuser`, `cloud_admin` etc.) — eles só criam/removem uma **membership** (`GRANT`/`REVOKE` de papel), nunca alteram atributos de role alguma.

## 10. Migrations históricas

As sete migrations (`prisma/migrations/2026102...` a `2026110600...`) e seus checksums não são alteradas por nenhum destes procedimentos. Elas continuam exigindo `current_user = session_user = cardapio_migrator` e PostgreSQL ≥ 17 — satisfeito pelo PostgreSQL 18.6 do Neon (ensaio real).

## 11. Uso do endpoint direto

Toda operação administrativa (os scripts `01-09` e `neon/01-03`) e toda conexão de runtime do perfil `app-homolog-neon` devem usar o endpoint **direto** do Neon (sem o sufixo `-pooler`). O pooler (PgBouncer, modo transação) não garante que comandos de uma mesma sessão lógica cheguem ao mesmo backend PostgreSQL, o que é incompatível com `DO`/`SET ROLE`/sessões transacionais dos scripts de provisionamento. `secrets.ts` recusa automaticamente qualquer host `-pooler` para o perfil `app-homolog-neon`; para os scripts manuais, a recusa é só documental (cabeçalho dos arquivos) — não há enforcement de código para uma sessão humana no SQL Editor.

## 12. Variáveis de ambiente necessárias (sem valores sensíveis)

| Variável | Propósito |
|---|---|
| `DB_PROFILE=app-homolog-neon` | Seleciona este perfil. |
| `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` | Reconhecimento humano explícito (seção 13); valor exato em `neonServerIdentity.ts`, nunca citado aqui. |
| `CARDAPIO_SECRETS_DIR` ou `CARDAPIO_SECRETS_SOURCE=env` + `RUSTIKA_HOMOLOG_DATABASE_URL`/`RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST`/`RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID`/`RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID` | Origem dos segredos (arquivo `app-homolog-neon.env` ou variáveis, conforme `secrets.ts`). |
| Dentro da própria `DATABASE_URL`: `sslmode=require` (ou `verify-ca`/`verify-full`) e `sslaccept=strict` | Exigidos por `secrets.ts`; nunca podem ser relaxados. |

Nenhuma senha, connection string completa ou UUID real é citado neste documento.

## 13. Significado do reconhecimento humano explícito

`RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` existe para que a divergência da seção 2 (`pg_stat_ssl=false` com TLS externo comprovado) nunca seja tratada como um bug contornado silenciosamente. Ele significa **apenas**: *"eu li esta documentação e aceito que o PostgreSQL do Neon não reporta `pg_stat_ssl=true`, porque o TLS termina no proxy do provedor, e aceito a verificação alternativa (TLS externo + `neon.project_id` + marca + confirmação do Prisma) como suficiente para a homologação."*

Ele **nunca** significa, e o código nunca o trata como significando: ignorar um certificado inválido, um hostname incorreto, um projeto errado, uma marca ausente, um banco/role errado ou uma versão incompatível do PostgreSQL. Nenhuma dessas falhas é dispensada pelo reconhecimento — todas continuam bloqueando a inicialização com ou sem ele (ver o teste estático em `tests/config/neon-homolog-gate.test.ts`, que confirma a ordem: o reconhecimento é checado antes de qualquer conexão, e a avaliação de identidade/TLS continua valendo depois).

## 14. Critérios de bloqueio

O processo encerra com `process.exit(1)`, **sem aceitar tráfego**, se qualquer um destes faltar:
- `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` ausente ou com valor diferente do exato.
- TLS externo não comprovado (certificado inválido, hostname incorreto, protocolo < TLS 1.2).
- `neon.project_id` ausente ou diferente do esperado.
- Marca de homologação (`rustika_homolog_marker`) ausente ou com UUID diferente.
- Banco ou role conectados diferentes dos definitivos.
- PostgreSQL < 17.
- Qualquer banco de desenvolvimento/replay (`cardapio_digital_dev`/`shadow`/`test`) ainda presente.
- O cliente Prisma não conseguir confirmar banco/role com os mesmos parâmetros estritos (verificação complementar).

`pg_stat_ssl=false`/`null` **nunca**, por si só, está nesta lista.

## 15. Backup e restauração

Não implementado nem avaliado nesta etapa. O Neon Free mantém uma janela de histórico de até 6 horas de alterações (ver seção 16) e permite restauração dentro dela pelo console; isto não substitui um backup gerenciado pelo RÚSTIKA e não deve ser assumido como suficiente antes de qualquer dado real (proibido — seção 18).

## 16. Limites do Neon Free

100 CU-h/projeto/mês; computação até 2 CU (8 GB RAM) com autoscaling; "scale to zero" após ~5 min de inatividade (não pode ser desligado); 1 GB de armazenamento por projeto (20 GB por conta); até 10 branches por projeto; 100 projetos por conta; janela de histórico de alterações de até 6 horas (até 1 GB); 5 GB de transferência de rede por projeto; 1 snapshot manual. (Fonte: documentação pública do Neon, 3D.5.3-C.1.)

## 17. Critérios de prontidão para Render

Antes de considerar o deploy no Render (3D.5.3-D) com este perfil:
1. Este documento revisado e aprovado.
2. Execução supervisionada completa da seção 7, com `neon/03-verify-ownership.sql` comprovando o estado "antes"/"depois".
3. Primeira subida real do perfil `app-homolog-neon` contra o banco definitivo do Neon, com todos os critérios da seção 14 aprovados (não simulados).
4. `RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK` definido deliberadamente no ambiente do Render (nunca copiado de outro ambiente sem reler este documento).
5. Confirmação de que o Render tem as mesmas variáveis da seção 12, com a `DATABASE_URL` apontando para o endpoint direto do Neon.

## 18. Proibição de pedidos e dados reais

Este perfil e este procedimento são **exclusivos de homologação**. Fica proibido, até autorização expressa e posterior:
- Inserir qualquer pedido, dado de cliente ou dado real no banco do Neon.
- Tratar este ambiente como produção, para qualquer finalidade.
- Reutilizar as credenciais ou a connection string deste ambiente em outro ambiente.
- Remover ou contornar qualquer critério de bloqueio da seção 14 "para liberar" um deploy.
