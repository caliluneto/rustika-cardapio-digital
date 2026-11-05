/**
 * Read-only snapshot of cardapio_digital_test for the E2E (3D.3.21-B). Replaces the loose
 * check_*.js scripts that embedded credentials. Uses the existing `migrate-test` profile from the
 * secrets directory, inside a READ ONLY transaction, and prints no secret.
 *
 *   npm run e2e:inspect                              (JSON em stdout; uso interativo)
 *   npm run --silent e2e:inspect -- --out <abs.json> (JSON gravado direto no arquivo; uso no CI)
 *
 * 3D.3.29-FIX02: com `--out` o JSON nunca passa pelo stdout (que carrega o banner do npm); o contrato do
 * arquivo é validado por `scripts/e2e-state-contract.ts`. Qualquer erro de conexão/consulta termina com código 2
 * e NÃO cria o arquivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';

const QUERIES: Record<string, string> = {
  identity: `SELECT current_database() AS database, current_user AS "user", current_setting('server_version_num') AS version, current_setting('transaction_read_only') AS read_only`,
  migrations: `SELECT migration_name AS name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at`,
  rows: `SELECT table_name AS tabela, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint AS linhas FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
  legacy_e2e_residue: `SELECT (SELECT count(*) FROM admins WHERE email = 'e2e@rustika.local') AS admin, (SELECT count(*) FROM categories WHERE public_key = 'e2e-cat') AS categoria, (SELECT count(*) FROM products WHERE public_key = 'rustika-E2E001') AS produto, (SELECT count(*) FROM comandas WHERE number = '999999') AS comanda_999999`,
  fixture_residue: `SELECT (SELECT count(*) FROM admins WHERE email LIKE 'fixture-3d39-%@rustika.test') AS admins, (SELECT count(*) FROM categories WHERE public_key LIKE 'fixture-3d39-%') AS categorias, (SELECT count(*) FROM comandas WHERE number LIKE '9%') AS comandas_faixa_9`,
  other_sessions: `SELECT usename, application_name, state, count(*)::int AS qtd FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 1, 2, 3 ORDER BY 1`,
  locks: `SELECT (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory')::int AS advisory_locks, (SELECT count(*) FROM pg_prepared_xacts WHERE database = current_database())::int AS prepared`,
};

/** `--out <arquivo>`: grava o JSON diretamente (criação exclusiva, modo 0600); stdout só leva uma linha de status. */
export function parseOutPath(argv: string[]): string | undefined {
  const index = argv.indexOf('--out');
  if (index === -1) return undefined;
  const target = argv[index + 1];
  if (!target || target.startsWith('--') || argv.length !== index + 2) throw new Error('Uso: e2e:inspect [-- --out <arquivo-absoluto>]');
  if (!path.isAbsolute(target)) throw new Error('--out exige caminho absoluto.');
  return target;
}

export interface InspectTx {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe(sql: string): Promise<unknown>;
}
export interface InspectClient {
  $transaction<T>(fn: (tx: InspectTx) => Promise<T>): Promise<T>;
}

/** Consulta o estado em transação somente leitura. Erro de conexão/consulta propaga: nada é fabricado. */
export async function collectState(client: InspectClient): Promise<Record<string, unknown>> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const out: Record<string, unknown> = {};
    for (const [name, sql] of Object.entries(QUERIES)) out[name] = await tx.$queryRawUnsafe(sql);
    return out;
  });
}

/** Grava (com --out) ou imprime o estado. Só é chamado depois de a consulta ter terminado com sucesso. */
export function emitState(result: Record<string, unknown>, outPath?: string): void {
  const json = JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? Number(value) : value), 2);
  if (outPath) {
    fs.writeFileSync(outPath, `${json}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Estado gravado no arquivo informado em --out.');
  } else {
    console.log(json);
  }
}

async function main() {
  const outPath = parseOutPath(process.argv.slice(2));
  const profile = loadDatabaseProfile('migrate-test', { purpose: 'migration' });
  if (profile.database !== 'cardapio_digital_test') throw new Error('Perfil não aponta para cardapio_digital_test. Abortado.');
  const client = new PrismaClient({ datasources: { db: { url: profile.databaseUrl } } });
  try {
    emitState(await collectState(client as unknown as InspectClient), outPath);
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  });
}
