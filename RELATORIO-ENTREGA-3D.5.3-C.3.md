# RELATÓRIO DE ENTREGA — 3D.5.3-C.3
## Auditoria final do modo write do `neon-probe.mjs` (offline)

Data: 2026-11-07. **Nenhum SQL de escrita foi executado, nenhuma conexão ao Neon foi aberta nesta etapa.** Sem migrations, Render, deploy, commit ou push. `serverIdentity.ts` não foi alterado. As migrations históricas não foram tocadas (as duas `…05…` e `…06…` aparecem como "não rastreadas" no Git do projeto original desde antes; o conteúdo é idêntico ao do snapshot publicado, `diff -rq` sem diferenças).

Base: o teste read real aprovou TLS externo 1.3, projeto, PG 18.6, `neondb`/`neondb_owner`, Prisma estrito, banco `postgres`, nenhum `zz_probe_*` prévio, inventário antes/depois idêntico e `pg_stat_ssl=false` registrado como divergência.

## 1. Auditoria das operações A a H

| Op | SQL / ação | Alvo | Pode atingir objeto preexistente? | Reversão |
|---|---|---|---|---|
| A | `CREATE ROLE "zz_probe_<id>_role_a" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT` | nova role | Não (nome novo; duplicado → erro 42710 e o nome sai do conjunto "meu") | `DROP ROLE IF EXISTS` |
| A2 | `CREATE ROLE "…_reader" LOGIN PASSWORD '<aleatória>' … CONNECTION LIMIT 2` | nova role | Não | `DROP ROLE` |
| B | `ALTER ROLE "…_role_a" RENAME TO "…_role_b"` | só a role criada em A | Não (origem e destino são nomes desta execução) | `DROP ROLE` de ambos |
| C | `COMMENT ON ROLE "…_role_b" IS 'zz-probe-marker:<uuid>'` | só a role do teste | Não | some com a role |
| D | login como `…_reader` (sessão read-only) e leitura de `shobj_description` | leitura | — | `end()` |
| E | `CREATE DATABASE "…_db" OWNER "…_role_b" ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40` | novo banco | Não | `DROP DATABASE IF EXISTS` |
| E2 | `GRANT "…_role_b" TO "neondb_owner" WITH SET TRUE, INHERIT TRUE` | só a role do teste (opt-in) | Não altera `neondb_owner`, só cria uma membership dele na role descartável | some no `DROP ROLE` |
| E4 | `REVOKE ALL ON DATABASE "…_db" FROM PUBLIC`; `GRANT CONNECT ON DATABASE "…_db" TO "…_reader"` | só o banco do teste | Não | some com o banco |
| F | `ALTER DATABASE "…_db" RENAME TO "…_db_renamed"` | só o banco do teste | Não | `DROP DATABASE` |
| G | conexão a `postgres` (sessão read-only) | leitura | — | `end()` |
| H | `SELECT` em catálogos | leitura | — | — |

Teste estático novo (22/22 testes passando, `node --test scripts/neon-probe-checks.test.mjs`): toda instrução `CREATE/ALTER/DROP/GRANT/REVOKE/COMMENT` do código pertence a uma **lista fechada** e usa apenas identificadores derivados desta execução; não existe `TRUNCATE`, `DELETE`, `INSERT`, `UPDATE … SET`, `ALTER SYSTEM`, `DROP SCHEMA/TABLE/OWNED`, `REASSIGN OWNED`, nem DROP envolvendo `neondb`.

## 2. Riscos encontrados e correções pontuais (já aplicadas no script)

