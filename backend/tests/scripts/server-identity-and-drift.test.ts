import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateServerIdentity, MARKER_PREFIX } from '../../src/config/serverIdentity';
import type { ServerFacts } from '../../src/config/serverIdentity';
import { aliasRole, diffSnapshots, fingerprint, SECTIONS } from '../../scripts/homolog/schemaSnapshot';
import type { SchemaSnapshot } from '../../scripts/homolog/schemaSnapshot';
import { lintFutureMigration } from '../../scripts/bootstrap/futureMigrationPolicy';

const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const final = (patch: Partial<ServerFacts> = {}): ServerFacts => ({
  database: 'cardapio_digital_homolog', currentUser: 'cardapio_homolog_migrator', sslActive: true, serverVersionNum: 180000,
  databases: ['postgres', 'cardapio_digital_homolog'], roles: ['postgres', 'cardapio_homolog_migrator', 'cardapio_homolog_app', 'rustika_homolog_marker'],
  markerComment: `${MARKER_PREFIX}${CLUSTER}`, ...patch,
});
const replay = (patch: Partial<ServerFacts> = {}): ServerFacts => ({
  ...final(), database: 'cardapio_digital_test', currentUser: 'cardapio_migrator', databases: ['postgres', 'cardapio_digital_test'],
  roles: ['postgres', 'cardapio_migrator', 'cardapio_test_app', 'cardapio_dev_app', 'rustika_homolog_marker'], ...patch,
});
const FINAL = { phase: 'final' as const, expectedClusterId: CLUSTER, expectedUser: 'cardapio_homolog_migrator' };
const REPLAY = { phase: 'replay' as const, expectedClusterId: CLUSTER, expectedUser: 'cardapio_migrator' };

describe('identidade do SERVIDOR (host errado, cluster errado, TLS)', () => {
  it('aceita o cluster certo nas duas fases', () => {
    expect(evaluateServerIdentity(final(), FINAL)).toEqual([]);
    expect(evaluateServerIdentity(replay(), REPLAY)).toEqual([]);
  });

  it('recusa conexão sem TLS efetivo, PostgreSQL antigo e marca ausente ou de outro cluster', () => {
    expect(evaluateServerIdentity(final({ sslActive: false }), FINAL).join(' ')).toMatch(/TLS/);
    expect(evaluateServerIdentity(final({ serverVersionNum: 160000 }), FINAL).join(' ')).toMatch(/anterior ao 17/);
    expect(evaluateServerIdentity(final({ markerComment: null }), FINAL).join(' ')).toMatch(/marca/);
    expect(evaluateServerIdentity(final({ markerComment: `${MARKER_PREFIX}00000000-0000-4000-8000-000000000000` }), FINAL).join(' ')).toMatch(/marca/);
    expect(evaluateServerIdentity(final(), { ...FINAL, expectedClusterId: '' }).join(' ')).toMatch(/marca/);
  });

  it('um host que resolve para o PostgreSQL de desenvolvimento é recusado mesmo com hostname/credenciais plausíveis', () => {
    const dev = final({ databases: ['postgres', 'cardapio_digital_dev', 'cardapio_digital_shadow', 'cardapio_digital_test', 'cardapio_digital_homolog'] });
    const problems = evaluateServerIdentity(dev, FINAL).join(' ');
    expect(problems).toMatch(/cardapio_digital_dev/);
    expect(problems).toMatch(/cardapio_digital_shadow/);
  });

  it('recusa role e banco incompatíveis com a fase', () => {
    expect(evaluateServerIdentity(final({ currentUser: 'cardapio_homolog_app' }), FINAL).join(' ')).toMatch(/role conectada/);
    expect(evaluateServerIdentity(final({ database: 'cardapio_digital_test' }), FINAL).join(' ')).toMatch(/cardapio_digital_homolog/);
    expect(evaluateServerIdentity(replay({ database: 'cardapio_digital_homolog' }), REPLAY).join(' ')).toMatch(/cardapio_digital_test/);
  });

  it('fase final exige renomeação concluída; replay não se aplica se o banco definitivo já existe', () => {
    expect(evaluateServerIdentity(final({ databases: ['cardapio_digital_homolog', 'cardapio_digital_test'] }), FINAL).join(' ')).toMatch(/transitório/);
    expect(evaluateServerIdentity(final({ roles: ['cardapio_migrator', 'cardapio_homolog_app'] }), FINAL).join(' ')).toMatch(/role legada cardapio_migrator/);
    expect(evaluateServerIdentity(replay({ databases: ['cardapio_digital_test', 'cardapio_digital_homolog'] }), REPLAY).join(' ')).toMatch(/replay não se aplica/);
  });
});

