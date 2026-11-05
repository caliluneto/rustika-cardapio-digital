import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Socket } from 'node:net';
import { readFileSync } from 'node:fs';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { DatabaseSecrets } from '../../src/config/secrets';

const barriers = vi.hoisted(() => ({ client: vi.fn(() => { throw new Error('Cliente real proibido no teste'); }),
  secrets: vi.fn(() => { throw new Error('Segredos reais proibidos no teste'); }) }));
vi.mock('@prisma/client', async importOriginal => ({
  ...await importOriginal<typeof import('@prisma/client')>(), PrismaClient: barriers.client,
}));
vi.mock('../../src/config/secrets', () => ({ loadDatabaseProfile: barriers.secrets }));

import { assertCatalogTotals, assertDevTarget, assertSessionIdentity, catalogFromRows,
  InspectionError, priceInCents, readExcelExpectations, reconcileWithBank, runInspection, safeDiagnostic,
  type Catalog, type ExistingCategory, type ExistingProduct, type InspectionDependencies,
} from '../../scripts/inspect-reconciliation';
import { syntheticCatalogPath } from '../helpers/catalog-sources';
import { SYNTHETIC_EXPECTED } from '../fixtures/catalog/synthetic-catalog';

const originalConnect = Socket.prototype.connect;
let networkAttempts = 0;
beforeAll(() => { Socket.prototype.connect = function (this: Socket, ...args: unknown[]): Socket {
  // Vitest usa pipes locais para IPC; bloqueia TCP, incluindo PostgreSQL.
  const target: unknown = args[0];
  if (typeof target === 'number' || (target !== null && typeof target === 'object' && 'port' in target)) {
    networkAttempts++;
    throw new Error('Rede proibida no teste offline');
  }
  return Reflect.apply(originalConnect, this, args) as Socket;
}; });
afterAll(() => {
  Socket.prototype.connect = originalConnect;
  expect(networkAttempts).toBe(0);
  expect(barriers.client).not.toHaveBeenCalled();
  expect(barriers.secrets).not.toHaveBeenCalled();
});

const fakeDatabase: DatabaseSecrets = {
  profile: 'app-dev', purpose: 'runtime', database: 'cardapio_digital_dev', user: 'cardapio_dev_app',
  databaseUrl: 'postgresql://cardapio_dev_app:senha-ficticia@127.0.0.1:5432/cardapio_digital_dev',
  secretsFilePath: 'nao-lido', describe: () => 'não utilizado',
};
const identity = { db: 'cardapio_digital_dev', usr: 'cardapio_dev_app', session_usr: 'cardapio_dev_app', read_only: 'on' };
const category: ExistingCategory = { id: 'cat-agua', name: 'ÁGUA', publicKey: 'agua', isActive: true };
const internalCategory: ExistingCategory = { id: 'cat-insumo', name: 'INSUMO', publicKey: null, isActive: true };
const row = (codigo = '1', nome = 'ÁGUA', grupo = 'ÁGUA', price: unknown = 7, estado = 'Ativo') =>
  ({ 'Código': codigo, 'Nome curto': nome, Grupo: grupo, 'Preço venda': price, Estado: estado });
