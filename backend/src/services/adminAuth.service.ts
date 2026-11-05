import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { adminUnauthorized, createAdminSessions } from '../security/adminSessions';
import { validPasswordInput, verifyPassword } from '../security/password';

type AdminDb = Pick<PrismaClient, 'admin'>;

export function accessBody(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new AppError(400, 'INVALID_INPUT', 'Dados da requisição inválidos.');
  }
  return value as Record<string, unknown>;
}

export function createAdminAuth(prisma: AdminDb, now = () => new Date()) {
  const sessions = createAdminSessions(now);
  let passwordChecks = 0;
  return {
    async login(raw: unknown, oldToken?: string) {
      const body = accessBody(raw, ['email', 'password']);
      if (typeof body.email !== 'string' || body.email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || !validPasswordInput(body.password)) {
        throw new AppError(400, 'INVALID_INPUT', 'Informe e-mail e senha válidos.');
      }
      if (passwordChecks >= 4) throw new AppError(429, 'TOO_MANY_REQUESTS', 'Aguarde antes de tentar novamente.');
      passwordChecks++;
      try {
        const admin = await prisma.admin.findUnique({ where: { email: body.email.trim().toLowerCase() },
          select: { id: true, name: true, email: true, passwordHash: true, isActive: true, updatedAt: true } });
        const valid = await verifyPassword(body.password, admin?.passwordHash);
        if (!valid || !admin?.isActive) throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
        sessions.revoke(oldToken);
        const session = sessions.issue(admin.id, admin.updatedAt.getTime());
        return { ...session, admin: { id: admin.id, name: admin.name, email: admin.email } };
      } finally { passwordChecks--; }
    },
    async authenticate(token: string | undefined, db: AdminDb = prisma) {
      const session = sessions.get(token);
      const admin = await db.admin.findUnique({ where: { id: session.adminId },
        select: { id: true, name: true, email: true, isActive: true, updatedAt: true } });
      if (!admin?.isActive || admin.updatedAt.getTime() !== session.version) {
        sessions.revoke(token); adminUnauthorized();
      }
      // A logout/expiry while awaiting the database also invalidates this request.
      sessions.get(token);
      return { admin: { id: admin.id, name: admin.name, email: admin.email }, expiresAt: session.expiresAt };
    },
    logout: sessions.revoke,
  };
}
export type AdminAuth = ReturnType<typeof createAdminAuth>;
