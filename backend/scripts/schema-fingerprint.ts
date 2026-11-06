/**
 * Impressão digital do schema (somente leitura de catálogo), para controle de drift entre ambientes (3D.5.2-A).
 *   tsx scripts/schema-fingerprint.ts <migrate-dev|migrate-test|migrate-homolog> [--out arquivo.json]
 * Nunca altera nada; nunca corrige divergências (isso exige uma nova migration revisada). Não é executado por testes nem pelo CI.
 */
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';
import { fingerprint, readSchemaSnapshot } from './homolog/schemaSnapshot';

const ALLOWED = ['migrate-dev', 'migrate-test', 'migrate-homolog'];

async function main(): Promise<number> {
  const [profile, flag, out] = process.argv.slice(2);
  if (!profile || !ALLOWED.includes(profile) || (flag !== undefined && (flag !== '--out' || !out))) {
    console.error(`Uso: tsx scripts/schema-fingerprint.ts <${ALLOWED.join('|')}> [--out arquivo.json]`);
    return 1;
  }
  const prisma = (() => {
    const database = loadDatabaseProfile(profile, { purpose: 'migration' });
    return new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  })();
  try {
    const snapshot = await readSchemaSnapshot(prisma);
    console.log(`[schema-fingerprint] perfil=${profile} sha256=${fingerprint(snapshot)}`);
    if (out) fs.writeFileSync(out, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', flag: 'wx' });
    return 0;
  } catch (error) {
    console.error(redactSecrets(`[schema-fingerprint] falha ao ler o schema: ${error instanceof Error ? error.name : 'erro'}`));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
