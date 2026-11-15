import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { verifyAppliedMigrations, verifyMigrationDirectory } from '../../scripts/bootstrap/migrationIntegrity';
import { EXPECTED_MIGRATIONS as INTEGRATION_EXPECTED } from '../integration-db/support/preflight';

const real = path.join(process.cwd(), 'prisma', 'migrations');
const temps: string[] = [];
afterEach(() => { while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true }); });
function copyMigrations(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-mig-'));
  temps.push(dir);
  for (const { name } of EXPECTED_MIGRATIONS) {
    fs.mkdirSync(path.join(dir, name));
    fs.copyFileSync(path.join(real, name, 'migration.sql'), path.join(dir, name, 'migration.sql'));
  }
  return dir;
}
const applied = () => EXPECTED_MIGRATIONS.map(({ name, checksum }) => ({ name, checksum, finished: true, rolledBack: false }));

describe('integridade das oito migrations', () => {
  it('a lista esperada tem oito entradas, é idêntica à da suíte de integração e coincide com o disco real', () => {
    expect(EXPECTED_MIGRATIONS).toHaveLength(8);
    expect(EXPECTED_MIGRATIONS).toEqual([...INTEGRATION_EXPECTED]);
    expect(PENDING_MIGRATIONS).toHaveLength(1);
    expect(verifyMigrationDirectory(real, PENDING_MIGRATIONS)).toEqual([]);
    for (const { name, checksum } of EXPECTED_MIGRATIONS) {
      expect(createHash('sha256').update(fs.readFileSync(path.join(real, name, 'migration.sql'))).digest('hex')).toBe(checksum);
    }
    for (const { name, checksum } of PENDING_MIGRATIONS) {
      expect(createHash('sha256').update(fs.readFileSync(path.join(real, name, 'migration.sql'))).digest('hex')).toBe(checksum);
    }
  });

  it('detecta checksum divergente, migration ausente e migration desconhecida (falha fechada)', () => {
    const tampered = copyMigrations();
    fs.appendFileSync(path.join(tampered, EXPECTED_MIGRATIONS[3]!.name, 'migration.sql'), '\n-- alterado');
    expect(verifyMigrationDirectory(tampered)).toEqual([`checksum divergente no disco: ${EXPECTED_MIGRATIONS[3]!.name}.`]);

    const missing = copyMigrations();
    fs.rmSync(path.join(missing, EXPECTED_MIGRATIONS[6]!.name), { recursive: true });
    expect(verifyMigrationDirectory(missing)).toEqual([`migration ausente: ${EXPECTED_MIGRATIONS[6]!.name}.`]);

    const unknown = copyMigrations();
    fs.mkdirSync(path.join(unknown, '20270101000000_nova'));
    expect(verifyMigrationDirectory(unknown)).toEqual(['migration desconhecida no disco: 20270101000000_nova.']);

    expect(verifyMigrationDirectory(path.join(os.tmpdir(), 'nao-existe-rustika'))).toEqual(['pasta de migrations ilegível.']);
  });

  it('valida o estado aplicado: conjunto exato, concluídas, sem reversão e com o checksum esperado', () => {
    expect(verifyAppliedMigrations(applied())).toEqual([]);
    expect(verifyAppliedMigrations(applied().slice(0, 7)).join(' ')).toMatch(/7 linhas.*não aplicada/);
    expect(verifyAppliedMigrations([...applied(), { name: 'x_desconhecida', checksum: 'a', finished: true, rolledBack: false }]).join(' ')).toMatch(/desconhecida aplicada/);
    const bad = applied(); bad[2] = { ...bad[2]!, checksum: 'f'.repeat(64) };
    expect(verifyAppliedMigrations(bad)).toEqual([`checksum gravado diverge: ${EXPECTED_MIGRATIONS[2]!.name}.`]);
    const failed = applied(); failed[0] = { ...failed[0]!, finished: false };
    expect(verifyAppliedMigrations(failed)[0]).toMatch(/falha ou revertida/);
    const rolled = applied(); rolled[1] = { ...rolled[1]!, rolledBack: true };
    expect(verifyAppliedMigrations(rolled)[0]).toMatch(/falha ou revertida/);
  });

  it('as guardas das migrations 3 a 8 continuam exigindo os nomes que fixam a identidade de homologação', () => {
    for (const { name } of EXPECTED_MIGRATIONS.filter((_, index) => [2, 4, 5, 6].includes(index))) {
      const sql = fs.readFileSync(path.join(real, name, 'migration.sql'), 'utf8');
      expect(sql, name).toMatch(/cardapio_digital_test/);
      expect(sql, name).toMatch(/cardapio_test_app/);
    }
    for (const { name } of EXPECTED_MIGRATIONS.slice(4)) {
      const sql = fs.readFileSync(path.join(real, name, 'migration.sql'), 'utf8');
      expect(sql, name).toMatch(/current_user <> 'cardapio_migrator'/);
    }
  });
});