const product = (overrides: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 'p-1', sourceCode: '1', sourceName: 'ÁGUA', sourceGroup: 'ÁGUA', publicKey: 'rustika-1',
  name: 'ÁGUA', categoryId: 'cat-agua', price: new Prisma.Decimal(7), isActive: true, descriptionSource: null,
  ...overrides,
});
const internal = (overrides: Partial<ExistingProduct> = {}) => product({
  id: 'p-interno', sourceCode: null, sourceName: null, sourceGroup: null, publicKey: null,
  name: 'FARINHA', categoryId: 'cat-insumo', price: new Prisma.Decimal(3), ...overrides,
});
function internalCatalog(): Catalog {
  const catalog = catalogFromRows([row('PA1', 'FARINHA', 'INSUMO', 3)]);
  catalog.candidatos[0]!.idExistente = 'p-interno'; // vínculo explícito apenas nesta fixture
  return catalog;
}
function doubles(session: unknown = [identity]) {
  const events: string[] = [];
  const query = vi.fn().mockImplementationOnce(async () => { events.push('identidade'); return session; })
    .mockImplementationOnce(async () => { events.push('constraints'); return []; })
    .mockImplementationOnce(async () => { events.push('indices'); return []; });
  const tx = {
    $executeRaw: vi.fn(async (sql: TemplateStringsArray) => { events.push(sql.join('')); return 0; }),
    $queryRaw: query,
    category: { findMany: vi.fn(async () => { events.push('categorias'); return [category]; }) },
    product: { findMany: vi.fn(async () => { events.push('produtos'); return [product()]; }) },
  };
  const client = { $transaction: vi.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
    $disconnect: vi.fn(async () => { events.push('disconnect'); }) };
  const deps: InspectionDependencies = {
    environment: {}, loadProfile: vi.fn(() => fakeDatabase),
    createClient: vi.fn(async () => client as unknown as PrismaClient), readCatalog: vi.fn(() => readExcelExpectations(syntheticCatalogPath)),
  };
  return { deps, tx, client, events };
}

