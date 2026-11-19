import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { e2eBlockedProductName, e2eSetup, e2eUnknownProductName, verifyJourney } from './integration-db/e2e/lifecycle';
import { reservedComandaNumbers, validateManifest } from './integration-db/e2e/manifest';
import type { RunManifest } from './integration-db/e2e/manifest';
import { createRunIdentity } from './integration-db/support/fixtures';

/** 3D.4.2: verificação (somente leitura) do estado final da jornada E2E opt-in de disponibilidade de produtos. */
const RUN_ID = '0a1b2c3d';
const identity = createRunIdentity(RUN_ID);
const ADMIN = '00000000-0000-4000-8000-000000000900';
const UNKNOWN_KEY = `rustika-${identity.codes.unknown}`;
const BLOCKED_KEY = `rustika-${identity.codes.priceChange}`;

const manifest = (productAvailability?: boolean) => ({
  runId: RUN_ID, ids: { adminIds: [ADMIN] },
  journey: { comanda: '900001', productKey: 'rustika-1', priceInCents: 5999, ...(productAvailability === undefined ? {} : { productAvailability }) },
}) as unknown as RunManifest;

const row = (key: string, price: string, orderNumber: number) => ({
  orderNumber, status: 'RECEIVED', customerName: 'E2E Customer', totalAmount: { toString: () => price },
  idempotencyKey: 'a'.repeat(64), requestDigest: 'b'.repeat(64),
  items: [{ productPublicKeySnapshot: key, quantity: 1, unitPriceSnapshot: { toString: () => price }, subtotal: { toString: () => price } }],
  statusHistory: [{ fromStatus: null, toStatus: 'RECEIVED' }],
});
const first = () => row('rustika-1', '59.99', 1);
const second = (key = UNKNOWN_KEY) => row(key, '11.00', 2);
const invitations = async () => [{ consumedAt: new Date(), revokedAt: null, session: { revokedAt: null } }];

const goodStates = () => [
  { publicKey: 'rustika-1', availabilityState: 'AVAILABLE' }, { publicKey: UNKNOWN_KEY, availabilityState: 'AVAILABLE' },
  { publicKey: BLOCKED_KEY, availabilityState: 'UNAVAILABLE' }, { publicKey: `rustika-${identity.codes.alphanumeric}`, availabilityState: 'AVAILABLE' },
  { publicKey: `rustika-${identity.codes.unavailable}`, availabilityState: 'UNAVAILABLE' },
];
const check = (m: RunManifest, orders: unknown[], states: unknown[] | null = goodStates()) =>
  verifyJourney({
    ordersFor: async () => orders as never, invitationsFor: invitations as never,
    ...(states ? { productStatesFor: async () => states as never } : {}),
  }, m);

describe('verifyJourney: jornada original preservada (sem disponibilidade)', () => {
  it('ausente ou false exige exatamente 1 pedido e não consulta estados', async () => {
    expect((await check(manifest(), [first()], null)).problems).toEqual([]);
    expect((await check(manifest(false), [first()], null)).ok).toBe(true);
    const result = await check(manifest(), [first(), second()], null);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/esperado 1 pedido/);
  });
});

describe('verifyJourney: com disponibilidade de produtos', () => {
  it('aceita 2 pedidos, estados finais esperados e nenhum pedido com o produto bloqueado', async () => {
    expect((await check(manifest(true), [first(), second()])).problems).toEqual([]);
    expect((await check(manifest(true), [second(), first()])).problems).toEqual([]); // ordem do banco não importa
  });

  it.each<[string, unknown[], unknown[] | null, RegExp]>([
    ['só 1 pedido', [first()], goodStates(), /esperado 2 pedido/],
    ['pedido extra', [first(), second(), second()], goodStates(), /esperado 2 pedido/],
    ['segundo pedido com outro produto', [first(), second('rustika-OUTRO')], goodStates(), /não contém exatamente o produto tornado disponível/],
    ['pedido com o produto bloqueado', [first(), second(BLOCKED_KEY)], goodStates(), /não contém exatamente|indisponibilizado antes do envio/],
    ['produto unknown não virou disponível', [first(), second()], goodStates().map((s) => (s.publicKey === UNKNOWN_KEY ? { ...s, availabilityState: 'UNKNOWN' } : s)), /disponibilidade de .*: UNKNOWN \(esperado AVAILABLE\)/],
    ['produto bloqueado continua disponível', [first(), second()], goodStates().map((s) => (s.publicKey === BLOCKED_KEY ? { ...s, availabilityState: 'AVAILABLE' } : s)), /\(esperado UNAVAILABLE\)/],
    ['produto não relacionado foi alterado', [first(), second()], goodStates().map((s) => (s.publicKey === `rustika-${identity.codes.alphanumeric}` ? { ...s, availabilityState: 'UNAVAILABLE' } : s)), /\(esperado AVAILABLE\)/],
    ['estados indisponíveis para leitura', [first(), second()], null, /productStatesFor ausente/],
  ])('rejeita: %s', async (_name, orders, states, pattern) => {
    const result = await check(manifest(true), orders, states);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(pattern);
  });

  it('segundo pedido precisa estar RECEIVED com um único histórico', async () => {
    const changed = { ...second(), status: 'IN_PREPARATION' };
    expect((await check(manifest(true), [first(), changed])).problems.join(' ')).toMatch(/segundo pedido: status\/histórico divergem/);
  });
});

describe('manifesto: campo opcional productAvailability', () => {
  const good = () => ({
    version: 1, runId: RUN_ID, status: 'provisioned', createdAt: new Date().toISOString(), pid: 1, target: { database: 'cardapio_digital_test' },
    roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' }, ids: { adminIds: [], categoryIds: [], productIds: [] },
    comandaNumbers: reservedComandaNumbers(RUN_ID),
    journey: { comanda: identity.comandas.open, productName: 'x', productKey: 'k', priceInCents: 1 } as Record<string, unknown>,
  });
  it('aceita ausente e booleano; recusa qualquer outro tipo', () => {
    expect(validateManifest(good(), RUN_ID).journey.productAvailability).toBeUndefined();
    expect(validateManifest({ ...good(), journey: { ...good().journey, productAvailability: true } }, RUN_ID).journey.productAvailability).toBe(true);
    for (const bad of ['yes', 1, null, {}]) {
      expect(() => validateManifest({ ...good(), journey: { ...good().journey, productAvailability: bad } }, RUN_ID)).toThrow(/productAvailability/);
    }
  });
});

describe('nomes sintéticos da jornada', () => {
  it('são os dos fixtures desta execução (com o marcador) e distintos entre si', () => {
    expect(e2eUnknownProductName(identity)).toBe(`SEM CONFIRMACAO FIXTURE [${identity.marker}]`);
    expect(e2eBlockedProductName(identity)).toBe(`PRECO ALTERAVEL FIXTURE [${identity.marker}]`);
    expect(e2eUnknownProductName(identity)).not.toBe(e2eBlockedProductName(identity));
  });
});

describe('e2eSetup: opt-in por variável de ambiente', () => {
  it('sem a variável o manifesto não habilita a jornada; os nomes são sempre emitidos', async () => {
    const src = readFileSync(path.join(process.cwd(), 'tests/integration-db/e2e/lifecycle.ts'), 'utf8');
    expect(src).toContain("productAvailability: deps.env.RUSTIKA_E2E_PRODUCT_AVAILABILITY === 'enabled'");
    expect(src).toContain("RUSTIKA_E2E_PRODUCT_AVAILABILITY: manifest.journey.productAvailability ? 'enabled' : 'disabled'");
    expect(typeof e2eSetup).toBe('function');
  });
});
