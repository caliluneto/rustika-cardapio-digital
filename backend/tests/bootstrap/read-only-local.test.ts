/**
 * Prova opt-in do READ ONLY no PostgreSQL real, sem qualquer conexão remota.
 *
 * Habilitada apenas quando `E4_ALT_LOCAL_READ_ONLY_URL` aponta para localhost/127.0.0.1/::1.
 * Sem a variável o arquivo é ignorado pela suíte; com ela, usa a MESMA função do dry-run e tenta um
 * INSERT de zero linhas via CTE modificadora. O PostgreSQL deve recusar com SQLSTATE 25006.
 *
 * Execução manual:
 *   E4_ALT_LOCAL_READ_ONLY_URL=postgresql://...@localhost:5432/cardapio_digital_test \
 *     npx vitest run tests/bootstrap/read-only-local.test.ts
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { runSerializableReadOnlyTransaction } from '../../scripts/bootstrap/exceptionalMigratorBootstrap';

const LOCAL_URL = process.env.E4_ALT_LOCAL_READ_ONLY_URL;

function localOnly(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && !host.endsWith('neon.tech');
  } catch {
    return false;
  }
}

const enabled = localOnly(LOCAL_URL);

describe.skipIf(!enabled)('E4-ALT — READ ONLY comprovado em PostgreSQL local', () => {
  it('recusa INSERT com SQLSTATE 25006 e mantém a transação SERIALIZABLE', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: LOCAL_URL } } });
    try {
      const target = (await prisma.$queryRaw<Array<{ schema: string; table: string; column: string }>>`
        SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         ORDER BY c.table_name, c.ordinal_position
         LIMIT 1`)[0];
      expect(target, 'o banco local precisa ter ao menos uma tabela com coluna').toBeDefined();
      const identifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;
      const table = `${identifier(target!.schema)}.${identifier(target!.table)}`;
      const column = identifier(target!.column);

      await expect(runSerializableReadOnlyTransaction(prisma, async (tx) => {
        const mode = (await tx.$queryRaw<Array<{ readOnly: boolean; isolation: string }>>`
          SELECT current_setting('transaction_read_only')::boolean AS "readOnly",
                 current_setting('transaction_isolation')::text AS isolation`)[0];
        expect(mode).toEqual({ readOnly: true, isolation: 'serializable' });
        try {
          await tx.$queryRaw(Prisma.sql`
            WITH attempted AS (
              INSERT INTO ${Prisma.raw(table)} (${Prisma.raw(column)}) SELECT NULL WHERE false RETURNING 1
            ) SELECT count(*)::int AS count FROM attempted`);
        } catch (error) {
          // Prisma embrulha o SQLSTATE em P2010; o código 25006 vem do próprio PostgreSQL.
          const sqlState = (error as { meta?: { code?: unknown } }).meta?.code;
          if (sqlState === '25006') throw Object.assign(new Error('INSERT recusado pelo PostgreSQL'), { sqlState });
          throw error;
        }
        throw new Error('O PostgreSQL aceitou INSERT em transação READ ONLY.');
      })).rejects.toMatchObject({ sqlState: '25006' });
    } finally {
      await prisma.$disconnect();
    }
  });
});
