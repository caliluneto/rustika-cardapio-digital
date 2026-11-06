/**
 * Compara dois snapshots JSON de schema (offline, sem banco): exit 0 = idênticos, 1 = drift (listado), 2 = uso inválido.
 *   tsx scripts/schema-compare.ts a.json b.json
 */
import fs from 'node:fs';
import { diffSnapshots, fingerprint, SECTIONS } from './homolog/schemaSnapshot';
import type { SchemaSnapshot } from './homolog/schemaSnapshot';

function read(file: string): SchemaSnapshot {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SchemaSnapshot>;
  for (const section of SECTIONS) if (!Array.isArray(parsed[section])) throw new Error(`snapshot inválido: seção ${section} ausente`);
  return parsed as SchemaSnapshot;
}

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('Uso: tsx scripts/schema-compare.ts a.json b.json'); process.exit(2); }
try {
  const left = read(a); const right = read(b);
  const differences = diffSnapshots(left, right);
  if (differences.length === 0) { console.log(`[schema-compare] idênticos sha256=${fingerprint(left)}`); process.exit(0); }
  for (const item of differences) {
    console.log(`[schema-compare] DRIFT em ${item.section}`);
    for (const line of item.onlyInA) console.log(`  - somente em A: ${line}`);
    for (const line of item.onlyInB) console.log(`  + somente em B: ${line}`);
  }
  console.log('[schema-compare] Nenhuma correção automática: corrija por uma nova migration revisada.');
  process.exit(1);
} catch (error) {
  console.error(`[schema-compare] ${error instanceof Error ? error.message : 'erro'}`);
  process.exit(2);
}
