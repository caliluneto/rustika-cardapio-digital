import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_MIGRATIONS } from './expectedMigrations';

/**
 * Integridade das migrations (separada da política de autorização do ambiente). Só leitura; nunca altera arquivos.
 * Devolve a lista de problemas (vazia = íntegro). Falha fechada: migration desconhecida também é problema.
 * `pending` cobre migrations conhecidas e ainda não aplicadas (a identidade de INSERT em products): o diretório e o
 * checksum são verificados, mas elas não entram no baseline aplicado de oito migrations.
 */
export function verifyMigrationDirectory(
  directory: string,
  pending: ReadonlyArray<{ name: string; checksum: string }> = [],
): string[] {
  const problems: string[] = [];
  const expected = [...EXPECTED_MIGRATIONS, ...pending];
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch {
    return ['pasta de migrations ilegível.'];
  }
  const expectedNames = new Set(expected.map((migration) => migration.name));
  for (const entry of entries.sort()) {
    if (fs.statSync(path.join(directory, entry)).isDirectory() && !expectedNames.has(entry)) {
      problems.push(`migration desconhecida no disco: ${entry}.`);
    }
  }
  for (const migration of expected) {
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

/**
 * Estado de um banco que pode estar em qualquer ponto de uma sequência conhecida (Dev antes do deploy).
 * As linhas aplicadas precisam ser um PREFIXO EXATO da lista esperada, na ordem: sem lacuna, sem migration
 * desconhecida, sem falha/reversão e com o checksum gravado igual ao do disco. `optionalTrailing` aceita a
 * migration pendente já aplicada como última linha (ex.: identidade de INSERT em products), sem transformá-la em baseline histórica.
 */
export function verifyAppliedMigrationPrefix(
  rows: readonly AppliedMigration[],
  expected: ReadonlyArray<{ name: string; checksum: string }> = EXPECTED_MIGRATIONS,
  optionalTrailing?: { name: string; checksum: string },
): string[] {
  const problems: string[] = [];
  const allowedNames = new Set(expected.map((migration) => migration.name));
  if (optionalTrailing) allowedNames.add(optionalTrailing.name);
  for (const row of rows) {
    if (!allowedNames.has(row.name)) problems.push(`migration desconhecida aplicada: ${row.name}.`);
  }
  for (const [index, row] of rows.entries()) {
    const expectedAt = index < expected.length ? expected[index] : optionalTrailing;
    if (!expectedAt) {
      problems.push(`migration aplicada fora da sequência esperada: ${row.name}.`);
      continue;
    }
    if (row.name !== expectedAt.name) {
      problems.push(`ordem de migrations divergente na posição ${index + 1}: ${row.name}, esperada ${expectedAt.name}.`);
    }
    if (!row.finished || row.rolledBack) problems.push(`migration com falha ou revertida: ${row.name}.`);
    if (row.checksum !== expectedAt.checksum) problems.push(`checksum gravado diverge: ${row.name}.`);
  }
  return problems;
}
