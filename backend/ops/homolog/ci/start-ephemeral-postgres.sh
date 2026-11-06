#!/usr/bin/env bash
# 3D.5.2-B - PREPARADO, NAO EXECUTADO. Sobe um PostgreSQL 18 TOTALMENTE DESCARTAVEL no runner do GitHub Actions, com TLS (CA sintetica
# temporaria), acessivel por um IP NAO-loopback (os perfis de homologacao proibem loopback). Nada aqui usa secrets do repositorio:
# todas as credenciais e certificados sao gerados na execucao, mascarados nos logs e apagados por teardown.sh.
# Exporta as variaveis RUSTIKA_HOMOLOG_EPHEMERAL_* via $GITHUB_ENV.
set -euo pipefail

: "${PG_CONTAINER:?PG_CONTAINER obrigatorio}"
: "${RUNNER_TEMP:?RUNNER_TEMP obrigatorio}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID obrigatorio}"
: "${GITHUB_ENV:?GITHUB_ENV obrigatorio}"

PG_PORT="${PG_PORT:-55432}"
PG_IMAGE="${PG_IMAGE:-postgres:18}"
ADMIN_USER="rustika_eph_admin"
CLUSTER_NAME="rustika-homolog-ephemeral-${GITHUB_RUN_ID}"
WORK="${RUNNER_TEMP}/homolog-ephemeral"

if docker ps -a --format '{{.Names}}' | grep -qx "${PG_CONTAINER}"; then
  echo "Container ${PG_CONTAINER} ja existe: este job exige um PostgreSQL proprio e novo." >&2
  exit 1
fi

# Primeiro IPv4 de saida do runner; deve ser publico/privado de rede, nunca loopback nem link-local.
HOST_IP="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')"
case "${HOST_IP}" in
  ""|127.*|169.254.*|0.0.0.0) echo "IP do runner invalido para o ensaio: '${HOST_IP}'" >&2; exit 1 ;;
esac

umask 077
rm -rf "${WORK}"
mkdir -p "${WORK}/tls"

# --- CA sintetica, CA "errada" (para o teste negativo) e certificado do servidor com SAN = IP do runner.
openssl req -x509 -newkey rsa:3072 -nodes -days 1 -subj "/CN=rustika-homolog-ephemeral-ca-${GITHUB_RUN_ID}" \
  -keyout "${WORK}/tls/ca.key" -out "${WORK}/tls/ca.crt" 2>/dev/null
openssl req -x509 -newkey rsa:3072 -nodes -days 1 -subj "/CN=rustika-homolog-wrong-ca-${GITHUB_RUN_ID}" \
  -keyout "${WORK}/tls/wrong-ca.key" -out "${WORK}/tls/wrong-ca.crt" 2>/dev/null
openssl req -newkey rsa:3072 -nodes -subj "/CN=${HOST_IP}" -keyout "${WORK}/tls/server.key" -out "${WORK}/tls/server.csr" 2>/dev/null
printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\n' "${HOST_IP}" > "${WORK}/tls/server.ext"
openssl x509 -req -in "${WORK}/tls/server.csr" -CA "${WORK}/tls/ca.crt" -CAkey "${WORK}/tls/ca.key" -CAcreateserial \
  -days 1 -extfile "${WORK}/tls/server.ext" -out "${WORK}/tls/server.crt" 2>/dev/null
rm -f "${WORK}/tls/ca.key" "${WORK}/tls/wrong-ca.key" "${WORK}/tls/server.csr"
# A imagem oficial roda como o usuario postgres (uid 999); a chave precisa pertencer a ele com modo 0600.
sudo chown 999:999 "${WORK}/tls/server.key" "${WORK}/tls/server.crt"
chmod 600 "${WORK}/tls/server.key"
chmod 644 "${WORK}/tls/ca.crt" "${WORK}/tls/wrong-ca.crt"
# O umask 077 deixaria as pastas inacessiveis ao uid 999 do container (bind mount preserva o modo do host). As pastas ficam
# atravessaveis (755); a protecao da chave privada e o modo 0600 do arquivo, que pertence ao usuario postgres.
chmod 755 "${WORK}" "${WORK}/tls"

# --- pg_hba: somente TLS para conexoes TCP; socket local (trust) existe apenas dentro do container, para a prontidao.
cat > "${WORK}/pg_hba.conf" <<'HBA'
local   all   all                 trust
hostssl all   all   0.0.0.0/0     scram-sha-256
hostnossl all all   0.0.0.0/0     reject
HBA
chmod 644 "${WORK}/pg_hba.conf"

ADMIN_PASSWORD="$(openssl rand -hex 24)"
echo "::add-mask::${ADMIN_PASSWORD}"

# Publica SOMENTE no IP do runner (nunca em 0.0.0.0). Volume anonimo: removido com `docker rm -fv`.
docker run -d --name "${PG_CONTAINER}" \
  --publish "${HOST_IP}:${PG_PORT}:5432" \
  -e POSTGRES_USER="${ADMIN_USER}" -e POSTGRES_PASSWORD="${ADMIN_PASSWORD}" -e POSTGRES_DB=postgres \
  -v "${WORK}/tls:/tls:ro" -v "${WORK}/pg_hba.conf:/ci/pg_hba.conf:ro" \
  "${PG_IMAGE}" \
  -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key -c hba_file=/ci/pg_hba.conf \
  -c listen_addresses='*' -c cluster_name="${CLUSTER_NAME}" -c max_connections=60 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${PG_CONTAINER}" pg_isready -U "${ADMIN_USER}" -h /var/run/postgresql >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "${PG_CONTAINER}" pg_isready -U "${ADMIN_USER}" -h /var/run/postgresql >/dev/null

# Verificacao a partir do HOST: TLS com verificacao de CA e de hostname (SAN IP), como o ensaio fara.
if ! command -v psql >/dev/null 2>&1; then sudo apt-get install -y --no-install-recommends postgresql-client >/dev/null; fi
PGPASSWORD="${ADMIN_PASSWORD}" psql "host=${HOST_IP} port=${PG_PORT} user=${ADMIN_USER} dbname=postgres sslmode=verify-full sslrootcert=${WORK}/tls/ca.crt" \
  -tAc "select current_setting('cluster_name'), (select ssl from pg_stat_ssl where pid = pg_backend_pid())" | grep -q "^${CLUSTER_NAME}|t$"

{
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM=RUN_ON_EPHEMERAL_POSTGRES"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_HOST=${HOST_IP}"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_PORT=${PG_PORT}"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_ADMIN_USER=${ADMIN_USER}"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_CA_FILE=${WORK}/tls/ca.crt"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_WRONG_CA_FILE=${WORK}/tls/wrong-ca.crt"
  echo "RUSTIKA_HOMOLOG_EPHEMERAL_CLUSTER_NAME=${CLUSTER_NAME}"
} >> "${GITHUB_ENV}"
echo "PostgreSQL efemero pronto em ${HOST_IP}:${PG_PORT} (cluster_name=${CLUSTER_NAME}, TLS verificado)."
