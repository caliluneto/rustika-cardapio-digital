import type { TLSSocket } from 'node:tls';
import fs from 'node:fs';
import { Client } from 'pg';
import { inspectExternalTls } from '../../src/config/externalTlsCheck';
import {
  evaluateNeonServerIdentity,
  type NeonIdentityExpectation,
  type NeonServerFacts,
} from '../../src/config/neonServerIdentity';
import { MARKER_ROLE } from '../../src/config/serverIdentity';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../bootstrap/expectedMigrations';

// Fase A.1: EXPECTED_MIGRATIONS tem 8 (a 9ª vive em PENDING_MIGRATIONS até ser promovida — mesma
// convenção já usada por prisma-run.ts/verifyAppliedMigrationPrefix). Sem isto, o estado 9/9 legítimo
// seria rejeitado aqui (índice 8 cairia fora de EXPECTED_MIGRATIONS e geraria "ordem divergente").
const ALL_KNOWN_MIGRATIONS = [...EXPECTED_MIGRATIONS, ...PENDING_MIGRATIONS];

export interface ReplayMigrationRow {
  name: string;
  checksum: string;
  startedAt: Date;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
  appliedStepsCount: number;
  logs: string | null;
}

export type ReplayPreflightIntent = 'status' | 'deploy';
export type ReplayPreflightAction = 'invoke-prisma' | 'already-complete';

export type ReplayHistoryDecision =
  | { ok: true; action: ReplayPreflightAction; appliedCount: 7 | 9 }
  | { ok: false; problems: string[] };

/**
 * Política fail-closed do replay remoto. Só 7/9 íntegro e 9/9 íntegro são estados
 * operacionais. 8/9 é tratado como incidente, nunca como replay parcialmente bem-sucedido.
 */
export function evaluateNeonReplayHistory(
  rows: readonly ReplayMigrationRow[],
  intent: ReplayPreflightIntent,
): ReplayHistoryDecision {
  const problems: string[] = [];
  const expectedNames = new Set(ALL_KNOWN_MIGRATIONS.map(({ name }) => name));
  const seen = new Set<string>();

  for (const [index, row] of rows.entries()) {
    const expected = ALL_KNOWN_MIGRATIONS[index];
    if (seen.has(row.name)) problems.push(`migration duplicada no histórico: ${row.name}.`);
    seen.add(row.name);
    if (!expectedNames.has(row.name)) problems.push(`migration desconhecida no histórico: ${row.name}.`);
    if (!expected || row.name !== expected.name) {
      problems.push(`ordem divergente na posição ${index + 1}: ${row.name}.`);
    } else if (row.checksum !== expected.checksum) {
      problems.push(`checksum divergente no histórico: ${row.name}.`);
    }
    if (!row.startedAt || row.finishedAt === null || row.rolledBackAt !== null) {
      problems.push(`migration falha, incompleta ou revertida: ${row.name}.`);
    } else if (row.finishedAt.getTime() < row.startedAt.getTime()) {
      problems.push(`datas inconsistentes no histórico: ${row.name}.`);
    }
    if (row.appliedStepsCount !== 1 || row.logs !== null) {
      problems.push(`estado interno inconsistente no histórico: ${row.name}.`);
    }
  }

  if (rows.length === 8) {
    problems.push('estado 8/9 é incidente: classifique e recupere antes de qualquer nova execução.');
  } else if (rows.length < 7) {
    problems.push(`estado ${rows.length}/9 não é autorizado para o replay remoto.`);
  } else if (rows.length > 9) {
    problems.push(`histórico contém ${rows.length} registros; o baseline permite exatamente nove.`);
  } else if (rows.length !== 7 && rows.length !== 9) {
    problems.push(`estado ${rows.length}/9 não é um cenário permitido.`);
  }

  if (problems.length > 0) return { ok: false, problems };
  if (rows.length === 9 && intent === 'deploy') {
    return { ok: true, action: 'already-complete', appliedCount: 9 };
  }
  return {
    ok: true,
    action: 'invoke-prisma',
    appliedCount: rows.length as 7 | 9,
  };
}

type InspectableClient = Client & { connection?: { stream?: TLSSocket } };

export interface NeonReplayPreflightOptions extends NeonIdentityExpectation {
  connectionString: string;
  host: string;
  intent: ReplayPreflightIntent;
}

export function prepareReplayPgConnection(connectionString: string): { connectionString: string; ca?: string } {
  const url = new URL(connectionString);
  const caFile = url.searchParams.get('sslcert');
  const ca = caFile ? fs.readFileSync(caFile, 'utf8') : undefined;
  // `sslcert` é o arquivo de CA no contrato Prisma deste projeto, mas o driver `pg`
  // o interpreta como certificado de cliente. Removemos somente os parâmetros TLS
  // da URL e os reaplicamos abaixo como configuração TLS explícita e estrita.
  for (const key of ['sslmode', 'sslaccept', 'sslcert']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ...(ca ? { ca } : {}) };
}

/** Identidade e histórico são lidos na mesma sessão, dentro de uma transação somente leitura. */
export async function runNeonReplayPreflight(
  options: NeonReplayPreflightOptions,
): Promise<ReplayHistoryDecision> {
  const prepared = prepareReplayPgConnection(options.connectionString);
  const client = new Client({
    connectionString: prepared.connectionString,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
    ssl: { rejectUnauthorized: true, servername: options.host, minVersion: 'TLSv1.2', ...(prepared.ca ? { ca: prepared.ca } : {}) },
  }) as InspectableClient;
  await client.connect();
  try {
    const stream = client.connection?.stream;
    if (!stream) throw new Error('socket TLS do preflight indisponível.');
    await client.query('BEGIN READ ONLY');
    try {
      const head = (await client.query<{
        db: string; usr: string; ver: string; ssl: boolean | null; pid: string | null; marker: string | null;
      }>(
        `SELECT current_database() AS db, current_user AS usr,
                current_setting('server_version_num') AS ver,
                (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
                current_setting('neon.project_id', true) AS pid,
                (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = $1) AS marker`,
        [MARKER_ROLE],
      )).rows[0];
      if (!head) throw new Error('identidade Neon indisponível.');
      const databases = (await client.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE NOT datistemplate',
      )).rows.map(({ datname }) => datname);
      const roles = (await client.query<{ rolname: string }>('SELECT rolname FROM pg_roles')).rows
        .map(({ rolname }) => rolname);
      const facts: NeonServerFacts = {
        database: head.db,
        currentUser: head.usr,
        serverVersionNum: Number(head.ver),
        databases,
        roles,
        markerComment: head.marker,
        projectId: head.pid,
        pgStatSslActive: head.ssl,
        external: inspectExternalTls(stream, options.host),
      };
      const identityProblems = evaluateNeonServerIdentity(facts, {
        expectedProjectId: options.expectedProjectId,
        expectedClusterId: options.expectedClusterId,
        expectedUser: options.expectedUser,
        expectedDatabase: options.expectedDatabase,
        phase: 'replay',
      });
      if (identityProblems.length > 0) return { ok: false, problems: identityProblems };

      const rows = (await client.query<ReplayMigrationRow>(
        `SELECT migration_name AS name, checksum,
                started_at AS "startedAt", finished_at AS "finishedAt",
                rolled_back_at AS "rolledBackAt",
                applied_steps_count AS "appliedStepsCount", logs
           FROM public._prisma_migrations
          ORDER BY started_at, migration_name`,
      )).rows;
      return evaluateNeonReplayHistory(rows, options.intent);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}
