import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../../src/security/password';

/**
 * Fictitious, run-scoped fixtures for cardapio_digital_test (3D.3.9 naming, revised in 3D.3.10).
 * Never executed in this delivery. Every row is identifiable by the run marker; cleanup deletes only rows reachable from
 * the run identity (never TRUNCATE, never an unscoped DELETE).
 */

export const FIXTURE_EMAIL_DOMAIN = 'rustika.test';
export const FIXTURE_PREFIX = 'fixture-3d39';
export const ALPHANUMERIC_CODE = 'PA062240';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');

export interface RunIdentity {
  runId: string;
  marker: string;
  adminEmail: string;
  inactiveAdminEmail: string;
  categoryKey: string;
  categoryName: string;
  codes: { numeric: string; alphanumeric: string; unavailable: string; unknown: string; priceChange: string };
  /** Comanda numbers reserved for this run (6 digits). */
  comandas: { open: string; other: string; closed: string; spare: string[] };
}

export function createRunIdentity(runId = randomBytes(4).toString('hex')): RunIdentity {
  if (!/^[0-9a-f]{8}$/.test(runId)) throw new Error('runId deve ter 8 hexadecimais.');
  const n = parseInt(runId, 16);
  const seven = String(n % 10_000_000).padStart(7, '0');
  const base = 900_000 + (n % 9_000) * 10; // 900000..989990, 10 numbers per run
  const num = (offset: number) => String(base + offset);
  return {
    runId,
    marker: `${FIXTURE_PREFIX}-${runId}`,
    adminEmail: `${FIXTURE_PREFIX}-${runId}@${FIXTURE_EMAIL_DOMAIN}`,
    inactiveAdminEmail: `${FIXTURE_PREFIX}-${runId}-inativo@${FIXTURE_EMAIL_DOMAIN}`,
    categoryKey: `${FIXTURE_PREFIX}-${runId}`,
    categoryName: `Fixture 3D39 ${runId}`,
    codes: { numeric: `9${seven}`, alphanumeric: ALPHANUMERIC_CODE, unavailable: `8${seven}`, unknown: `7${seven}`, priceChange: `6${seven}` },
    comandas: { open: num(1), other: num(2), closed: num(3), spare: [4, 5, 6, 7, 8, 9].map(num) },
  };
}

export interface ProvisionedFixtures {
  adminPassword: string;
  adminId: string;
  inactiveAdminId: string;
  categoryId: string;
  products: Record<'numeric' | 'alphanumeric' | 'unavailable' | 'unknown' | 'priceChange' | 'internal', { id: string; publicKey: string | null; priceInCents: number }>;
}

/** Ordered, scoped deletions. Pure: unit-tested to prove no step is unscoped. */
export function buildCleanupPlan(ids: { comandaIds: string[]; adminIds: string[]; productIds: string[]; categoryIds: string[] }) {
  const inList = (values: string[]) => ({ in: values });
  return [
    { table: 'order_status_history', where: { order: { comandaId: inList(ids.comandaIds) } } },
    { table: 'order_items', where: { order: { comandaId: inList(ids.comandaIds) } } },
    { table: 'orders', where: { comandaId: inList(ids.comandaIds) } },
    { table: 'comanda_sessions', where: { comandaId: inList(ids.comandaIds) } },
    { table: 'comanda_invitations', where: { comandaId: inList(ids.comandaIds) } },
    { table: 'comandas', where: { id: inList(ids.comandaIds) } },
    { table: 'products', where: { id: inList(ids.productIds) } },
    { table: 'categories', where: { id: inList(ids.categoryIds) } },
    { table: 'admins', where: { id: inList(ids.adminIds) } },
  ] as const;
}

export class FixtureRun {
  provisioned?: ProvisionedFixtures;

  constructor(private readonly db: PrismaClient, readonly identity: RunIdentity) {}