describe('destino, identidade e leitura exclusivamente offline', () => {
  it.each(['cardapio_digital_test', 'cardapio_digital_shadow', 'rf004_lab', 'outro'])('bloqueia URL para %s apesar do perfil Dev', database => {
    expect(() => assertDevTarget({ ...fakeDatabase,
      databaseUrl: fakeDatabase.databaseUrl.replace('/cardapio_digital_dev', `/${database}`),
    })).toThrow(InspectionError);
  });
  it.each([
    { profile: 'app-test' }, { user: 'cardapio_migrator' }, { database: 'outro' },
    { purpose: 'migration' as const }, { shadowDatabaseUrl: 'segredo-ficticio' },
    { databaseUrl: fakeDatabase.databaseUrl.replace('cardapio_dev_app:', 'cardapio_test_app:') },
    { databaseUrl: fakeDatabase.databaseUrl.replace('127.0.0.1', 'rf004.local') },
    { databaseUrl: `${fakeDatabase.databaseUrl}?options=-c%20role=postgres` },
    { databaseUrl: `${fakeDatabase.databaseUrl}?schema=rf004` },
    { databaseUrl: `${fakeDatabase.databaseUrl}?host=rf004.local` },
  ])('bloqueia configuração incompatível %#', changes => {
    expect(() => assertDevTarget({ ...fakeDatabase, ...changes })).toThrow(InspectionError);
  });
  it('aceita somente URL Dev e reconstrói parâmetros fixos', () => {
    const url = new URL(assertDevTarget({ ...fakeDatabase, databaseUrl: `${fakeDatabase.databaseUrl}?schema=public&connection_limit=5` }));
    expect(url.pathname).toBe('/cardapio_digital_dev');
    expect(url.searchParams.get('connection_limit')).toBe('1');
  });
  it.each([undefined, [], [null], [identity, identity], [{ ...identity, db: 'cardapio_digital_test' }],
    [{ ...identity, usr: 'postgres' }], [{ ...identity, session_usr: 'cardapio_migrator' }],
    [{ db: identity.db }]].map(session => ({ session })))('falha se identidade não pode ser confirmada %#', ({ session }) => {
    expect(() => assertSessionIdentity(session)).toThrow(InspectionError);
  });
  it('falha quando read-only não está ativo', () => {
    expect(() => assertSessionIdentity([{ ...identity, read_only: 'off' }])).toThrow(/somente leitura/);
  });
  it('importação não constrói cliente nem lê segredos; CLI exige opção explícita', async () => {
    const { deps } = doubles();
    await expect(runInspection([], deps)).rejects.toThrow(/opção explícita/);
    expect(deps.loadProfile).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(barriers.client).not.toHaveBeenCalled();
  });
  it.each([{ NODE_ENV: 'test' }, { DB_PROFILE: 'app-test' }, { DB_PROFILE: 'migrate-dev' }, { DB_PROFILE: 'rf004' }])('bloqueia ambiente incompatível antes de carregar segredos %#', async environment => {
    const { deps } = doubles(); deps.environment = environment;
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow(InspectionError);
    expect(deps.loadProfile).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });
  it('bloqueia destino inválido antes de criar cliente', async () => {
    const { deps } = doubles();
    deps.loadProfile = vi.fn(() => ({ ...fakeDatabase, database: 'cardapio_digital_shadow' }));
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow(InspectionError);
    expect(deps.createClient).not.toHaveBeenCalled();
  });
  it('simula uma única transação e impõe leitura antes da identidade e do inventário', async () => {
    const { deps, tx, client, events } = doubles();
    const report = await runInspection(['--inspect-dev-read-only'], deps);
    expect(events).toEqual(['SET TRANSACTION READ ONLY', 'identidade', 'constraints', 'indices', 'categorias', 'produtos', 'disconnect']);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 30000 });
    expect(tx.product.findMany).toHaveBeenCalledWith({ select: expect.objectContaining({ sourceCode: true, isActive: true }), orderBy: { id: 'asc' } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    for (const call of tx.$queryRaw.mock.calls) {
      const sql = (call[0] as TemplateStringsArray).join('');
      expect(sql.trim()).toMatch(/^SELECT /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/i);
    }
    expect(report.identidade).toEqual({ banco: identity.db, role: identity.usr, sessionRole: identity.session_usr, somenteLeitura: true });
  });
  it.each([{ session: [] }, { session: [{ ...identity, db: 'rf004_lab' }] },
    { session: [{ ...identity, read_only: 'off' }] }])('não consulta catálogo se identidade/leitura falhar %#', async ({ session }) => {
    const { deps, tx, client } = doubles(session);
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow(InspectionError);
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.category.findMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });
  it('encerra cliente se a consulta de identidade lançar erro', async () => {
    const { deps, tx, client } = doubles(); tx.$queryRaw.mockReset().mockRejectedValue(new Error('externo'));
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow('externo');
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });
  it('não consulta identidade se a proteção read-only falhar', async () => {
    const { deps, tx, client } = doubles(); tx.$executeRaw.mockRejectedValue(new Error('externo'));
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('DESTINO: sslmode explícito e validação restrita offline', () => {
  it('aceita sslmode=disable e entrega o parâmetro ao cliente simulado', async () => {
    const { deps, tx, client } = doubles();
    deps.loadProfile = () => ({ ...fakeDatabase,
      databaseUrl: `${fakeDatabase.databaseUrl}?schema=public&sslmode=disable&connection_limit=5&connect_timeout=5`,
    });
    const report = await runInspection(['--inspect-dev-read-only'], deps);
    expect(deps.createClient).toHaveBeenCalledTimes(1);
    const passedUrl = new URL(vi.mocked(deps.createClient).mock.calls[0]![0]);
    expect(passedUrl.searchParams.get('sslmode')).toBe('disable');
    expect(passedUrl.pathname).toBe('/cardapio_digital_dev');
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.findMany).toHaveBeenCalledTimes(1);
    expect(report.identidade.somenteLeitura).toBe(true);
  });
  it('preserva sslmode, identidade e credenciais sem alterar o objeto de configuração', () => {
    const configured = { ...fakeDatabase,
      databaseUrl: `${fakeDatabase.databaseUrl}?schema=public&sslmode=disable&connection_limit=5&connect_timeout=5`,
    };
    const original = new URL(configured.databaseUrl);
    const before = configured.databaseUrl;
    const approved = new URL(assertDevTarget(configured));
    expect(approved.pathname).toBe('/cardapio_digital_dev');
    expect(approved.username).toBe('cardapio_dev_app');
    expect(approved.password).toBe(original.password);
    expect(approved.hostname).toBe(original.hostname);
    expect(approved.port).toBe(original.port);
    expect(approved.searchParams.get('sslmode')).toBe('disable');
    expect(configured.databaseUrl).toBe(before);
  });
  it('URL sem sslmode continua aceita sem inserir esse parâmetro', () => {
    const approved = new URL(assertDevTarget(fakeDatabase));
    expect(approved.searchParams.has('sslmode')).toBe(false);
  });
  it.each(['require', 'prefer', 'verify-full', 'DISABLE', '', 'valor-ficticio-sensivel'])('bloqueia valor SSL não autorizado %# antes do cliente', async value => {
    const { deps, tx } = doubles();
    deps.loadProfile = () => ({ ...fakeDatabase, databaseUrl: `${fakeDatabase.databaseUrl}?sslmode=${value}` });
    const diagnostic = await runInspection(['--inspect-dev-read-only'], deps).catch(error => safeDiagnostic(error));
    expect(diagnostic).toMatchObject({ codigo: 'DESTINO' });
    expect(JSON.stringify(diagnostic)).not.toContain('valor-ficticio-sensivel');
    expect(JSON.stringify(diagnostic)).not.toContain('senha-ficticia');
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.category.findMany).not.toHaveBeenCalled();
  });
  it.each(['sslmode=disable&sslmode=require', 'sslmode=require&sslmode=disable',
    'sslmode=disable&unknown=valor-ficticio-sensivel', 'sslmode=disable&options=-c%20role=postgres'])('não permite valor conflitante ou parâmetro desconhecido %#', query => {
    expect(() => assertDevTarget({ ...fakeDatabase, databaseUrl: `${fakeDatabase.databaseUrl}?${query}` })).toThrow(InspectionError);
  });
  it.each(['cardapio_digital_dev_rf004', 'cardapio_digital_dev_test', 'cardapio_digital_dev/'])('não aceita nome parcialmente correspondente: %s', async database => {
    const { deps, tx } = doubles();
    deps.loadProfile = () => ({ ...fakeDatabase,
      databaseUrl: fakeDatabase.databaseUrl.replace('/cardapio_digital_dev', `/${database}`),
    });
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toMatchObject({ code: 'DESTINO' });
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(tx.product.findMany).not.toHaveBeenCalled();
  });
  it.each(['', undefined])('URL ausente falha sem conectar %#', async databaseUrl => {
    const { deps, tx } = doubles();
    deps.loadProfile = () => ({ ...fakeDatabase, databaseUrl } as DatabaseSecrets);
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toMatchObject({ code: 'DESTINO' });
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(tx.category.findMany).not.toHaveBeenCalled();
    expect(tx.product.findMany).not.toHaveBeenCalled();
  });
  it.each([
    'postgresql://cardapio_dev_app@127.0.0.1:5432/cardapio_digital_dev',
    'postgresql://:senha-ficticia@127.0.0.1:5432/cardapio_digital_dev',
  ])('credencial ausente é rejeitada com diagnóstico sanitizado %#', async databaseUrl => {
    const { deps, tx } = doubles();
    deps.loadProfile = () => ({ ...fakeDatabase, databaseUrl });
    const diagnostic = await runInspection(['--inspect-dev-read-only'], deps).catch(error => safeDiagnostic(error));
    expect(diagnostic).toMatchObject({ codigo: 'DESTINO' });
    expect(JSON.stringify(diagnostic)).not.toContain('senha-ficticia');
    expect(JSON.stringify(diagnostic)).not.toContain('postgresql://');
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(tx.product.findMany).not.toHaveBeenCalled();
  });
  it('arquivo de configuração ausente interrompe antes do cliente e omite detalhes externos', async () => {
    const { deps, tx, client } = doubles();
    deps.loadProfile = () => { throw new Error('Arquivo de segredo ausente: caminho-ficticio-sensivel'); };
    const diagnostic = await runInspection(['--inspect-dev-read-only'], deps).catch(error => safeDiagnostic(error));
    expect(diagnostic).toMatchObject({ codigo: 'FALHA_EXTERNA' });
    expect(JSON.stringify(diagnostic)).not.toContain('caminho-ficticio-sensivel');
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
    expect(tx.product.findMany).not.toHaveBeenCalled();
    expect(tx.category.findMany).not.toHaveBeenCalled();
  });
});

describe('preços e expectativas offline', () => {
  it.each([[7, 700], [12.5, 1250], ['25,99', 2599], [28.9034, 2890], [33.8123, 3381],
    [16.8107, 1681], [1.005, 100], [0.30000000000000004, 30]])('arredondamento do importador: %s -> %s centavos', (raw, cents) => {
    expect(priceInCents(raw)).toBe(cents);
  });
  it.each([NaN, Infinity, null, '', 'segredo-ficticio', -1, '1.2.3', 100000000])('rejeita preço inválido %#', raw => {
    expect(() => priceInCents(raw)).toThrow(InspectionError);
  });
  it('contabiliza o catálogo SINTÉTICO (mesmos totais da planilha real); nenhum dado PostgreSQL', () => {
    const catalog = readExcelExpectations(syntheticCatalogPath);
    expect(catalog.totais).toEqual({ total: 204, ativos: 174, publicos: 144, internos: 24,
      incertosSuspensos: 6, inativosExcluidos: 30, candidatos: 168 });
    expect(() => assertCatalogTotals(catalog)).not.toThrow();
    expect(catalog.candidatos.every(p => p.ativo && p.classificacao !== 'INCERTO')).toBe(true);
  });
  it('rejeita códigos duplicados e estado desconhecido', () => {
    expect(() => catalogFromRows([row(), row()])).toThrow(InspectionError);
    expect(() => catalogFromRows([row('1', 'ÁGUA', 'ÁGUA', 7, 'Outro')])).toThrow(InspectionError);
  });
  it('arredondamento monetário não altera a classificação do preço original', () => {
    const catalog = catalogFromRows([row('1', 'ÁGUA', 'ÁGUA', 0.014)]);
    expect(catalog.candidatos[0]!.centavos).toBe(1);
    expect(catalog.candidatos[0]!.classificacao).toBe('COMERCIALIZADO');
  });
  it('expõe incompatibilidade do código público alfanumérico sem alterar a identidade', () => {
    const result = reconcileWithBank(readExcelExpectations(syntheticCatalogPath), [], []);
    expect(result.incompatibilidadesCatalogo.map(p => p.codigo)).toEqual([SYNTHETIC_EXPECTED.alphaCode]);
    expect(result.reconciliacao.AUSENTE).toBe(168);
    expect(result.propostasAutomaticas).toBe(false);
  });
  it('mudança de quantitativos interrompe antes de carregar conexão', async () => {
    const { deps } = doubles(); deps.readCatalog = () => catalogFromRows([row()]);
    await expect(runInspection(['--inspect-dev-read-only'], deps)).rejects.toThrow(/Quantitativos/);
    expect(deps.loadProfile).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
  });
});

describe('reconciliação completa com fixtures simuladas', () => {
  it('classifica produto público correto e ausente', () => {
    const result = reconcileWithBank(catalogFromRows([row(), row('2', 'OUTRA')]), [product()], [category]);
    expect(result.reconciliacao.EXISTENTE_CORRETO).toBe(1);
    expect(result.reconciliacao.AUSENTE).toBe(1);
  });
  it('inclui sourceCode null; chave estável permite detectar divergência do código', () => {
    const result = reconcileWithBank(catalogFromRows([row()]), [product({ sourceCode: null })], [category]);
    expect(result.bancoExistente.semSourceCode).toBe(1);
    expect(result.reconciliacao.EXISTENTE_DIVERGENTE).toBe(1);
    expect(result.detalhes[0]!.divergencias.join()).toContain('sourceCode');
  });
  it('UUID explicitamente verificado permite interno correto sem sourceCode', () => {
    const result = reconcileWithBank(internalCatalog(), [internal()], [internalCategory]);
    expect(result.reconciliacao.EXISTENTE_CORRETO).toBe(1);
    expect(result.bancoExistente.internos).toBe(1);
  });
  it('chave pública indevida de interno é divergência', () => {
    const result = reconcileWithBank(internalCatalog(), [internal({ publicKey: 'invalida' })], [internalCategory]);
    expect(result.reconciliacao.EXISTENTE_DIVERGENTE).toBe(1);
    expect(result.detalhes[0]!.divergencias.join()).toContain('publicKey');
  });
  it('nome igual nunca associa interno sem identidade; não conta como ausente seguro', () => {
    const catalog = catalogFromRows([row('PA1', 'FARINHA', 'INSUMO', 3)]);
    const result = reconcileWithBank(catalog, [internal()], [internalCategory]);
    expect(result.reconciliacao).toMatchObject({ EXISTENTE_CORRETO: 0, AUSENTE: 0,
      EXISTENTE_SEM_CORRESPONDENCIA: 1, candidatosPendentesPorAmbiguidade: 1 });
    expect(result.ambiguidades[0]!.ids).toEqual(['p-interno']);
    expect(result.propostasAutomaticas).toBe(false);
  });
  it('duplicatas e identificadores conflitantes são ambíguos, sem dupla contagem', () => {
    const result = reconcileWithBank(catalogFromRows([row(), row('2', 'OUTRA')]),
      [product({ publicKey: 'rustika-2' }), product({ id: 'duplicado' })], [category]);
    expect(result.reconciliacao.candidatosPendentesPorAmbiguidade).toBe(2);
    expect(result.reconciliacao.EXISTENTE_SEM_CORRESPONDENCIA).toBe(2);
    expect(result.reconciliacao.existentesCorrespondentes).toBe(0);
  });
  it.each([
    [{ name: 'ERRADO' }, 'name'], [{ sourceName: 'ERRADO' }, 'sourceName'],
    [{ sourceGroup: 'ERRADO' }, 'sourceGroup'], [{ isActive: false }, 'isActive'],
    [{ publicKey: 'INVALIDA' }, 'publicKey'], [{ categoryId: 'outra' }, 'categoryId'],
  ] as const)('detecta alteração em %s', (changes, field) => {
    const result = reconcileWithBank(catalogFromRows([row()]), [product(changes)], [category]);
    expect(result.reconciliacao.EXISTENTE_DIVERGENTE).toBe(1);
    expect(result.detalhes[0]!.divergencias.join()).toContain(field);
  });
  it('categoria inativa ou sem chave pública é divergente', () => {
    const result = reconcileWithBank(catalogFromRows([row()]), [product()], [{ ...category, publicKey: null, isActive: false }]);
    expect(result.detalhes[0]!.divergencias.join()).toContain('category.isActive');
    expect(result.detalhes[0]!.divergencias.join()).toContain('chave válida');
  });
  it('diferença de um centavo não passa como correta', () => {
    const result = reconcileWithBank(catalogFromRows([row()]), [product({ price: new Prisma.Decimal('7.01') })], [category]);
    expect(result.reconciliacao.EXISTENTE_DIVERGENTE).toBe(1);
    expect(result.detalhes[0]!.divergencias).toContain('priceCentavos: esperado=700, encontrado=701');
  });
  it('dados simulados: quatro estados, totais separados, incertos/inativos não viram ausentes', () => {
    const catalog = catalogFromRows([row(), row('2', 'OUTRA'), row('3', 'AUSENTE'),
      row('45', 'CDB', 'DIVERSOS', 6), row('99', 'INATIVO', 'ÁGUA', 9, 'Inativo')]);
    const products = [product(), product({ id: 'p-2', sourceCode: '2', publicKey: 'rustika-2',
      sourceName: 'OUTRA', name: 'OUTRA', price: new Prisma.Decimal('7.01') }), internal({ name: 'LEGADO' })];
    const result = reconcileWithBank(catalog, products, [category, internalCategory]);
    expect(result.catalogoEsperado).toEqual({ total: 5, ativos: 4, publicos: 3, internos: 0, incertosSuspensos: 1, inativosExcluidos: 1, candidatos: 3 });
    expect(result.bancoExistente).toEqual({ produtos: 3, categorias: 2, publicos: 2, internos: 1, semSourceCode: 1, semCorrespondencia: 1 });
    expect(result.reconciliacao).toEqual({ EXISTENTE_CORRETO: 1, AUSENTE: 1, EXISTENTE_DIVERGENTE: 1,
      EXISTENTE_SEM_CORRESPONDENCIA: 1, candidatosPendentesPorAmbiguidade: 0,
      candidatosEsperados: 3, existentesCorrespondentes: 2, extrasExistentes: 1 });
    expect(result.detalhes).toHaveLength(4); // Não é total de produtos existentes.
    expect(result.ambiguidades[0]!.ids).toEqual(['p-interno']);
    expect(products[2]!.sourceCode).toBeNull(); // Dados preservados.
  });
  it('incerto existente aparece como extra fora dos candidatos', () => {
    const result = reconcileWithBank(catalogFromRows([row('45', 'CDB', 'DIVERSOS', 6)]),
      [product({ sourceCode: '45', publicKey: 'rustika-45' })], [category]);
    expect(result.reconciliacao.AUSENTE).toBe(0);
    expect(result.reconciliacao.EXISTENTE_SEM_CORRESPONDENCIA).toBe(1);
    expect(result.detalhes[0]!.divergencias.join()).toContain('incerto suspenso');
  });
  it('confere a constraint versionada sem executá-la ou modificar schema', () => {
    const migration = readFileSync('prisma/migrations/20261027000000_rf004_comandas_catalogo_pedidos/migration.sql', 'utf8');
    expect(migration).toContain('"public_key" IS NULL AND "source_code" IS NULL AND "source_name" IS NULL AND "source_group" IS NULL');
    expect(migration).toContain("\"public_key\" = 'rustika-' || \"source_code\"");
  });
});

describe('diagnósticos sem credenciais', () => {
  it('omite URL, senha, API key, tokens, ambiente, stack, cause e propriedades adicionais', () => {
    const secret = 'valor-ficticio-nao-expor';
    const error = Object.assign(new Error(`postgresql://u:${secret}@localhost/db?token=${secret} API_KEY=${secret}`),
      { cause: { password: secret }, env: { TOKEN: secret }, stack: secret });
    const result = JSON.stringify(safeDiagnostic(error));
    expect(result).not.toContain(secret);
    expect(result).not.toContain('postgresql');
    expect(result).toContain('FALHA_EXTERNA');
  });
  it('até mensagens de erros próprios são ignoradas em favor da lista fechada', () => {
    const error = new InspectionError('IDENTIDADE'); error.message = 'senha-ficticia';
    expect(safeDiagnostic(error)).toEqual({ etapa: 'inspecao', codigo: 'IDENTIDADE',
      mensagem: 'Identidade da sessão Dev não confirmada. Inspeção interrompida.' });
  });
  it.each(['token-ficticio', { password: 'senha-ficticia' }, null])('erro arbitrário não é serializado %#', error => {
    expect(safeDiagnostic(error).codigo).toBe('FALHA_EXTERNA');
  });
});
