#!/usr/bin/env bash
# 3D.5.2-B - PREPARADO, NAO EXECUTADO. Descarte TOTAL do ambiente efemero (sempre executado, mesmo em falha): container, volume anonimo,
# certificados, chaves e senhas temporarias. Falha o job se algo sobrar.
set -uo pipefail
: "${PG_CONTAINER:?PG_CONTAINER obrigatorio}"
: "${RUNNER_TEMP:?RUNNER_TEMP obrigatorio}"
status=0
docker rm -fv "${PG_CONTAINER}" >/dev/null 2>&1 || true
rm -rf "${RUNNER_TEMP}/homolog-ephemeral" "${RUNNER_TEMP}"/rustika-secrets-* "${RUNNER_TEMP}"/rustika-m8-* 2>/dev/null || true
if docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then echo "Sobrou o container ${PG_CONTAINER}." >&2; status=1; fi
if [ -e "${RUNNER_TEMP}/homolog-ephemeral" ]; then echo "Sobraram certificados ou chaves temporarios." >&2; status=1; fi
if [ "${status}" -eq 0 ]; then echo "Ambiente efemero descartado (container, volume, certificados e senhas)."; fi
exit "${status}"
