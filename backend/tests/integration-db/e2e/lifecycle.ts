import type { PrismaClient } from '@prisma/client';
import type { RunIdentity } from '../support/fixtures';
import { createRunIdentity, FixtureRun } from '../support/fixtures';
import type { ProvisionedFixtures } from '../support/fixtures';
import { assertE2eGate, E2eAbort, E2E_TARGET_DATABASE } from './gate';
import {
  ensureStateDir, listManifests, readManifest, removeManifest, replaceManifest, reservedComandaNumbers, writeManifestExclusive,
  MANIFEST_VERSION,
} from './manifest';
import type { RunManifest } from './manifest';

/**
 * Setup / verification / teardown of the browser E2E (3D.3.21-B). Replaces backend/seed_raw.js.
 *
 * Rules enforced here:
 * - the only writer is the dedicated fixtures role through the approved harness (full preflight:
 *   database identity, 6 migrations + checksums, effective ACL, pg_hba probe, advisory lock);
 * - nothing global: no TRUNCATE, no unscoped DELETE, no sequence changes, no pre-existing row is touched;
 * - a manifest is written BEFORE provisioning; any manifest left behind blocks the next run;
 * - teardown deletes only what the run identity + manifest describe, and ABORTS (deleting nothing) when
 *   the database holds something the manifest does not explain.
 */

export const E2E_CUSTOMER_NAME = 'E2E Customer';
export const E2E_QUANTITY = 1;

/** Product shown in the E2E catalog: the "numeric" fixture of FixtureRun, name = `<base> [<marker>]`. */
export const e2eProductName = (identity: RunIdentity): string => `FRIOS FIXTURE [${identity.marker}]`;

export interface RunLike {
  readonly identity: RunIdentity;
  provision(): Promise<ProvisionedFixtures>;
  collectIds(): Promise<{ adminIds: string[]; categoryIds: string[]; productIds: string[]; comandaIds: string[] }>;
  cleanup(): Promise<Record<string, number>>;
  remaining(): Promise<Record<string, number>>;
  ordersFor(number: string): Promise<OrderView[]>;
  invitationsFor(number: string): Promise<InvitationView[]>;
}

export interface OrderView {
  orderNumber: number; status: string; customerName: string | null; totalAmount: { toString(): string };
  idempotencyKey: string; requestDigest: string;
  items: { productPublicKeySnapshot: string | null; quantity: number; unitPriceSnapshot: { toString(): string }; subtotal: { toString(): string } }[];
  statusHistory: { fromStatus: string | null; toStatus: string; changedByAdminId?: string | null }[];
}
export interface InvitationView { consumedAt: Date | null; revokedAt: Date | null; session: { revokedAt: Date | null } | null }

export interface LifecycleDeps {
  env: Record<string, string | undefined>;
  stateDir: string;
  open(allowLeftovers: boolean): Promise<{ fixtures: PrismaClient; close(): Promise<void> }>;
  makeRun?(db: PrismaClient, identity: RunIdentity): RunLike;
  newRunId?(): string;
  now?(): Date;
  log?(message: string): void;
}

const makeRunDefault = (db: PrismaClient, identity: RunIdentity): RunLike => new FixtureRun(db, identity) as unknown as RunLike;

export interface E2eSetupResult { manifest: RunManifest; env: Record<string, string> }

