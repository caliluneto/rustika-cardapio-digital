import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DATA_TABLES, E2eStateError, analyzeResidue, describeFailure, parseE2eState, verifyZeroResidue,
} from '../scripts/e2e-state-contract';
import { collectState, emitState, parseOutPath, type InspectClient } from '../scripts/inspect-e2e-state';

/**
 * 3D.3.29-FIX02: contrato do estado do E2E. Sem banco, sem rede: funções puras + processos que só leem/gravam
 * arquivos temporários (o "erro de conexão" aponta para uma porta fechada de loopback).
 */
const goodState = () => ({
  identity: [{ database: 'cardapio_digital_test', user: 'cardapio_migrator', version: '180000', read_only: 'on' }],
  migrations: [{ name: '20260101000000_init', finished: true, rolled_back: false }],
  rows: [...DATA_TABLES, '_prisma_migrations'].map((tabela) => ({ tabela, linhas: tabela === '_prisma_migrations' ? 3 : 0 })),
  legacy_e2e_residue: [{ admin: 0, categoria: 0, produto: 0, comanda_999999: 0 }],
  fixture_residue: [{ admins: 0, categorias: 0, comandas_faixa_9: 0 }],
  other_sessions: [],
  locks: [{ advisory_locks: 0, prepared: 0 }],
});
const text = (mutate?: (s: ReturnType<typeof goodState>) => void) => {
  const s = goodState();
  mutate?.(s);
  return JSON.stringify(s, null, 2);
};

describe('contrato do estado do E2E (puro)', () => {
  it('JSON válido e vazio de resíduo: ok', () => {
    const report = verifyZeroResidue(text());
    expect(report).toMatchObject({ ok: true, missingTables: [], residualTables: [], residualMarkers: [], pendingTransactions: 0 });
  });

  it('logs informativos misturados ao JSON (banner do npm) são rejeitados, não "limpos"', () => {
    const banner = '\n> cardapio-digital-backend@0.1.0 e2e:inspect\n> tsx scripts/inspect-e2e-state.ts\n\n';
    expect(() => parseE2eState(banner + text())).toThrow(E2eStateError);
    expect(() => parseE2eState(banner + text())).toThrow(/não é JSON válido/);
    expect(() => parseE2eState(`${text()}\nfim`)).toThrow(E2eStateError);
  });

  it('JSON inválido, arquivo vazio e raiz que não é objeto', () => {
    expect(() => parseE2eState('{"identity": [')).toThrow(/não é JSON válido/);
    expect(() => parseE2eState('')).toThrow(/vazio/);
    expect(() => parseE2eState('  \n ')).toThrow(/vazio/);
    expect(() => parseE2eState('[]')).toThrow(/raiz/);
    expect(() => parseE2eState('null')).toThrow(/raiz/);
  });

  it('campos obrigatórios ausentes ou de tipo errado', () => {
    for (const section of ['identity', 'migrations', 'rows', 'legacy_e2e_residue', 'fixture_residue', 'other_sessions', 'locks'] as const) {
      const raw = JSON.parse(text());
      delete raw[section];
      expect(() => parseE2eState(JSON.stringify(raw)), section).toThrow(new RegExp(`ausente \\(${section}\\)`));
    }
    const raw = JSON.parse(text());
    raw.rows = {};
    expect(() => parseE2eState(JSON.stringify(raw))).toThrow(/deve ser uma lista/);
  });

  it('identidade: precisa ser o banco Test, em transação somente leitura', () => {
    expect(() => parseE2eState(text((s) => { s.identity[0]!.database = 'cardapio_digital_dev'; }))).toThrow(/não é cardapio_digital_test/);
    expect(() => parseE2eState(text((s) => { s.identity[0]!.read_only = 'off'; }))).toThrow(/somente leitura/);
    expect(() => parseE2eState(text((s) => { s.identity.push({ ...s.identity[0]! }); }))).toThrow(/exatamente uma linha/);
  });

  it('migrations: ausentes, não finalizadas ou revertidas', () => {
    expect(() => parseE2eState(text((s) => { s.migrations = []; }))).toThrow(/nenhuma migration/);
    expect(() => parseE2eState(text((s) => { s.migrations[0]!.finished = false; }))).toThrow(/não finalizada/);
    expect(() => parseE2eState(text((s) => { s.migrations[0]!.rolled_back = true; }))).toThrow(/revertida/);
  });

  it('contagens inválidas: negativa, fracionária, texto, nula e tabela duplicada', () => {
    for (const bad of [-1, 1.5, '0', null, Number.NaN]) {
      expect(() => parseE2eState(text((s) => { (s.rows[0] as { linhas: unknown }).linhas = bad; })), String(bad)).toThrow(/contagem inválida/);
    }
    expect(() => parseE2eState(text((s) => { s.rows.push({ ...s.rows[0]! }); }))).toThrow(/duplicada/);
    expect(() => parseE2eState(text((s) => { (s.fixture_residue[0] as Record<string, unknown>).admins = 'x'; }))).toThrow(/fixture_residue\.admins/);
    expect(() => parseE2eState(text((s) => { (s as { locks: unknown[] }).locks[0] = {}; }))).toThrow(/sem campos/);
  });

  it('tabela AUSENTE é diferente de tabela VAZIA', () => {
    const missing = verifyZeroResidue(text((s) => { s.rows = s.rows.filter((r) => r.tabela !== 'orders'); }));
    expect(missing.ok).toBe(false);
    expect(missing.missingTables).toEqual(['orders']);
    expect(missing.residualTables).toEqual([]);
    const empty = verifyZeroResidue(text());
    expect(empty.missingTables).toEqual([]);
    expect(empty.ok).toBe(true);
    // lista vazia de tabelas: todas ausentes, nunca "resíduo zero"
    const none = verifyZeroResidue(text((s) => { s.rows = []; }));
    expect(none.ok).toBe(false);
    expect(none.missingTables).toEqual([...DATA_TABLES]);
  });

  it('registros residuais reais são detectados (tabelas, chaves de fixture e transações preparadas)', () => {
    const tables = verifyZeroResidue(text((s) => { s.rows.find((r) => r.tabela === 'orders')!.linhas = 2; s.rows.find((r) => r.tabela === 'products')!.linhas = 1; }));
    expect(tables.ok).toBe(false);
    expect(tables.residualTables).toEqual([{ table: 'orders', rows: 2 }, { table: 'products', rows: 1 }]);
    const markers = verifyZeroResidue(text((s) => { s.legacy_e2e_residue[0]!.admin = 1; s.fixture_residue[0]!.comandas_faixa_9 = 4; }));
    expect(markers.residualMarkers).toEqual([
      { section: 'legacy_e2e_residue', field: 'admin', count: 1 }, { section: 'fixture_residue', field: 'comandas_faixa_9', count: 4 },
    ]);
    const prepared = verifyZeroResidue(text((s) => { s.locks[0]!.prepared = 1; }));
    expect(prepared.pendingTransactions).toBe(1);
    expect(prepared.ok).toBe(false);
    expect(describeFailure(analyzeResidue(parseE2eState(text((s) => { s.rows.find((r) => r.tabela === 'orders')!.linhas = 2; })))))
      .toBe('resíduo em tabelas: orders=2');
  });

  it('tabelas fora da lista de dados (ex.: _prisma_migrations) não contam como resíduo', () => {
    expect(verifyZeroResidue(text()).residualTables).toEqual([]);
  });
});

