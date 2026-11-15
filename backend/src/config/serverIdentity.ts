import type { PrismaClient } from '@prisma/client';

/**
 * Identidade do SERVIDOR. Verificar só o hostname não prova isolamento: DNS, túnel ou cópia de URL podem apontar
 * para outro cluster. Antes de qualquer escrita da homologação, o próprio servidor precisa provar, por leitura de catálogo, que:
 *  - a conexão usa TLS de fato (pg_stat_ssl), e o PostgreSQL é ≥ 17;
 *  - o cluster carrega a marca criada pelo script 01 (role NOLOGIN `rustika_homolog_marker` com comentário contendo o UUID
 *    que consta no arquivo de segredo local — `EXPECTED_CLUSTER_ID`);
 *  - não é um cluster de desenvolvimento (nenhum banco `cardapio_digital_dev`/`cardapio_digital_shadow`);
 *  - a fase é coerente: replay (banco transitório `cardapio_digital_test`, sem o banco definitivo) ou final (banco
 *    `cardapio_digital_homolog`, sem o banco transitório e sem roles legadas).
 */
export const MARKER_ROLE = 'rustika_homolog_marker';
export const MARKER_PREFIX = 'rustika-homolog-cluster:';
export const REPLAY_DATABASE = 'cardapio_digital_test';
export const FINAL_DATABASE = 'cardapio_digital_homolog';
const DEV_DATABASES = ['cardapio_digital_dev', 'cardapio_digital_shadow'];
const LEGACY_ROLES = ['cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app'];

export interface ServerFacts {
  database: string;
  currentUser: string;
  sslActive: boolean;
  serverVersionNum: number;
  databases: string[];
  roles: string[];
  markerComment: string | null;
}

export interface IdentityExpectation { phase: 'replay' | 'final'; expectedClusterId: string; expectedUser: string }

export function evaluateServerIdentity(facts: ServerFacts, expected: IdentityExpectation): string[] {
  const problems: string[] = [];
  if (!facts.sslActive) problems.push('a conexão não usa TLS.');
  if (facts.serverVersionNum < 170000) problems.push('PostgreSQL anterior ao 17.');
  const clusterId = expected.expectedClusterId.trim().toLowerCase();
  if (clusterId === '' || facts.markerComment === null || facts.markerComment.trim().toLowerCase() !== `${MARKER_PREFIX}${clusterId}`) {
    problems.push('a marca do cluster de homologação ausente ou diferente de EXPECTED_CLUSTER_ID.');
  }
  for (const dev of DEV_DATABASES) {
    if (facts.databases.includes(dev)) problems.push(`o servidor contém o banco ${dev}: parece um cluster de desenvolvimento.`);
  }
  if (facts.currentUser !== expected.expectedUser) problems.push('a role conectada difere da esperada.');
  if (expected.phase === 'replay') {
    if (facts.database !== REPLAY_DATABASE) problems.push(`banco conectado diferente de ${REPLAY_DATABASE} (replay).`);
    if (facts.databases.includes(FINAL_DATABASE)) problems.push(`o banco definitivo ${FINAL_DATABASE} já existe: o replay não se aplica.`);
  } else {
    if (facts.database !== FINAL_DATABASE) problems.push(`banco conectado diferente de ${FINAL_DATABASE}.`);
    if (facts.databases.includes(REPLAY_DATABASE)) problems.push(`o banco transitório ${REPLAY_DATABASE} ainda existe: finalize a renomeação.`);
    for (const legacy of LEGACY_ROLES) {
      if (facts.roles.includes(legacy)) problems.push(`a role legada ${legacy} ainda existe: finalize a renomeação.`);
    }
  }
  return problems;
}

interface HeadRow { db: string; usr: string; ssl: boolean; ver: number; marker: string | null }

export async function readServerFacts(prisma: PrismaClient): Promise<ServerFacts> {
  const head = await prisma.$queryRaw<HeadRow[]>`
    SELECT current_database() AS db, current_user::text AS usr,
           COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS ssl,
           current_setting('server_version_num')::int AS ver,
           (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS marker`;
  const row = head[0];
  if (!row) throw new Error('Fatos do servidor indisponíveis.');
  const databases = await prisma.$queryRaw<Array<{ datname: string }>>`SELECT datname::text AS datname FROM pg_database WHERE NOT datistemplate`;
  const roles = await prisma.$queryRaw<Array<{ rolname: string }>>`SELECT rolname::text AS rolname FROM pg_roles`;
  return {
    database: row.db, currentUser: row.usr, sslActive: row.ssl === true, serverVersionNum: Number(row.ver),
    databases: databases.map((item) => item.datname), roles: roles.map((item) => item.rolname), markerComment: row.marker,
  };
}
