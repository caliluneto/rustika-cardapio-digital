import type { PrismaClient } from '@prisma/client';
import { E2eAbort } from './gate';

/**
 * Surgical removal of the residue left by the OLD E2E setup (backend/seed_raw.js), identified by the
 * fixed ids that script used. Dry-run by default. Nothing is deleted unless EVERY identifying
 * attribute matches and nothing outside the legacy rows references them.
 */
export const LEGACY = {
  adminId: 'ca000000-0000-4000-8000-000000000000', adminEmail: 'e2e@rustika.local',
  categoryId: 'cc000000-0000-4000-8000-000000000000', categoryKey: 'e2e-cat',
  productId: 'cc000000-0000-4000-8000-000000000001', productKey: 'rustika-E2E001',
  comandaId: 'cc000000-0000-4000-8000-000000000999', comandaNumber: '999999',
} as const;

export interface LegacyInspection {
  present: { admin: boolean; category: boolean; product: boolean; comanda: boolean };
  counts: { invitations: number; sessions: number; orders: number; orderItems: number; history: number };
  problems: string[];
}

export async function inspectLegacy(db: PrismaClient): Promise<LegacyInspection> {
  const problems: string[] = [];
  const admin = await db.admin.findUnique({ where: { id: LEGACY.adminId }, select: { email: true } });
  const category = await db.category.findUnique({ where: { id: LEGACY.categoryId }, select: { publicKey: true } });
  const product = await db.product.findUnique({ where: { id: LEGACY.productId }, select: { publicKey: true, categoryId: true } });
  const comanda = await db.comanda.findUnique({ where: { id: LEGACY.comandaId }, select: { number: true } });
  if (admin && admin.email !== LEGACY.adminEmail) problems.push('admin com o id legado tem e-mail diferente');
  if (category && category.publicKey !== LEGACY.categoryKey) problems.push('categoria com o id legado tem chave diferente');
  if (product && (product.publicKey !== LEGACY.productKey || product.categoryId !== LEGACY.categoryId)) problems.push('produto com o id legado não confere');
  if (comanda && comanda.number !== LEGACY.comandaNumber) problems.push('comanda com o id legado tem outro número');
  // Rows by the legacy identities that live under OTHER ids would be somebody else's data.
  const byEmail = await db.admin.count({ where: { email: LEGACY.adminEmail, NOT: { id: LEGACY.adminId } } });
  const byNumber = await db.comanda.count({ where: { number: LEGACY.comandaNumber, NOT: { id: LEGACY.comandaId } } });
  if (byEmail) problems.push('existe outro admin com o e-mail legado (id diferente)');
  if (byNumber) problems.push('existe outra comanda 999999 (id diferente)');

  const invitations = await db.comandaInvitation.count({ where: { comandaId: LEGACY.comandaId } });
  const sessions = await db.comandaSession.count({ where: { comandaId: LEGACY.comandaId } });
  const orders = await db.order.count({ where: { comandaId: LEGACY.comandaId } });
  const orderItems = await db.orderItem.count({ where: { order: { comandaId: LEGACY.comandaId } } });
  const history = await db.orderStatusHistory.count({ where: { order: { comandaId: LEGACY.comandaId } } });
  // Foreign references: anything that would be orphaned or taken from someone else.
  const foreignInvitations = await db.comandaInvitation.count({ where: { OR: [
    { comandaId: LEGACY.comandaId, NOT: { issuedByAdminId: LEGACY.adminId } },
    { issuedByAdminId: LEGACY.adminId, NOT: { comandaId: LEGACY.comandaId } },
  ] } });
  const foreignProducts = await db.product.count({ where: { categoryId: LEGACY.categoryId, NOT: { id: LEGACY.productId } } });
  const productInOtherOrders = await db.orderItem.count({ where: { productId: LEGACY.productId, NOT: { order: { comandaId: LEGACY.comandaId } } } });
  const historyByAdmin = await db.orderStatusHistory.count({ where: { changedByAdminId: LEGACY.adminId } });
  if (foreignInvitations) problems.push(`${foreignInvitations} convite(s) cruzam a fronteira legada (outro emissor ou outra comanda)`);
  if (foreignProducts) problems.push(`${foreignProducts} produto(s) de outro dono na categoria legada`);
  if (productInOtherOrders) problems.push('o produto legado aparece em pedidos de outra comanda');
  if (historyByAdmin) problems.push('o admin legado aparece no histórico de pedidos');
  return {
    present: { admin: Boolean(admin), category: Boolean(category), product: Boolean(product), comanda: Boolean(comanda) },
    counts: { invitations, sessions, orders, orderItems, history }, problems,
  };
}

export interface LegacyResult { inspection: LegacyInspection; executed: boolean; deleted: Record<string, number> }