describe('inspetor em processo, com cliente falso (sem PostgreSQL)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-e2e-fake-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fakeClient = (outcome: 'ok' | 'connection-error'): InspectClient => ({
    async $transaction(fn) {
      if (outcome === 'connection-error') throw new Error("Can't reach database server at 127.0.0.1:5432 (ECONNREFUSED)");
      const queries: string[] = [];
      const state = goodState() as Record<string, unknown>;
      const names = Object.keys(state);
      let call = 0;
      return fn({
        async $executeRawUnsafe(sql: string) { queries.push(sql); return 0; },
        async $queryRawUnsafe(sql: string) { queries.push(sql); return (state[names[call++]!] as unknown[]); },
      }).then((value) => { expect(queries[0]).toBe('SET TRANSACTION READ ONLY'); return value; });
    },
  });

  it('sucesso: coleta em transação somente leitura e o arquivo gravado passa no contrato', async () => {
    const out = path.join(dir, 'estado.json');
    emitState(await collectState(fakeClient('ok')), out);
    expect(verifyZeroResidue(fs.readFileSync(out, 'utf8')).ok).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(out).mode & 0o777).toBe(0o600);
  });

  it('erro de conexão: a coleta rejeita, nenhum arquivo é criado e o validador falha (nunca "resíduo zero")', async () => {
    const out = path.join(dir, 'sem-conexao.json');
    await expect(collectState(fakeClient('connection-error'))).rejects.toThrow(/Can't reach database server/);
    expect(fs.existsSync(out)).toBe(false);
    expect(() => verifyZeroResidue(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '')).toThrow(E2eStateError);
  });

  it('emitState não sobrescreve arquivo existente e parseOutPath exige caminho absoluto', () => {
    const existing = path.join(dir, 'existente.json');
    fs.writeFileSync(existing, 'original');
    expect(() => emitState({ a: 1 }, existing)).toThrow(/EEXIST/);
    expect(fs.readFileSync(existing, 'utf8')).toBe('original');
    expect(parseOutPath([])).toBeUndefined();
    expect(parseOutPath(['--out', existing])).toBe(existing);
    expect(() => parseOutPath(['--out', 'relativo.json'])).toThrow(/absoluto/);
    expect(() => parseOutPath(['--out'])).toThrow(/Uso/);
  });
});