  async provision(): Promise<ProvisionedFixtures> {
    const id = this.identity;
    const adminPassword = `Fx-${token().slice(0, 24)}!`;
    const passwordHash = await hashPassword(adminPassword);
    const result = await this.db.$transaction(async (tx) => {
      const admin = await tx.admin.create({ data: { name: `Admin ${id.marker}`, email: id.adminEmail, passwordHash, isActive: true }, select: { id: true } });
      const inactive = await tx.admin.create({ data: { name: `Admin inativo ${id.marker}`, email: id.inactiveAdminEmail, passwordHash, isActive: false }, select: { id: true } });
      const category = await tx.category.create({ data: { name: id.categoryName, publicKey: id.categoryKey, displayOrder: 9_999, isActive: true }, select: { id: true } });
      const product = async (code: string | null, name: string, price: string, availabilityState: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN') => {
        const row = await tx.product.create({
          data: {
            categoryId: category.id, name: `${name} [${id.marker}]`, price: new Prisma.Decimal(price), availabilityState,
            ...(code === null ? {} : { publicKey: `rustika-${code}`, sourceCode: code, sourceName: name, sourceGroup: 'FIXTURES' }),
          },
          select: { id: true, publicKey: true },
        });
        return { id: row.id, publicKey: row.publicKey, priceInCents: Math.round(Number(price) * 100) };
      };
      const products = {
        numeric: await product(id.codes.numeric, 'FRIOS FIXTURE', '59.99', 'AVAILABLE'),
        alphanumeric: await product(id.codes.alphanumeric, 'PANCETA / TORRESMO DE ROLO', '50.00', 'AVAILABLE'),
        unavailable: await product(id.codes.unavailable, 'INDISPONIVEL FIXTURE', '10.00', 'UNAVAILABLE'),
        unknown: await product(id.codes.unknown, 'SEM CONFIRMACAO FIXTURE', '11.00', 'UNKNOWN'),
        priceChange: await product(id.codes.priceChange, 'PRECO ALTERAVEL FIXTURE', '20.00', 'AVAILABLE'),
        internal: await product(null, 'INTERNO FIXTURE', '15.00', 'AVAILABLE'),
      };
      // Closed comanda, reachable from the run admin through an (expired) invitation for cleanup.
      const openedAt = new Date(Date.now() - 3_600_000);
      const closed = await tx.comanda.create({ data: { number: id.comandas.closed, status: 'CLOSED', openedAt, closedAt: new Date(openedAt.getTime() + 60_000) }, select: { id: true } });
      await tx.comandaInvitation.create({ data: { comandaId: closed.id, issuedByAdminId: admin.id, tokenHash: sha256(token()), createdAt: openedAt, expiresAt: new Date(openedAt.getTime() + 60_000) } });
      return { adminId: admin.id, inactiveAdminId: inactive.id, categoryId: category.id, products };
    });
    this.provisioned = { adminPassword, ...result };
    return this.provisioned;
  }

  private admin() {
    if (!this.provisioned) throw new Error('Fixtures não provisionadas.');
    return this.provisioned.adminId;
  }

  private async ensureComanda(number: string) {
    if (![this.identity.comandas.open, this.identity.comandas.other, ...this.identity.comandas.spare].includes(number)) {
      throw new Error(`Comanda ${number} fora da faixa reservada desta execução.`);
    }
    return this.db.comanda.upsert({ where: { number }, create: { number }, update: {}, select: { id: true } });
  }

