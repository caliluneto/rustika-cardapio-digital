import { Client } from 'pg';
import type { TLSSocket } from 'node:tls';
import { inspectExternalTls, type ExternalTlsResult } from './externalTlsCheck';
import { FINAL_DATABASE, MARKER_PREFIX, MARKER_ROLE, REPLAY_DATABASE } from './serverIdentity';

/**
 * 3D.5.3-C.5 — identidade do servidor para o perfil OPT-IN `app-homolog-neon`.
 *
 * Por que isto é um arquivo separado e não uma alteração de `serverIdentity.ts`: a política para o cluster PostgreSQL
 * dedicado (perfil `app-homolog`) continua EXATAMENTE como estava — `evaluateServerIdentity` continua exigindo
 * `pg_stat_ssl.ssl === true`. Essa política não é preservável no Neon (3D.5.3-C.2.2/C.3): o TLS que o cliente comprova
 * termina no proxy do provedor antes do processo PostgreSQL, então `pg_stat_ssl` ali é `false`/`null` mesmo com TLS
 * íntegro. Em vez de afrouxar `evaluateServerIdentity` (o que enfraqueceria silenciosamente o PostgreSQL dedicado),
 * este módulo define uma política DIFERENTE e mais estrita no que ela pode controlar:
 *   1. uma verificação INDEPENDENTE do TLS externo, feita por ESTE processo, numa conexão só para isso — não a conexão
 *      de runtime do Prisma, que não expõe o socket (ver `readNeonServerFacts`);
 *   2. exige que o servidor exponha `neon.project_id` e que ele confira com o projeto esperado (compensa a ausência de
 *      prova do trecho interno: ao menos o endpoint certo, o projeto certo);
 *   3. mantém TODAS as outras exigências de `evaluateServerIdentity` (marca de homologação, banco/role definitivos,
 *      PostgreSQL ≥ 17, ausência de bancos de desenvolvimento) — nada disso é relaxado;
 *   4. `pg_stat_ssl=false` é registrado como DIVERGÊNCIA DOCUMENTADA, nunca tratado como prova nem como falha por si só.
 *
 * LIMITE HONESTO (3D.5.3-C.5.1): a verificação (1) prova o TLS da CONEXÃO INDEPENDENTE, não do socket do Prisma (que
 * não é inspecionável em JS). A URL usada aqui é idêntica à do Prisma, e `secrets.ts` nunca deixa essa URL carregar
 * `sslaccept` fraco; `server.ts` ainda faz o PRÓPRIO cliente Prisma confirmar banco/role antes de aceitar tráfego,
 * como evidência complementar — mas isso prova que o Prisma CONECTA com esses parâmetros, não que o handshake dele é
 * idêntico ao inspecionado aqui. Nunca descreva isto como "TLS comprovado até o processo PostgreSQL".
 *
 * Este perfil exige ADEMAIS um reconhecimento humano explícito (`assertNeonProxyTlsAck`) antes de sequer tentar
 * conectar: ele não liga sozinho por estar configurado. Esse reconhecimento NUNCA substitui nenhuma das verificações
 * acima — ele só aceita o fato documentado de que `pg_stat_ssl` pode ser `false`; falha de TLS, de certificado, de
 * hostname, de projeto, de banco/role ou de versão continuam bloqueando sempre, com ou sem o reconhecimento.
 */

export const NEON_HOMOLOG_PROFILE = 'app-homolog-neon';
/** Valor exato exigido em RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK. Não há combinação de flags que substitua esta decisão humana. */
export const NEON_PROXY_TLS_ACK = 'accept-proxy-terminated-tls-pg-stat-ssl-false';
const DEV_DATABASES = ['cardapio_digital_dev', 'cardapio_digital_shadow', 'cardapio_digital_test'];

export class NeonHomologBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NeonHomologBlockedError';
  }
}

/**
 * Falha fechada e SEM exceção: só o valor exato autoriza o perfil Neon a sequer abrir uma conexão.
 * Ausência, typo ou qualquer outro valor bloqueiam — nunca "assume que sim".
 */
export function assertNeonProxyTlsAck(value: string | undefined): void {
  if (value !== NEON_PROXY_TLS_ACK) {
    throw new NeonHomologBlockedError(
      'RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK ausente ou incorreto: o perfil app-homolog-neon permanece bloqueado. ' +
      'Leia docs/neon-homolog.md (3D.5.3-C.5) antes de definir essa variável — ela reconhece que o TLS termina no ' +
      'proxy do provedor antes do PostgreSQL (pg_stat_ssl=false), uma divergência documentada e não uma falha a contornar.',
    );
  }
}

export interface NeonIdentityExpectation {
  expectedProjectId: string;
  expectedClusterId: string;
  expectedUser: string;
  expectedDatabase?: string;
  phase?: 'replay' | 'final';
}

