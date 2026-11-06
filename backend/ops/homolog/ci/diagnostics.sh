#!/usr/bin/env bash
# 3D.5.2-B - PREPARADO, NAO EXECUTADO. Diagnostico SEGURO em caso de falha: apenas as ultimas linhas do log do servidor descartavel,
# com URLs de conexao mascaradas. Nao gera dump, nao gera artifact, nao imprime variaveis de ambiente nem credenciais.
set -uo pipefail
: "${PG_CONTAINER:?PG_CONTAINER obrigatorio}"
if docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  echo "--- estado do container"
  docker ps -a --filter "name=^${PG_CONTAINER}$" --format '{{.Names}} {{.Status}}'
  echo "--- ultimas 60 linhas do log do PostgreSQL (mascaradas)"
  docker logs --tail 60 "${PG_CONTAINER}" 2>&1 | sed -E 's#postgres(ql)?://[^[:space:]@]*@#postgresql://***@#g; s#(password|PASSWORD)[=: ]+[^[:space:]]+#\1=***#g'
else
  echo "Container ${PG_CONTAINER} nao existe."
fi
exit 0