1. **Concorrência (real)**: com nomes fixos, outro processo criando `zz_probe_role_a` entre a pré-checagem e o `CREATE` faria a limpeza apagar o objeto alheio. → nomes agora **únicos por execução** (`zz_probe_<8 hex>_…`); `assertOwned()` recusa remover qualquer nome fora do conjunto desta execução; `42710/42P04` (já existia) retira o nome do conjunto.
2. **Ctrl+C / SIGTERM deixava resíduos**: o handler só imprimia e saía. → agora executa a **limpeza** antes de sair (códigos 130 limpo / 4 incompleto).
3. **Conexão perdida (timeout, suspensão do compute)** impedia a limpeza. → a limpeza testa `SELECT 1` e, se preciso, abre **nova conexão**; 3 tentativas por objeto (3 s entre elas); verificação final também com conexão nova.
4. **`statement_timeout` de 30 s** podia abortar `CREATE DATABASE` sob carga. → 120 s no modo write.
5. **Código de saída sempre 0**. → `exitCode=3` se houver resíduo, inventário divergente ou falha de limpeza.
6. **Projeto**: em write o `neon.project_id` agora é **obrigatório** e deve igualar `aged-scene-47291697` (no read já foi comprovado que o servidor o expõe); sem isso o script aborta antes de escrever.
7. **Reprodutibilidade**: a pré-checagem continua recusando qualquer `zz_probe_%` remanescente de execuções anteriores (exige revisão humana).

Riscos residuais aceitos (documentados): (a) a senha aleatória do `…_reader` trafega num `CREATE ROLE` (pode aparecer em logs de consulta do provedor; role descartada logo depois; o Neon não aceita senha já com hash); (b) inventário "antes/depois" pode divergir se algo for alterado no console durante a execução — o script avisa e exige investigação; (c) o `neondb_owner` é uma credencial poderosa — redefinir a senha depois do ensaio.

## 3. `COMMENT ON ROLE`, ownership e membership

- **COMMENT ON ROLE**: exige CREATEROLE e ADMIN sobre a role-alvo; o criador de uma role recebe ADMIN automaticamente (PG ≥ 16), portanto C deve funcionar. O valor é uma constante com UUID gerado localmente (sem entrada externa). D mede o que o runtime real faria: uma role comum, sem privilégios, ler a marca.
- **Ownership/membership e `NEON_PROBE_ALLOW_GRANT`**: **é necessária na prática** (raciocínio a partir do comportamento documentado do PostgreSQL ≥ 16, **não comprovado no Neon**): `CREATE ROLE` por um `CREATEROLE` não superuser concede apenas ADMIN, sem SET nem INHERIT; `CREATE DATABASE … OWNER x` exige poder fazer `SET ROLE x` (E tende a falhar sem E2) e `ALTER DATABASE … RENAME` exige privilégios do dono (INHERIT) (F tende a falhar sem E2). Esse é exatamente o cenário dos scripts 02 e 04 do RÚSTIKA (banco do `cardapio_migrator` criado e renomeado pelo administrador). O GRANT atinge **somente** a role `zz_probe_<id>_role_b` e desaparece com o `DROP ROLE`. Recomendação: aprovar `NEON_PROBE_ALLOW_GRANT=yes`; sem ele o ensaio provavelmente termina em E com informação limitada. Alternativa mais restrita (não implementada): `SET createrole_self_grant = 'set, inherit'` na sessão antes do `CREATE ROLE`, que produz o mesmo efeito sem `GRANT` explícito.

## 4. Plano de rollback e limpeza

Automático (por ordem): `pg_terminate_backend` apenas das sessões nos bancos `zz_probe_<id>_*` → `DROP DATABASE IF EXISTS` (db e db_renamed) → `DROP ROLE IF EXISTS` (reader, role_b, role_a). Falha parcial ou timeout: nova conexão e 3 tentativas. Depois: consulta de remanescentes `zz_probe_%` e comparação do inventário (bancos, roles, memberships preexistentes).

Manual de contingência (somente se o JSON apontar resíduo; usar **apenas os nomes listados** em `REMANESCENTES_zz_probe`, no SQL Editor do Neon, nesta ordem):

    DROP DATABASE IF EXISTS "zz_probe_<id>_db_renamed";
    DROP DATABASE IF EXISTS "zz_probe_<id>_db";
    DROP ROLE IF EXISTS "zz_probe_<id>_reader";
    DROP ROLE IF EXISTS "zz_probe_<id>_role_b";
    DROP ROLE IF EXISTS "zz_probe_<id>_role_a";

