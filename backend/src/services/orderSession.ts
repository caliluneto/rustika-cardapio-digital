import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';

export const SESSION_COOKIE = 'rustika_session';
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function invalidSession(): never {
  throw new AppError(401, 'INVALID_SESSION', 'Sessão de comanda inválida ou expirada.');
}

/** Credential is a 32-byte random secret encoded as hex, never a comanda/UUID/hash. */
export function validateSessionToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalidSession();
  return value;
}

export function readSessionCookie(header: string | undefined): string {
  const values = (header ?? '').split(';').map((part) => part.trim()).filter((part) => part.split('=')[0] === SESSION_COOKIE);
  if (values.length !== 1) invalidSession();
  return validateSessionToken(values[0]!.slice(SESSION_COOKIE.length + 1));
}

export const sessionSelect = {
  id: true, comandaId: true, createdAt: true, expiresAt: true, revokedAt: true,
  comanda: { select: { id: true, number: true, status: true, closedAt: true } },
} satisfies Prisma.ComandaSessionSelect;
export type OrderSession = Prisma.ComandaSessionGetPayload<{ select: typeof sessionSelect }>;

export function assertActiveSession(session: OrderSession | null, now: Date): asserts session is OrderSession {
  if (!session || session.revokedAt !== null || session.expiresAt <= now || session.createdAt > now ||
      session.comandaId !== session.comanda.id || session.comanda.status !== 'OPEN' || session.comanda.closedAt !== null) invalidSession();
}
