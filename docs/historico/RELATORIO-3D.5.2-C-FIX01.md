# RELATÓRIO — 3D.5.2-C FIX01
**Propriedade e permissões da chave TLS no GitHub Actions**

O ensaio de homologação **não** está aprovado: esta correção só remove uma falha de preparação do runner. Nenhuma nova execução foi feita nem disparada.

## 1. Causa raiz
Execução `42250311198` (job `128003340582`, commit `d80d358`): `chmod: changing permissions of .../tls/server.key: Operation not permitted`. O script fazia `sudo chown 999:999 server.key server.crt` e **depois** `chmod 600 server.key`. Após o `chown`, o usuário do runner deixa de ser dono do arquivo e não pode alterar o modo. O cleanup funcionou ("Ambiente efemero descartado").

## 2. Alteração exata (`backend/ops/homolog/ci/start-ephemeral-postgres.sh`)
* `chmod 600` em `server.key` e `server.crt` e `chmod 644` nas CAs passam a ocorrer **antes** do `chown`.
* O UID do usuário `postgres` deixa de ser fixo: `docker run --rm --entrypoint id "$PG_IMAGE" -u postgres`, validado como numérico (aborta se não for).
* `sudo chown "$PG_UID:$PG_UID"` apenas em `server.key` e `server.crt` — única operação privilegiada, delimitada a dois arquivos.
* Nova verificação **antes de subir o container**: `stat -c '%u:%a' server.key` deve ser `<PG_UID>:600` e `server.crt` deve pertencer ao `PG_UID`; senão aborta.
* Revisão dos demais comandos TLS: sem problema equivalente. `ca.crt`, `wrong-ca.crt`, `pg_hba.conf` e as pastas continuam do runner (modos aplicados por ele); `chmod 755` das pastas segue sendo necessário para o bind mount; as chaves da CA são apagadas antes do `chown`; o `rm -rf` do teardown remove arquivos de outro dono porque o diretório pertence ao runner.

## 3. Arquivos modificados
`backend/ops/homolog/ci/start-ephemeral-postgres.sh`, `backend/tests/scripts/homolog-provisioning.test.ts`, este relatório. Migrations, gates de TLS/host não-loopback, workflow e suíte efêmera: inalterados.

## 4. Permissões TLS finais
`server.key`: dono UID do `postgres` da imagem, modo **0600**; `server.crt`: dono idem, modo 0600; `ca.crt` e `wrong-ca.crt`: runner, 0644 (públicos); pastas `$WORK` e `$WORK/tls`: 0755 (sem isso o container não atravessa o bind mount; a proteção da chave é o modo/dono do arquivo); nada de 777/666; chaves privadas das CAs removidas.

## 5. Testes de regressão
`homolog-provisioning.test.ts`: falha se qualquer `chmod` de `server.key`/`server.crt` aparecer **depois** do `sudo chown`; exige o `chown` por `PG_UID`, o `chmod 600` da chave, a verificação `stat -c '%u:%a'` e proíbe 777/666/755/644 na chave. (A sequência antiga do commit `d80d358` reprovaria no primeiro critério.)

## 6. Testes locais
`bash -n` do script OK; testes de CI/provisionamento afetados: 25 aprovados; ver suíte completa e snapshot abaixo; revisão do diff (3 arquivos); varredura de segredos sem ocorrências novas. Sem PostgreSQL, sem migrations, sem Playwright, sem workflow.

## 7. Commit publicado / 8. Remoto
Registrados na mensagem final da entrega (o hash não pode constar no próprio commit).

## 9. Próxima execução recomendada
Actions → `homolog-ephemeral` → *Run workflow* → `main` → `run_homolog_ephemeral = true`. Se falhar adiante, usar o diagnóstico mascarado do job; novos defeitos serão tratados em FIX separados. Aprovação do ensaio só após job verde com cleanup confirmado.
