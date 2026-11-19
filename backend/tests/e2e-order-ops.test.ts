import { describe, expect, it } from 'vitest';
import { verifyJourney } from './integration-db/e2e/lifecycle';
import { reservedComandaNumbers, validateManifest } from './integration-db/e2e/manifest';
import type { RunManifest } from './integration-db/e2e/manifest';
import { createRunIdentity } from './integration-db/support/fixtures';

/** 3D.4.1: verificação (somente leitura) do estado final da jornada E2E com operação administrativa de pedidos. */
const RUN_ID = '0a1b2c3d';
const ADMIN = '00000000-0000-4000-8000-000000000900';
const OTHER_ADMIN = '00000000-0000-4000-8000-000000000901';

const manifest = (orderOps?: boolean) => ({
  ids: { adminIds: [ADMIN] },
  journey: { comanda: '900001', productKey: 'rustika-1', priceInCents: 5999, ...(orderOps === undefined ? {} : { orderOps }) },
}) as unknown as RunManifest;

type Step = { fromStatus: string | null; toStatus: string; changedByAdminId?: string | null };
const order = (status: string, history: Step[]) => ({
  orderNumber: 1, status, customerName: 'E2E Customer', totalAmount: { toString: () => '59.99' },
  idempotencyKey: 'a'.repeat(64), requestDigest: 'b'.repeat(64),
  items: [{ productPublicKeySnapshot: 'rustika-1', quantity: 1, unitPriceSnapshot: { toString: () => '59.99' }, subtotal: { toString: () => '59.99' } }],
  statusHistory: history,
});
const invitations = async () => [{ consumedAt: new Date(), revokedAt: null, session: { revokedAt: null } }];
const check = (m: RunManifest, row: ReturnType<typeof order>) =>
  verifyJourney({ ordersFor: async () => [row] as never, invitationsFor: invitations as never }, m);

const initial: Step = { fromStatus: null, toStatus: 'RECEIVED' };
const step: Step = { fromStatus: 'RECEIVED', toStatus: 'IN_PREPARATION', changedByAdminId: ADMIN };

describe('verifyJourney: jornada original preservada', () => {
  it('sem orderOps (ausente ou false) exige RECEIVED e um único histórico', async () => {
    expect((await check(manifest(), order('RECEIVED', [initial]))).problems).toEqual([]);
    expect((await check(manifest(false), order('RECEIVED', [initial]))).ok).toBe(true);
  });
  it('sem orderOps, qualquer transição administrativa é divergência', async () => {
    const result = await check(manifest(), order('IN_PREPARATION', [initial, step]));
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/esperado RECEIVED/);
  });
});

describe('verifyJourney: com operação administrativa (orderOps)', () => {
  it('aceita exatamente IN_PREPARATION, dois históricos e o administrador da execução', async () => {
    expect((await check(manifest(true), order('IN_PREPARATION', [initial, step]))).problems).toEqual([]);
  });

  it.each([
    ['transição não aconteceu', order('RECEIVED', [initial]), /esperado IN_PREPARATION/],
    ['histórico duplicado', order('IN_PREPARATION', [initial, step, step]), /histórico da transição administrativa diverge/],
    ['transição inesperada', order('IN_PREPARATION', [initial, { ...step, toStatus: 'READY' }]), /histórico da transição administrativa diverge/],
    ['sem administrador', order('IN_PREPARATION', [initial, { ...step, changedByAdminId: null }]), /não foi registrada pelo administrador/],
    ['administrador de outra execução', order('IN_PREPARATION', [initial, { ...step, changedByAdminId: OTHER_ADMIN }]), /não foi registrada pelo administrador/],
    ['histórico inicial ausente', order('IN_PREPARATION', [step]), /histórico inicial diverge/],
  ])('rejeita: %s', async (_name, row, pattern) => {
    const result = await check(manifest(true), row);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(pattern);
  });
});

describe('manifesto: campo opcional orderOps', () => {
  const good = () => ({
    version: 1, runId: RUN_ID, status: 'provisioned', createdAt: new Date().toISOString(), pid: 1, target: { database: 'cardapio_digital_test' },
    roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' }, ids: { adminIds: [], categoryIds: [], productIds: [] },
    comandaNumbers: reservedComandaNumbers(RUN_ID),
    journey: { comanda: createRunIdentity(RUN_ID).comandas.open, productName: 'x', productKey: 'k', priceInCents: 1 } as Record<string, unknown>,
  });
  it('aceita ausente e booleano; recusa qualquer outro tipo', () => {
    expect(validateManifest(good(), RUN_ID).journey.orderOps).toBeUndefined();
    expect(validateManifest({ ...good(), journey: { ...good().journey, orderOps: true } }, RUN_ID).journey.orderOps).toBe(true);
    for (const bad of ['yes', 1, null, {}]) {
      expect(() => validateManifest({ ...good(), journey: { ...good().journey, orderOps: bad } }, RUN_ID)).toThrow(/orderOps/);
    }
  });
});