/** Creates the synthetic admin, public category/products and reserved comanda range for ONE run. */
export async function e2eSetup(deps: LifecycleDeps): Promise<E2eSetupResult> {
  assertE2eGate(deps.env);
  const log = deps.log ?? (() => undefined);
  const dir = ensureStateDir(deps.stateDir);
  const stale = listManifests(dir);
  if (stale.length) {
    throw new E2eAbort([`Há manifesto de execução anterior (${stale.length}). Rode o teardown (ou investigue) antes de uma nova execução: nada foi escrito.`]);
  }
  const dbs = await deps.open(false); // full preflight; refuses on any leftover or collision
  try {
    const identity = createRunIdentity(deps.newRunId?.());
    const run = (deps.makeRun ?? makeRunDefault)(dbs.fixtures, identity);
    const base: RunManifest = {
      version: MANIFEST_VERSION, runId: identity.runId, status: 'pending', createdAt: (deps.now?.() ?? new Date()).toISOString(), pid: process.pid,
      target: { database: E2E_TARGET_DATABASE }, roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' },
      ids: { adminIds: [], categoryIds: [], productIds: [] }, comandaNumbers: reservedComandaNumbers(identity.runId),
      journey: { comanda: identity.comandas.open, productName: e2eProductName(identity), productKey: '', priceInCents: 0, orderOps: deps.env.RUSTIKA_E2E_ORDER_OPS === 'enabled' },
    };
    writeManifestExclusive(dir, base); // intent first: a crash during provisioning leaves a trace
    log(`manifesto ${identity.runId} criado (pending)`);
    const provisioned = await run.provision();
    const manifest: RunManifest = {
      ...base, status: 'provisioned',
      ids: {
        adminIds: [provisioned.adminId, provisioned.inactiveAdminId], categoryIds: [provisioned.categoryId],
        productIds: Object.values(provisioned.products).map((p) => p.id),
      },
      journey: { ...base.journey, productKey: provisioned.products.numeric.publicKey ?? '', priceInCents: provisioned.products.numeric.priceInCents },
    };
    replaceManifest(dir, manifest);
    log(`fixtures da execução ${identity.runId} provisionadas`);
    return {
      manifest,
      env: {
        RUSTIKA_E2E_RUN_ID: identity.runId,
        RUSTIKA_E2E_ADMIN_EMAIL: identity.adminEmail,
        RUSTIKA_E2E_ADMIN_PASSWORD: provisioned.adminPassword,
        RUSTIKA_E2E_COMANDA: identity.comandas.open,
        RUSTIKA_E2E_PRODUCT_NAME: manifest.journey.productName,
        RUSTIKA_E2E_PRODUCT_PRICE_CENTS: String(manifest.journey.priceInCents),
        RUSTIKA_E2E_ORDER_OPS: manifest.journey.orderOps ? 'enabled' : 'disabled',
        RUSTIKA_E2E_STATE_DIR: dir,
      },
    };
  } finally {
    await dbs.close();
  }
}

export interface Verification { ok: boolean; problems: string[]; orderNumber: number | null }

/** Read-only check of the order the browser created. Expectations are fixed by the journey. */
export async function verifyJourney(run: Pick<RunLike, 'ordersFor' | 'invitationsFor'>, manifest: RunManifest): Promise<Verification> {
  const problems: string[] = []; const { comanda, productKey, priceInCents } = manifest.journey;
  const orders = await run.ordersFor(comanda);
  if (orders.length !== 1) problems.push(`esperado 1 pedido na comanda ${comanda}, encontrado ${orders.length} (idempotência/duplicidade)`);
  const order = orders[0];
  if (order) {
    const cents = (value: { toString(): string }) => Math.round(Number(value.toString()) * 100);
    const expectedStatus = manifest.journey.orderOps ? 'IN_PREPARATION' : 'RECEIVED';
    if (order.status !== expectedStatus) problems.push(`status ${order.status} (esperado ${expectedStatus})`);
    if (order.customerName !== E2E_CUSTOMER_NAME) problems.push('nome do cliente diverge');
    if (cents(order.totalAmount) !== priceInCents * E2E_QUANTITY) problems.push(`total ${cents(order.totalAmount)} diverge de ${priceInCents * E2E_QUANTITY}`);
    if (order.items.length !== 1) problems.push(`itens: ${order.items.length} (esperado 1)`);
    const item = order.items[0];
    if (item) {
      if (item.productPublicKeySnapshot !== productKey) problems.push('produto do item diverge');
      if (item.quantity !== E2E_QUANTITY) problems.push(`quantidade ${item.quantity}`);
      if (cents(item.unitPriceSnapshot) !== priceInCents || cents(item.subtotal) !== priceInCents * E2E_QUANTITY) problems.push('preço/subtotal do item diverge');
    }
    const history = order.statusHistory;
    if (history[0]?.fromStatus !== null || history[0]?.toStatus !== 'RECEIVED') problems.push('histórico inicial diverge');
    if (manifest.journey.orderOps) {
      // 3D.4.1: exatamente uma transição válida feita pelo administrador da execução; conflito/transição inválida não gravam nada.
      const step = history[1];
      if (history.length !== 2 || step?.fromStatus !== 'RECEIVED' || step?.toStatus !== 'IN_PREPARATION') problems.push('histórico da transição administrativa diverge');
      else if (!manifest.ids.adminIds.includes(step.changedByAdminId ?? '')) problems.push('transição não foi registrada pelo administrador da execução');
    } else if (history.length !== 1) problems.push('histórico inicial diverge');
    if (!/^[0-9a-f]{64}$/.test(order.idempotencyKey) || !/^[0-9a-f]{64}$/.test(order.requestDigest)) problems.push('chave/digest de idempotência fora do formato');
  }
  const invitations = await run.invitationsFor(comanda);
  const consumed = invitations.filter((i) => i.consumedAt !== null && i.session !== null && i.session.revokedAt === null);
  if (consumed.length !== 1) problems.push(`convites consumidos com sessão ativa: ${consumed.length} (esperado 1)`);
  return { ok: problems.length === 0, problems, orderNumber: order?.orderNumber ?? null };
}

