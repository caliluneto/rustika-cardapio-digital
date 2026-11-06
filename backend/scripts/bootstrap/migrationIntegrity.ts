import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_MIGRATIONS } from './expectedMigrations';

/**
 * Integridade das migrations (separada da política de autorização do ambiente). Só leitura; nunca altera arquivos.
 * Devolve a lista de problemas (vazia = íntegro). Falha fechada: migration desconhecida também é problema.
 */
export function verifyMigrationDirectory(directory: string): string[] {
  const problems: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return ['pasta de migrations ilegível.'];
  }
  const expectedNames = new Set(EXPECTED_MIGRATIONS.map((migration) => migration.name));
  for (const entry of entries.sort()) {
    if (fs.statSync(path.join(directory, entry)).isDirectory() && !expectedNames.has(entry)) {
      problems.push(`migration desconhecida no disco: ${entry}.`);
    }
  }
  for (const migration of EXPECTED_MIGRATIONS) {
    const file = path.join(directory, migration.name, 'migration.sql');
    if (!fs.existsSync(file)) {
      problems.push(`migration ausente: ${migration.name}.`);
      continue;
    }
    const checksum = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (checksum !== migration.checksum) problems.push(`checksum divergente no disco: ${migration.name}.`);
  }
  return problems;
}

export interface AppliedMigration { name: string; checksum: string; finished: boolean; rolledBack: boolean }

/** Compara `_prisma_migrations` com a lista esperada: conjunto exato, concluídas, não revertidas, mesmo checksum. */
export function verifyAppliedMigrations(rows: readonly AppliedMigration[]): string[] {
  const problems: string[] = [];
  const byName = new Map(rows.map((row) => [row.name, row]));
  if (rows.length !== EXPECTED_MIGRATIONS.length) {
    problems.push(`_prisma_migrations tem ${rows.length} linhas, esperadas ${EXPECTED_MIGRATIONS.length}.`);
  }
  const expectedNames = new Set(EXPECTED_MIGRATIONS.map((migration) => migration.name));
  for (const row of rows) {
    if (!expectedNames.has(row.name)) problems.push(`migration desconhecida aplicada: ${row.name}.`);
  }
  for (const expected of EXPECTED_MIGRATIONS) {
    const row = byName.get(expected.name);
    if (!row) { problems.push(`migration não aplicada: ${expected.name}.`); continue; }
    if (!row.finished || row.rolledBack) problems.push(`migration com falha ou revertida: ${expected.name}.`);
    if (row.checksum !== expected.checksum) problems.push(`checksum gravado diverge: ${expected.name}.`);
  }
  return problems;
}