describe('processos: validador e inspetor (somente arquivos temporários)', () => {
  const backend = path.resolve(__dirname, '..');
  const tsx = path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-e2e-state-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (script: string, args: string[], env: Record<string, string | undefined> = {}) =>
    spawnSync(process.execPath, [tsx, path.join(backend, 'scripts', script), ...args], {
      cwd: backend, encoding: 'utf8', timeout: 90_000, env: { ...process.env, ...env } as NodeJS.ProcessEnv,
    });
  const write = (name: string, content: string) => { const file = path.join(dir, name); fs.writeFileSync(file, content); return file; };

  it('validador: 0 para estado limpo; 1 para resíduo; 2 para contrato violado', () => {
    expect(run('validate-e2e-state.ts', [write('ok.json', text())]).status).toBe(0);
    const residue = run('validate-e2e-state.ts', [write('residuo.json', text((s) => { s.rows.find((r) => r.tabela === 'comandas')!.linhas = 3; }))]);
    expect(residue.status).toBe(1);
    expect(residue.stderr).toContain('comandas=3');
    for (const [name, content] of [['vazio.json', ''], ['invalido.json', '> banner\n{}'], ['semsecao.json', '{}']] as const) {
      const out = run('validate-e2e-state.ts', [write(name, content)]);
      expect(out.status, name).toBe(2);
    }
    const missingFile = run('validate-e2e-state.ts', [path.join(dir, 'nao-existe.json')]);
    expect(missingFile.status).toBe(2);
    expect(missingFile.stdout).not.toContain('Resíduo zero');
    expect(run('validate-e2e-state.ts', []).status).toBe(2);
  }, 120_000);

  it('inspetor: falha do processo (perfil ausente) devolve erro explícito e NÃO cria o arquivo de estado', () => {
    const emptySecrets = fs.mkdtempSync(path.join(dir, 'secrets-vazio-'));
    const out = path.join(dir, 'estado-perfil-ausente.json');
    const result = run('inspect-e2e-state.ts', ['--out', out], { CARDAPIO_SECRETS_DIR: emptySecrets });
    expect(result.status).toBe(2);
    expect(fs.existsSync(out)).toBe(false);
    expect(result.stderr).toMatch(/ausente/);
    // e o validador, sem arquivo, também falha (não transforma ausência em resíduo zero)
    expect(run('validate-e2e-state.ts', [out]).status).toBe(2);
  }, 120_000);

  it('inspetor: perfil recusado pela política (porta fora do padrão) falha com código 2, sem arquivo e sem vazar a senha', () => {
    // A política exige 127.0.0.1:5432; o teste NUNCA chega a abrir conexão (não toca no PostgreSQL local).
    const secrets = fs.mkdtempSync(path.join(dir, 'secrets-politica-'));
    const password = 'sintetica-' + 'x'.repeat(20);
    fs.writeFileSync(path.join(secrets, 'migrate-test.env'), [
      `DATABASE_URL="postgresql://cardapio_migrator:${password}@127.0.0.1:1/cardapio_digital_test?schema=public"`,
      `SHADOW_DATABASE_URL="postgresql://cardapio_migrator:${password}@127.0.0.1:1/cardapio_digital_shadow?schema=public"`,
    ].join('\n'));
    const out = path.join(dir, 'estado-politica.json');
    const result = run('inspect-e2e-state.ts', ['--out', out], { CARDAPIO_SECRETS_DIR: secrets });
    expect(result.status).toBe(2);
    expect(fs.existsSync(out)).toBe(false);
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(run('validate-e2e-state.ts', [out]).status).toBe(2);
  }, 120_000);

  it('inspetor: --out inválido (relativo, ausente) e arquivo já existente nunca é sobrescrito', () => {
    const existing = write('existente.json', 'conteudo-original');
    const secrets = fs.mkdtempSync(path.join(dir, 'secrets-out-'));
    const env = { CARDAPIO_SECRETS_DIR: secrets };
    expect(run('inspect-e2e-state.ts', ['--out', 'relativo.json'], env).status).toBe(2);
    expect(run('inspect-e2e-state.ts', ['--out'], env).status).toBe(2);
    expect(run('inspect-e2e-state.ts', ['--out', existing, 'extra'], env).status).toBe(2);
    expect(fs.readFileSync(existing, 'utf8')).toBe('conteudo-original');
  }, 120_000);
});
