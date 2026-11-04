import { randomBytes } from 'node:crypto';
import { sha256 } from '../services/orderSession';
import { AppError } from '../middleware/errorHandler';

export const ADMIN_COOKIE = 'rustika_admin';
export const ADMIN_SESSION_MS = 60 * 60 * 1000;

export function readOpaqueCookie(header: string | undefined, name: string): string | undefined {
  const parts = (header ?? '').split(';').map((part) => part.trim()).filter((part) => part.split('=')[0] === name);
  if (parts.length !== 1) return undefined;
  const token = parts[0]!.slice(name.length + 1);
  return /^[0-9a-f]{64}$/.test(token) ? token : undefined;
}

export function adminUnauthorized(): never {
  throw new AppError(401, 'ADMIN_UNAUTHENTICATED', 'Sessão administrativa inválida ou expirada.');
}

interface Session { adminId: string; version: number; expiresAt: Date }

/** Deliberately process-local: restarting or changing instance requires a new login. */
export function createAdminSessions(now: () => Date, capacity = 1000) {
  const sessions = new Map<string, Session>();
  function cleanup() {
    const time = now().getTime();
    for (const [key, session] of sessions) if (session.expiresAt.getTime() <= time) sessions.delete(key);
  }
  return {
    issue(adminId: string, version: number) {
      cleanup();
      if (sessions.size >= capacity) throw new AppError(503, 'AUTH_UNAVAILABLE', 'Autenticação temporariamente indisponível.');
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(now().getTime() + ADMIN_SESSION_MS);
      sessions.set(sha256(token), { adminId, version, expiresAt });
      return { token, expiresAt };
    },
    get(token: string | undefined): Session {
      cleanup();
      if (!token || !/^[0-9a-f]{64}$/.test(token)) adminUnauthorized();
      const session = sessions.get(sha256(token));
      if (!session) adminUnauthorized();
      return session;
    },
    revoke(token: string | undefined) { if (token) sessions.delete(sha256(token)); },
  };
}
