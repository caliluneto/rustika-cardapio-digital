import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = fs.readFileSync(path.join(process.cwd(), 'docs', 'restore-backup.md'), 'utf8');
const verify = fs.readFileSync(path.join(process.cwd(), 'docs', 'sql', 'verify-restore.sql'), 'utf8');

describe('plano de restauração isolada do backup (estático; nada foi executado)', () => {
  // 3D.3.12: a 3D.3.10 dava o dump como ausente por ter procurado o nome errado. O fato correto
  // (os dois arquivos existem, com seus hashes) é o que o plano deve registrar agora.
  it('registra os dumps reais e não finge que a restauração foi provada', () => {
    expect(doc).toContain('cardapio_digital_test_pre3d38_20261104-012137.dump');
    expect(doc).toContain('1be946052157a2c54b7af979c9c174e0d41d70cfaab9abc9b5de90663f925265');
    expect(doc).toContain('procurou o nome errado');
    expect(doc).toMatch(/nenhuma restauração executada/i);
    expect(doc).toContain('Legíveis não significa restauráveis');
  });

  it('exige destino descartável, nome validado e nunca Dev/Test/Shadow', () => {
    expect(doc).toContain('cardapio_restore_check_<AAAAMMDD>_<HHMMSS>');
    expect(doc).toContain('^cardapio_restore_check_[0-9]{8}_[0-9]{6}$');
    expect(doc).toContain('cardapio_digital_dev');
    expect(doc).toContain('cardapio_digital_test');
    expect(doc).toContain('cardapio_digital_shadow');
  });

  it('proíbe --create e isola owner/ACLs', () => {
    expect(doc).toContain('**Nunca** usar `--create`');
    expect(doc).toContain('--no-owner --no-privileges');
    expect(doc).toContain('--single-transaction --exit-on-error');
    expect(doc).toContain('não use `dropdb` preventivo');
  });

  it('valida schema/migrations e limpa somente o banco descartável', () => {
    expect(doc).toContain('verify-restore.sql');
    expect(doc).toContain('_prisma_migrations');
    expect(doc).toContain('dropdb');
    expect(doc).toContain('pg_terminate_backend');
  });

  it('a verificação é somente leitura e recusa banco fora do padrão descartável', () => {
    const body = verify.replace(/--[^\n]*/g, '');
    expect(body).toContain("current_database() !~ '^cardapio_restore_check_[0-9]{8}_[0-9]{6}$'");
    expect(body).not.toMatch(/(^|;)\s*(GRANT|REVOKE|CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/im);
    expect(body).toContain('_prisma_migrations');
    expect(body).toContain('\\gexec');
  });

  it('3D.3.12: usa o dump mais recente com SHA-256 completo e para se divergir', () => {
    expect(doc).toContain('cardapio_digital_test_pre-migrations-3d311_20261104-102650Z_1a9636.dump');
    expect(doc).toContain("$expected = 'f2304f0ac150218ef6dc36a1cbdc517402180daa8ed73bd949c6d2f05306cadf'");
    expect(doc).toContain('SHA-256 divergente: parar.');
    expect(doc).not.toContain('não está mais no caminho documentado');
  });

  it('3D.3.12: isola o banco descartável de PUBLIC e preserva os bancos existentes', () => {
    expect(doc).toContain('REVOKE ALL ON DATABASE $target FROM PUBLIC');
    for (const name of ['plataforma_sites_ia', 'cardapio_restore_precheck', 'rf004_lab_']) expect(doc).toContain(name);
    expect(doc).toContain('_antes.txt');
    // a proteção contra recriar o Test é não passar --create; nenhum comando usa --create
    const commands = doc.split('\n').filter((line) => /^\s*(&\s*'.*pg_restore|pg_restore)\b/.test(line));
    expect(commands.length).toBeGreaterThan(0);
    for (const line of commands) expect(line).not.toMatch(/--create\b/);
  });

  it('RF006: prepara backup integral verificável do Dev sem executar backup ou restore', () => {
    expect(doc).toContain('cardapio_digital_dev_pre-rf006_');
    expect(doc).toContain('procedimento preparado; nenhum `pg_dump`, restore, migration ou SQL de');
    expect(doc).toContain('--format=custom --compress=9 --serializable-deferrable');
    expect(doc).toContain('Get-FileHash -LiteralPath $dump -Algorithm SHA256');
    expect(doc).toContain('pg_restore --list');
    expect(doc).toContain('migrations.Count -ne 7');
    expect(doc).toContain('scripts/bootstrap/expectedMigrations.ts');
    for (const table of ['admins', 'products', 'orders', 'order_items', '_prisma_migrations']) {
      expect(doc).toContain(`TABLE DATA public ${table}`);
    }
    expect(doc).toContain('cardapio_restore_check_<AAAAMMDD>_<HHMMSS>');
    expect(doc).toContain('Sem essa restauração isolada bem-sucedida');
  });
});
