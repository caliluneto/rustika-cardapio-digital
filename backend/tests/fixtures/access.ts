import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Admin, Comanda, ComandaInvitation, ComandaSession, PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import { hashPassword } from '../../src/security/password';
import { mockOrderPrisma } from './orders';

export const TEST_PASSWORD = 'Only-a-test-password!42';
let passwordHash: Promise<string> | undefined;
export const testHash = () => passwordHash ??= hashPassword(TEST_PASSWORD);

interface State { comandas: Comanda[]; invitations: ComandaInvitation[]; sessions: ComandaSession[] }
const conflict = () => new Prisma.PrismaClientKnownRequestError('simulated serialization conflict', { code: 'P2034', clientVersion: '6.19.3' });

/** Optimistic transaction double with version checks. Never instantiates PrismaClient.
 * Concurrent callbacks can read the same invitation; only one draft can commit.
 * This is an application test, not proof of PostgreSQL isolation/rollback. */
export async function mockAccessPrisma() {
  let time = new Date();
  const now = () => new Date(time);
  const admin: Admin = { id: randomUUID(), name: 'Administrador de teste', email: 'admin@example.test',
    passwordHash: await testHash(), isActive: true, createdAt: now(), updatedAt: now() };
  const control = { failSession: false, failCommit: false, missingAdmin: false };
  let state: State = { comandas: [], invitations: [], sessions: [] };
  let version = 0;
  const orderMock = mockOrderPrisma();
  const adminFind = vi.fn(async ({ where }: { where: { email?: string; id?: string } }) =>
    !control.missingAdmin && (where.email === admin.email || where.id === admin.id) ? admin : null);
  const comandaUpsert = vi.fn(async ({ where }: { where: { number: string } }, draft: State) => {
    let row = draft.comandas.find((entry) => entry.number === where.number);
    if (!row) {
      row = { id: randomUUID(), number: where.number, status: 'OPEN', openedAt: now(), closedAt: null };
      draft.comandas.push(row);
    }
    return row;
  });
  type InviteData = { comandaId: string; issuedByAdminId: string; tokenHash: string; createdAt: Date; expiresAt: Date };
  const inviteCreate = vi.fn(async ({ data }: { data: InviteData }, draft: State) => {
    const row: ComandaInvitation = { id: randomUUID(), ...data, consumedAt: null, revokedAt: null };
    draft.invitations.push(row); return row;
  });
  const inviteFind = vi.fn(async ({ where }: { where: { tokenHash: string } }, draft: State) => {
    const row = draft.invitations.find((entry) => entry.tokenHash === where.tokenHash);
    return row ? { ...row, comanda: draft.comandas.find((entry) => entry.id === row.comandaId), issuer: { isActive: admin.isActive } } : null;
  });
  type Claim = { where: { id: string; comandaId: string; expiresAt: { gt: Date } }; data: { consumedAt: Date } };
  const inviteClaim = vi.fn(async ({ where, data }: Claim, draft: State) => {
    const row = draft.invitations.find((entry) => entry.id === where.id && entry.comandaId === where.comandaId);
    const comanda = draft.comandas.find((entry) => entry.id === row?.comandaId);
    if (!row || row.consumedAt || row.revokedAt || row.expiresAt <= where.expiresAt.gt || comanda?.status !== 'OPEN' || !admin.isActive) return { count: 0 };
    row.consumedAt = data.consumedAt; return { count: 1 };
  });
  type SessionData = { comandaId: string; invitationId: string; credentialHash: string; createdAt: Date; expiresAt: Date };
  const sessionCreate = vi.fn(async ({ data }: { data: SessionData }, draft: State) => {
    if (control.failSession) throw new Error('private simulated session failure');
    const row: ComandaSession = { id: randomUUID(), ...data, revokedAt: null };
    draft.sessions.push(row); return row;
  });
  const sessionFind = vi.fn(async ({ where }: { where: { credentialHash: string } }, draft: State = state) => {
    const row = draft.sessions.find((entry) => entry.credentialHash === where.credentialHash);
    return row ? { ...row, comanda: draft.comandas.find((entry) => entry.id === row.comandaId) } : null;
  });
  const transaction = vi.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: unknown) => {
    const observedVersion = version;
    const draft = structuredClone(state);
    return orderMock.transaction(async (orderTx: Prisma.TransactionClient) => {
      const tx = {
        ...orderTx, admin: { findUnique: adminFind },
        comanda: { upsert: (args: Parameters<typeof comandaUpsert>[0]) => comandaUpsert(args, draft) },
        comandaInvitation: {
          create: (args: Parameters<typeof inviteCreate>[0]) => inviteCreate(args, draft),
          findUnique: (args: Parameters<typeof inviteFind>[0]) => inviteFind(args, draft),
          updateMany: (args: Claim) => inviteClaim(args, draft),
        },
        comandaSession: {
          create: (args: Parameters<typeof sessionCreate>[0]) => sessionCreate(args, draft),
          findUnique: (args: Parameters<typeof sessionFind>[0]) => sessionFind(args, draft),
        },
      } as unknown as Prisma.TransactionClient;
      const result = await callback(tx);
      if (control.failCommit) throw new Error('private simulated commit failure');
      if (observedVersion !== version) throw conflict();
      state = draft; version++;
      return result;
    }, options);
  });
  const prisma = { admin: { findUnique: adminFind }, comandaSession: { findUnique: sessionFind }, $transaction: transaction } as unknown as PrismaClient;
  return { prisma, admin, now, advance: (ms: number) => { time = new Date(time.getTime() + ms); }, state: () => state,
    control, transaction, adminFind, comandaUpsert, inviteCreate, inviteFind, inviteClaim, sessionCreate, sessionFind, orderMock };
}