  /** Invitation already expired (created 2 h ago, valid for 1 min). Returns the plaintext token. */
  async insertExpiredInvitation(number: string): Promise<string> {
    const comanda = await this.ensureComanda(number); const value = token();
    const createdAt = new Date(Date.now() - 7_200_000);
    await this.db.comandaInvitation.create({ data: { comandaId: comanda.id, issuedByAdminId: this.admin(), tokenHash: sha256(value), createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) } });
    return value;
  }

  /** Valid invitation revoked by an operator. */
  async insertRevokedInvitation(number: string): Promise<string> {
    const comanda = await this.ensureComanda(number); const value = token(); const createdAt = new Date();
    await this.db.comandaInvitation.create({ data: { comandaId: comanda.id, issuedByAdminId: this.admin(), tokenHash: sha256(value), createdAt, expiresAt: new Date(createdAt.getTime() + 600_000), revokedAt: createdAt } });
    return value;
  }

  /** Session (cookie value returned) that is active, or revoked when `revoked` is true. */
  async insertSession(number: string, options: { revoked?: boolean; expired?: boolean } = {}): Promise<string> {
    const comanda = await this.ensureComanda(number); const value = token();
    const createdAt = new Date(Date.now() - (options.expired ? 9 * 3_600_000 : 60_000));
    const invitation = await this.db.comandaInvitation.create({ data: { comandaId: comanda.id, issuedByAdminId: this.admin(), tokenHash: sha256(token()), createdAt, expiresAt: new Date(createdAt.getTime() + 60_000), consumedAt: createdAt }, select: { id: true } });
    await this.db.comandaSession.create({ data: { comandaId: comanda.id, invitationId: invitation.id, credentialHash: sha256(value), createdAt, expiresAt: new Date(createdAt.getTime() + 8 * 3_600_000), revokedAt: options.revoked ? new Date() : null } });
    return value;
  }

  async closeComanda(number: string): Promise<void> {
    await this.db.comanda.update({ where: { number }, data: { status: 'CLOSED', closedAt: new Date() } });
  }

  async setPrice(key: keyof ProvisionedFixtures['products'], price: string): Promise<void> {
    if (!this.provisioned) throw new Error('Fixtures não provisionadas.');
    await this.db.product.update({ where: { id: this.provisioned.products[key].id }, data: { price: new Prisma.Decimal(price) } });
  }

  async ordersFor(number: string) {
    return this.db.order.findMany({
      where: { comanda: { number } }, orderBy: { orderNumber: 'asc' },
      include: { items: true, statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
  }

  async invitationsFor(number: string) {
    return this.db.comandaInvitation.findMany({ where: { comanda: { number } }, include: { session: true } });
  }

  /** Every id that belongs to this run. Comandas come from the reserved numbers only. */
  async collectIds() {
    const id = this.identity;
    const admins = await this.db.admin.findMany({ where: { email: { in: [id.adminEmail, id.inactiveAdminEmail] } }, select: { id: true } });
    const categories = await this.db.category.findMany({ where: { publicKey: id.categoryKey }, select: { id: true } });
    const products = await this.db.product.findMany({ where: { categoryId: { in: categories.map((c) => c.id) } }, select: { id: true } });
    const numbers = [id.comandas.open, id.comandas.other, id.comandas.closed, ...id.comandas.spare];
    const comandas = await this.db.comanda.findMany({ where: {
      number: { in: numbers },
      invitations: { some: { issuedByAdminId: { in: admins.map((a) => a.id) } }, every: { issuedByAdminId: { in: admins.map((a) => a.id) } } },
    }, select: { id: true } });
    return { adminIds: admins.map((a) => a.id), categoryIds: categories.map((c) => c.id), productIds: products.map((p) => p.id), comandaIds: comandas.map((c) => c.id) };
  }

  /** Deletes only this run's rows, children first, in one transaction. Returns deleted counts. */
  async cleanup(): Promise<Record<string, number>> {
    const ids = await this.collectIds();
    const plan = buildCleanupPlan(ids);
    const deleted: Record<string, number> = {};
    await this.db.$transaction(async (tx) => {
      const run = async (table: string, where: unknown) => {
        const delegate = {
          order_status_history: tx.orderStatusHistory, order_items: tx.orderItem, orders: tx.order,
          comanda_sessions: tx.comandaSession, comanda_invitations: tx.comandaInvitation, comandas: tx.comanda,
          products: tx.product, categories: tx.category, admins: tx.admin,
        }[table] as unknown as { deleteMany(args: { where: unknown }): Promise<{ count: number }> };
        deleted[table] = (await delegate.deleteMany({ where })).count;
      };
      for (const step of plan) await run(step.table, step.where);
    });
    return deleted;
  }

  /** Counts this run's rows still present (expected all zero after cleanup). */
  async remaining(): Promise<Record<string, number>> {
    const ids = await this.collectIds();
    return {
      admins: ids.adminIds.length, categories: ids.categoryIds.length, products: ids.productIds.length, comandas: ids.comandaIds.length,
      orders: await this.db.order.count({ where: { comanda: { number: { in: [this.identity.comandas.open, this.identity.comandas.other, ...this.identity.comandas.spare] } } } }),
    };
  }
}

/** Run ids left behind by interrupted runs, recovered from the category marker. */
export async function findStaleRunIds(db: PrismaClient): Promise<string[]> {
  const rows = await db.category.findMany({ where: { publicKey: { startsWith: `${FIXTURE_PREFIX}-` } }, select: { publicKey: true } });
  return rows.map((row) => row.publicKey!.slice(FIXTURE_PREFIX.length + 1)).filter((runId) => /^[0-9a-f]{8}$/.test(runId));
}

/** Leftovers of previous runs, by marker (used by the preflight; never deletes). */
export async function countLeftovers(db: PrismaClient): Promise<Record<string, number>> {
  return {
    admins: await db.admin.count({ where: { email: { startsWith: `${FIXTURE_PREFIX}-`, endsWith: `@${FIXTURE_EMAIL_DOMAIN}` } } }),
    categories: await db.category.count({ where: { publicKey: { startsWith: `${FIXTURE_PREFIX}-` } } }),
  };
}

/** Non-fixture rows that would collide with fixed fixture identities. */
export async function countCollisions(db: PrismaClient): Promise<Record<string, number>> {
  return {
    [`source_code ${ALPHANUMERIC_CODE}`]: await db.product.count({ where: { sourceCode: ALPHANUMERIC_CODE, NOT: { category: { publicKey: { startsWith: `${FIXTURE_PREFIX}-` } } } } }),
    'comandas reservadas sem identidade de fixture': await db.comanda.count({ where: {
      number: { startsWith: '9' },
      NOT: { invitations: {
        some: { issuer: { email: { startsWith: `${FIXTURE_PREFIX}-`, endsWith: `@${FIXTURE_EMAIL_DOMAIN}` } } },
        every: { issuer: { email: { startsWith: `${FIXTURE_PREFIX}-`, endsWith: `@${FIXTURE_EMAIL_DOMAIN}` } } },
      } },
    } }),
  };
}
