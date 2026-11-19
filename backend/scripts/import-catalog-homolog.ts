/**
 * Importador supervisionado do catálogo real RÚSTIKA para o ambiente de homologação (Neon).
 *
 * Modos:
 *   Dry-run (SERIALIZABLE READ ONLY):
 *     tsx scripts/import-catalog-homolog.ts --profile migrate-homolog --authorize-read-only
 *
 *   Importação atômica e idempotente (exige confirmação explícita):
 *     CARDAPIO_HOMOLOG_CATALOG_CONFIRMATION=... tsx scripts/import-catalog-homolog.ts --profile migrate-homolog --execute
 *
 * Não é chamado no start da API, em migrations nem em CI. Usa exclusivamente a planilha privada padrão.
 */
import { PrismaClient } from '@prisma/client';
import { readNeonServerFacts } from '../src/config/neonServerIdentity';
import { loadDatabaseProfile } from '../src/config/secrets';
import { createPrismaHomologCatalogDb, runHomologCatalogCli } from './homolog/catalogHomologImporter';

runHomologCatalogCli(
  {
    loadProfile: (profile) => loadDatabaseProfile(profile, { purpose: 'migration' }),
    connect: async (database) => {
      if (!database.host) throw new Error('Host de homologação ausente.');
      const neon = await readNeonServerFacts(database.databaseUrl, database.host);
      const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
      return {
        db: createPrismaHomologCatalogDb(prisma, { proven: neon.external.proven, reasons: neon.external.reasons }),
        close: () => prisma.$disconnect(),
      };
    },
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  },
  process.argv.slice(2),
  process.env,
).then((code) => process.exit(code));