const empty = (): SchemaSnapshot => Object.fromEntries(SECTIONS.map((section) => [section, [] as string[]])) as unknown as SchemaSnapshot;
const base = (): SchemaSnapshot => ({
  ...empty(), tables: ['admins', 'orders'], columns: ['admins.id:uuid:true:'], tableAcls: ['admins:runtime:SELECT:false', 'admins:migrator:INSERT:false'],
  migrations: ['m1:aaa:true:false'],
});

describe('controle de drift (impressão digital de schema)', () => {
  it('é determinística e independente da ordem dos itens', () => {
    const a = base(); const b = { ...base(), tables: ['orders', 'admins'] };
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detecta tabela, coluna, ACL e migration divergentes por seção, sem tentar corrigir', () => {
    const drifted = { ...base(), tables: ['admins'], tableAcls: ['admins:runtime:SELECT:false', 'admins:runtime:UPDATE:false'], migrations: ['m1:bbb:true:false'] };
    expect(fingerprint(drifted)).not.toBe(fingerprint(base()));
    const diff = diffSnapshots(base(), drifted);
    expect(diff.map((d) => d.section).sort()).toEqual(['migrations', 'tableAcls', 'tables']);
    expect(diff.find((d) => d.section === 'tables')).toMatchObject({ onlyInA: ['orders'], onlyInB: [] });
    expect(diffSnapshots(base(), base())).toEqual([]);
  });

  it('roles com nomes físicos diferentes são comparáveis por papel lógico; role desconhecida aparece como drift', () => {
    for (const [physical, logical] of [['cardapio_test_app', 'runtime'], ['cardapio_homolog_app', 'runtime'], ['cardapio_migrator', 'migrator'], ['cardapio_homolog_migrator', 'migrator'], ['cardapio_dev_app', 'placeholder'], ['cardapio_homolog_placeholder', 'placeholder']]) {
      expect(aliasRole(physical!)).toBe(logical);
    }
    expect(aliasRole('PUBLIC')).toBe('PUBLIC');
    expect(aliasRole('intruso')).toBe('?intruso');
  });
});

describe('migrations futuras (oitava em diante)', () => {
  const template = fs.readFileSync(path.join(process.cwd(), 'docs', 'templates', 'future-migration-environment-guard.sql'), 'utf8');

  it('o modelo documentado passa no lint e cobre Dev, Test e Homologação', () => {
    expect(lintFutureMigration(template)).toEqual([]);
    for (const name of ['cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_homolog', 'cardapio_homolog_migrator', 'cardapio_homolog_app']) expect(template).toContain(name);
  });

  it('migration que repete a guarda histórica (só Dev/Test) é reprovada', () => {
    const legacy = `DO $x$ DECLARE r text; BEGIN IF current_database() = 'cardapio_digital_test' THEN r := 'cardapio_test_app'; ELSIF current_database() = 'cardapio_digital_dev' THEN r := 'cardapio_dev_app'; ELSE RAISE EXCEPTION 'x'; END IF; END $x$;`;
    expect(lintFutureMigration(legacy).join(' ')).toMatch(/faltam: cardapio_digital_homolog/);
    expect(lintFutureMigration("IF current_user <> 'cardapio_migrator' THEN RAISE EXCEPTION 'x'; END IF; SELECT current_database() IN ('cardapio_digital_dev','cardapio_digital_test','cardapio_digital_homolog');").join(' ')).toMatch(/cardapio_homolog_migrator/);
  });

  it('reprova privilégio por role literal, GRANT sem guarda, TRUNCATE e DDL de cluster', () => {
    expect(lintFutureMigration('GRANT SELECT ON TABLE public.x TO cardapio_test_app;').length).toBeGreaterThan(0);
    expect(lintFutureMigration('GRANT SELECT ON TABLE public.x TO somebody;').join(' ')).toMatch(/guarda por current_database/);
    expect(lintFutureMigration('TRUNCATE public.x;').join(' ')).toMatch(/TRUNCATE/);
    for (const ddl of ['DROP DATABASE x;', 'CREATE ROLE y;', 'ALTER ROLE z NOLOGIN;', 'ALTER SYSTEM SET x = 1;']) expect(lintFutureMigration(ddl).join(' ')).toMatch(/bancos e roles/);
    expect(lintFutureMigration('ALTER TABLE public.products ADD COLUMN note text;')).toEqual([]); // DDL de schema comum é livre
  });

  it('a migration desconhecida continua sendo recusada pelo wrapper (lista esperada exige atualização consciente)', () => {
    const preflight = fs.readFileSync(path.join(process.cwd(), 'scripts', 'bootstrap', 'migrationIntegrity.ts'), 'utf8');
    expect(preflight).toMatch(/migration desconhecida no disco/);
  });
});