/**
 * scope 'full'    (padrão): remove as 9 espécies de linha legadas (admin, categoria, produto, comanda e filhos).
 * scope 'blocker' (3D.3.23-A): remove SÓ o que impede o preflight (comanda 999999 e seus convite/sessão);
 *                 admin, categoria e produto legados são preservados. Aborta se houver pedidos na comanda.
 */
export type LegacyScope = 'full' | 'blocker';

/** No escopo 'blocker' o operador informa os ids EXATOS do convite e da sessão; qualquer outro id aborta. */
export interface BlockerExpectation { invitationId: string; sessionId: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function assertBlockerIds(db: Pick<PrismaClient, 'comandaSession' | 'comandaInvitation'>, expect: BlockerExpectation): Promise<void> {
  const sessions = (await db.comandaSession.findMany({ where: { comandaId: LEGACY.comandaId }, select: { id: true } })).map((row) => row.id);
  const invitations = (await db.comandaInvitation.findMany({ where: { comandaId: LEGACY.comandaId }, select: { id: true } })).map((row) => row.id);
  const stray = [...sessions.filter((id) => id !== expect.sessionId), ...invitations.filter((id) => id !== expect.invitationId)];
  if (stray.length) throw new E2eAbort([`a comanda legada tem ${stray.length} convite(s)/sessão(ões) com id diferente do informado; nada apagado.`]);
}

export async function cleanLegacy(db: PrismaClient, options: { execute: boolean; scope?: LegacyScope; expect?: BlockerExpectation }): Promise<LegacyResult> {
  const scope: LegacyScope = options.scope ?? 'full';
  const expect = options.expect;
  if (scope === 'blocker' && (!expect || !UUID.test(expect.invitationId) || !UUID.test(expect.sessionId))) {
    throw new E2eAbort(['o escopo blocker exige os ids exatos do convite e da sessão (UUID).']);
  }
  const inspection = await inspectLegacy(db);
  if (inspection.problems.length) throw new E2eAbort([`resíduo legado não confere; nada apagado: ${inspection.problems.join('; ')}`]);
  if (scope === 'blocker' && (inspection.counts.orders || inspection.counts.orderItems || inspection.counts.history)) {
    throw new E2eAbort(['há pedidos na comanda legada; o escopo mínimo não os remove. Nada apagado.']);
  }
  if (scope === 'blocker') await assertBlockerIds(db, expect!);
  const nothing = scope === 'blocker'
    ? !inspection.present.comanda && inspection.counts.invitations === 0 && inspection.counts.sessions === 0
    : !Object.values(inspection.present).some(Boolean) && Object.values(inspection.counts).every((n) => n === 0);
  if (!options.execute || nothing) return { inspection, executed: false, deleted: {} };
  const deleted: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    const byComanda = { comandaId: LEGACY.comandaId };
    if (scope === 'blocker') await assertBlockerIds(tx, expect!); // reconferido DENTRO da transação
    deleted.order_status_history = (await tx.orderStatusHistory.deleteMany({ where: { order: byComanda } })).count;
    deleted.order_items = (await tx.orderItem.deleteMany({ where: { order: byComanda } })).count;
    deleted.orders = (await tx.order.deleteMany({ where: byComanda })).count;
    deleted.comanda_sessions = (await tx.comandaSession.deleteMany({ where: scope === 'blocker' ? { ...byComanda, id: expect!.sessionId, invitationId: expect!.invitationId } : byComanda })).count;
    deleted.comanda_invitations = (await tx.comandaInvitation.deleteMany({ where: { ...byComanda, issuedByAdminId: LEGACY.adminId, ...(scope === 'blocker' ? { id: expect!.invitationId } : {}) } })).count;
    deleted.comandas = (await tx.comanda.deleteMany({ where: { id: LEGACY.comandaId, number: LEGACY.comandaNumber } })).count;
    if (scope === 'full') {
      deleted.products = (await tx.product.deleteMany({ where: { id: LEGACY.productId, publicKey: LEGACY.productKey } })).count;
      deleted.categories = (await tx.category.deleteMany({ where: { id: LEGACY.categoryId, publicKey: LEGACY.categoryKey } })).count;
      deleted.admins = (await tx.admin.deleteMany({ where: { id: LEGACY.adminId, email: LEGACY.adminEmail } })).count;
    }
    const expected = {
      order_status_history: inspection.counts.history, order_items: inspection.counts.orderItems, orders: inspection.counts.orders,
      comanda_sessions: inspection.counts.sessions, comanda_invitations: inspection.counts.invitations,
      comandas: Number(inspection.present.comanda),
      ...(scope === 'full' ? { products: Number(inspection.present.product), categories: Number(inspection.present.category), admins: Number(inspection.present.admin) } : {}),
    };
    for (const [table, count] of Object.entries(expected)) {
      if (deleted[table] !== count) throw new E2eAbort([`${table}: apagaria ${deleted[table]} linha(s), esperado ${count}. Transação revertida.`]);
    }
  });
  return { inspection, executed: true, deleted };
}