const sameSet = (found: string[], allowed: string[]): string[] => found.filter((id) => !allowed.includes(id));

export interface E2eTeardownResult { verification: Verification | null; deleted: Record<string, number>; remaining: Record<string, number>; runId: string }

/**
 * Verifies the persisted order (read-only), then removes ONLY the rows of the run described by the
 * manifest. Any discrepancy aborts before the first DELETE and keeps the manifest.
 */
export async function e2eTeardown(deps: LifecycleDeps): Promise<E2eTeardownResult> {
  assertE2eGate(deps.env);
  const log = deps.log ?? (() => undefined);
  const files = listManifests(deps.stateDir);
  if (files.length === 0) throw new E2eAbort(['Nenhum manifesto: não há o que limpar. Não faço limpeza por varredura; use o utilitário de resíduos com autorização.']);
  if (files.length > 1) throw new E2eAbort([`${files.length} manifestos: estado ambíguo, nada foi apagado.`]);
  const file = files[0]!;
  const manifest = readManifest(file);
  const dbs = await deps.open(true); // identity, migrations and ACL still enforced; leftovers are expected here
  try {
    const run = (deps.makeRun ?? makeRunDefault)(dbs.fixtures, createRunIdentity(manifest.runId));
    const found = await run.collectIds();
    const unexplained = [
      ...sameSet(found.adminIds, manifest.ids.adminIds).map((id) => `admin ${id}`),
      ...sameSet(found.categoryIds, manifest.ids.categoryIds).map((id) => `categoria ${id}`),
      ...sameSet(found.productIds, manifest.ids.productIds).map((id) => `produto ${id}`),
    ];
    if (found.comandaIds.length > manifest.comandaNumbers.length) unexplained.push('mais comandas que a faixa reservada');
    if (unexplained.length) {
      throw new E2eAbort([`o banco contém registros da identidade desta execução que o manifesto não descreve: ${unexplained.join(', ')}. Nada foi apagado.`]);
    }
    const verification = manifest.status === 'provisioned' ? await verifyJourney(run, manifest) : null;
    const deleted = await run.cleanup();
    log(`removido: ${JSON.stringify(deleted)}`);
    const remaining = await run.remaining();
    const left = Object.entries(remaining).filter(([, count]) => count > 0);
    if (left.length) throw new E2eAbort([`resíduos após a limpeza: ${left.map(([table, count]) => `${table}=${count}`).join(', ')}. Manifesto mantido.`]);
    removeManifest(file);
    return { verification, deleted, remaining, runId: manifest.runId };
  } finally {
    await dbs.close();
  }
}