Último recurso (não esperado; projeto descartável e vazio): janela de restauração de 6 h do Free. Nunca apagar o projeto nem objetos que não sejam `zz_probe_*`.

## 5. Comandos PowerShell para a futura execução supervisionada (NÃO executar ainda)

Pré-voo na mesma sessão (confirma que o estado continua limpo):

    cd "C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend"
    $sec = Read-Host "Cole a connection string DIRETA do Neon (entrada oculta)" -AsSecureString
    $env:NEON_PROBE_URL = [System.Net.NetworkCredential]::new('', $sec).Password
    $env:NEON_PROBE_CONFIRM_ENDPOINT = "ep-SEU-ENDPOINT-AQUI"
    node scripts/neon-probe.mjs read "$env:TEMP\neon-probe-preflight.json"

Somente se o pré-voo estiver todo `COMPROVADO` (exceto a divergência `pg_stat_ssl` já aceita) e **após autorização expressa**:

    $env:NEON_PROBE_ALLOW_WRITE = "yes"
    $env:NEON_PROBE_ALLOW_GRANT = "yes"
    node scripts/neon-probe.mjs write "$env:TEMP\neon-probe-write.json"
    "exit=$LASTEXITCODE"

Limpeza do ambiente local, sempre ao final (e depois redefina a senha de `neondb_owner` no console):

    Remove-Item Env:NEON_PROBE_URL, Env:NEON_PROBE_CONFIRM_ENDPOINT, Env:NEON_PROBE_ALLOW_WRITE, Env:NEON_PROBE_ALLOW_GRANT -ErrorAction SilentlyContinue
    Remove-Variable sec

Códigos de saída: `0` tudo limpo; `2` abortou antes de qualquer alteração; `3` resíduo, inventário divergente ou limpeza com falha; `4` interrompido com limpeza incompleta; `130` interrompido com limpeza concluída.

## 6. Critérios de interrupção

**Não iniciar** se: pré-voo com `TLS_EXTERNO` ≠ COMPROVADO, `IDENTIDADE` ≠ COMPROVADO, `PROJETO_NEON_ID` ≠ COMPROVADO, qualquer `zz_probe_*` existente, endpoint divergente, ou atividade do console/Prisma em andamento no projeto.
**Interromper (Ctrl+C; a limpeza roda sozinha)** se: aparecer qualquer objeto não `zz_probe_<id>_*` na saída, `LIMPEZA_*` INCOMPATIVEL, `INVENTARIO_DEPOIS_IGUAL_ANTES` INCOMPATIVEL, erro de TLS/credencial, ou execução parada por mais de 3 minutos.
**Após** qualquer saída ≠ 0: não repetir; rodar o modo read e enviar o JSON.

## 7. Evidências necessárias para aprovação (a anexar antes da execução)

1. Este relatório e o resultado de `node --test scripts/neon-probe-checks.test.mjs` (22/22).
2. JSON do pré-voo (read) feito imediatamente antes: `TLS_EXTERNO`, `IDENTIDADE`, `PROJETO_NEON_ID`, `REMANESCENTES_zz_probe` vazio, `INVENTARIO_*` iguais.
3. Decisão explícita do proprietário sobre `NEON_PROBE_ALLOW_GRANT=yes`.
4. Confirmação de que nenhum outro processo usa o projeto (console, CI, Render) durante o ensaio.
5. Compromisso de redefinir a senha de `neondb_owner` ao final.

## 8. Pendências

- Execução do modo write: **PENDENTE DE AUTORIZAÇÃO** (nenhuma operação A–F foi executada; resultados esperados acima são hipóteses, não evidências).
- Decisão sobre o gate `pg_stat_ssl` do RÚSTIKA no Neon (`serverIdentity.ts`): inalterado, continua incompatível com o Neon.
- Teste do comportamento real de `ALTER DATABASE RENAME` com dono ≠ administrador e `CREATE DATABASE OWNER` (só será conhecido pela execução).
- Replay das sete migrations: fora do escopo e não autorizado.
