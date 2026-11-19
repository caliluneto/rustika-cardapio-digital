import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';

const sqlDir = path.join(process.cwd(), 'ops', 'homolog', 'sql');
const contractPath = path.join(sqlDir, 'contracts', 'expected-migrations.sql');
const contractSql = fs.readFileSync(contractPath, 'utf8');
const match = /SET LOCAL rustika\.expected_migrations = '(\[[\s\S]*\])';/.exec(contractSql);
const contract = JSON.parse(match?.[1] ?? '[]') as Array<{
  ord: number; migration_name: string; checksum: string;
}>;

describe('contrato SQL compartilhado do baseline', () => {
  it('é idêntico ao inventário TypeScript e mantém ordem explícita', () => {
    expect(contract.map(({ migration_name: name, checksum }) => ({ name, checksum }))).toEqual(EXPECTED_MIGRATIONS);
    expect(contract.map(({ ord }) => ord)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each(['03-verify-replay.sql', '05-post-migration-grants.sql', '09-verify-acl.sql'])(
    '%s inclui o contrato e recusa ordem, falha, rollback, passos e logs divergentes',
    (file) => {
      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      expect(sql).toContain('\\ir contracts/expected-migrations.sql');
      for (const fragment of [
        "current_setting('rustika.expected_migrations')",
        'row_number() OVER (ORDER BY started_at, migration_name)',
        'm.ord <> e.ord',
        'm.finished_at IS NULL',
        'm.rolled_back_at IS NOT NULL',
        'm.applied_steps_count <> 1',
        'm.logs IS NOT NULL',
      ]) expect(sql, fragment).toContain(fragment);
    },
  );

  it('03 e 09 verificam ownership, ACL por coluna das migrations 8/9 e ausência de GRANT OPTION', () => {
    for (const file of ['03-verify-replay.sql', '09-verify-acl.sql']) {
      const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
      expect(sql).toContain('relowner');
      expect(sql).toContain("'id', 'INSERT'");
      expect(sql).toContain("'updated_at', 'INSERT'");
      expect(sql).toContain('INSERT WITH GRANT OPTION');
      expect(sql).toContain('UPDATE WITH GRANT OPTION');
    }
  });
});