export interface NeonServerFacts {
  database: string;
  currentUser: string;
  serverVersionNum: number;
  databases: string[];
  roles: string[];
  markerComment: string | null;
  projectId: string | null;
  /** Informacional — ver cabeçalho do arquivo. Nunca usado para aprovar nem reprovar por si só. */
  pgStatSslActive: boolean | null;
  external: ExternalTlsResult;
}

type PgSocketClient = Client & { connection?: { stream?: TLSSocket } };

/**
 * Abre uma conexão SÓ para esta verificação (não a de runtime do Prisma) para poder inspecionar o socket TLS real —
 * o motor do Prisma não expõe isso. `rejectUnauthorized: true` sempre; `servername` fixa o SNI/validação no host exato.
 */
export async function readNeonServerFacts(connectionString: string, host: string): Promise<NeonServerFacts> {
  const client = new Client({
    connectionString, connectionTimeoutMillis: 15_000, statement_timeout: 15_000,
    ssl: { rejectUnauthorized: true, servername: host, minVersion: 'TLSv1.2' },
  }) as PgSocketClient;
  await client.connect();
  try {
    const stream = client.connection?.stream;
    if (!stream) throw new Error('Não foi possível inspecionar o socket TLS da conexão de verificação.');
    const external = inspectExternalTls(stream, host);
    const head = (await client.query<{ db: string; usr: string; ver: string; ssl: boolean | null; pid: string | null; marker: string | null }>(
      `SELECT current_database() AS db, current_user AS usr, current_setting('server_version_num') AS ver,
              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
              current_setting('neon.project_id', true) AS pid,
              (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = $1) AS marker`,
      [MARKER_ROLE],
    )).rows[0];
    if (!head) throw new Error('Fatos do servidor indisponíveis.');
    const databases = (await client.query<{ datname: string }>('SELECT datname FROM pg_database WHERE NOT datistemplate')).rows.map((r) => r.datname);
    const roles = (await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles')).rows.map((r) => r.rolname);
    return {
      database: head.db, currentUser: head.usr, serverVersionNum: Number(head.ver), databases, roles,
      markerComment: head.marker, projectId: head.pid, pgStatSslActive: head.ssl, external,
    };
  } finally {
    await client.end();
  }
}

/** Nunca lança: devolve a lista de problemas (vazia = aprovado), igual ao padrão de `evaluateServerIdentity`. */
export function evaluateNeonServerIdentity(facts: NeonServerFacts, expected: NeonIdentityExpectation): string[] {
  const problems: string[] = [];
  if (!facts.external.proven) problems.push(`TLS externo não comprovado: ${facts.external.reasons.join('; ')}.`);
  if (facts.serverVersionNum < 170000) problems.push('PostgreSQL anterior ao 17.');
  const expectedProjectId = expected.expectedProjectId.trim().toLowerCase();
  if (expectedProjectId === '') problems.push('EXPECTED_PROJECT_ID não configurado.');
  else if (!facts.projectId) problems.push('o servidor não expõe neon.project_id (não é possível confirmar o projeto).');
  else if (facts.projectId.trim().toLowerCase() !== expectedProjectId) problems.push('neon.project_id difere do projeto esperado.');
  const clusterId = expected.expectedClusterId.trim().toLowerCase();
  if (clusterId === '' || facts.markerComment === null || facts.markerComment.trim().toLowerCase() !== `${MARKER_PREFIX}${clusterId}`) {
    problems.push('a marca de homologação está ausente ou diverge de EXPECTED_CLUSTER_ID.');
  }
  if (facts.currentUser !== expected.expectedUser) problems.push('a role conectada difere da esperada.');
  if (expected.phase === 'replay') {
    const replayDatabase = expected.expectedDatabase ?? REPLAY_DATABASE;
    if (facts.database !== replayDatabase) problems.push(`banco conectado diferente de ${replayDatabase} (replay).`);
    if (facts.databases.includes(FINAL_DATABASE)) problems.push(`o banco definitivo ${FINAL_DATABASE} já existe: o replay não se aplica.`);
    for (const dev of ['cardapio_digital_dev', 'cardapio_digital_shadow']) {
      if (facts.databases.includes(dev)) problems.push(`o servidor contém ${dev}: réplica de desenvolvimento ainda presente.`);
    }
  } else {
    const database = expected.expectedDatabase ?? FINAL_DATABASE;
    if (facts.database !== database) problems.push(`banco conectado diferente de ${database}.`);
    for (const dev of DEV_DATABASES) {
      if (facts.databases.includes(dev)) problems.push(`o servidor contém ${dev}: réplica de desenvolvimento/replay ainda presente.`);
    }
  }
  // facts.pgStatSslActive === false|null é a divergência documentada (3D.5.3-C.2.2): NUNCA empurrada para `problems`.
  return problems;
}
