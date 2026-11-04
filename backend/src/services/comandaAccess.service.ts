import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { isValidComandaNumber } from '../domain/rules';
import { accessBody } from './adminAuth.service';
import type { AdminAuth } from './adminAuth.service';
import { assertActiveSession, sessionSelect, sha256, validateSessionToken } from './orderSession';

export const COMANDA_SESSION_MS = 8 * 60 * 60 * 1000;
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 };

function invalidInvite(): never {
  throw new AppError(401, 'INVALID_INVITATION', 'Convite inválido ou indisponível para resgate.');
}

export function createComandaAccess(prisma: PrismaClient, auth: AdminAuth, now = () => new Date()) {
  return {
    async issue(raw: unknown, adminToken: string | undefined) {
      // Authorize before accepting business parameters; recheck inside the transaction.
      await auth.authenticate(adminToken);
      const body = accessBody(raw, ['comandaNumber', 'expiresInMinutes']);
      const minutes = body.expiresInMinutes === undefined ? 10 : body.expiresInMinutes;
      if (typeof body.comandaNumber !== 'string' || !isValidComandaNumber(body.comandaNumber) ||
          !Number.isInteger(minutes) || (minutes as number) < 1 || (minutes as number) > 30) {
        throw new AppError(400, 'INVALID_INPUT', 'Informe comanda de 1 a 6 dígitos e validade entre 1 e 30 minutos.');
      }
      const number = body.comandaNumber;
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            const { admin } = await auth.authenticate(adminToken, tx);
            const comanda = await tx.comanda.upsert({ where: { number }, create: { number }, update: {},
              select: { id: true, number: true, status: true, closedAt: true } });
            if (comanda.status !== 'OPEN' || comanda.closedAt !== null) {
              throw new AppError(409, 'COMANDA_CLOSED', 'Esta comanda está encerrada e não pode receber convites.');
            }
            const token = randomBytes(32).toString('hex');
            const createdAt = now();
            const expiresAt = new Date(createdAt.getTime() + (minutes as number) * 60000);
            await tx.comandaInvitation.create({ data: { comandaId: comanda.id, issuedByAdminId: admin.id,
              tokenHash: sha256(token), createdAt, expiresAt }, select: { id: true } });
            return { comanda: { number: comanda.number }, inviteToken: token, expiresAt };
          }, transactionOptions);
        } catch (error) {
          const conflict = error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === 'P2034' || (error.code === 'P2002' && Array.isArray(error.meta?.target) && error.meta.target.includes('number')));
          if (conflict) {
            if (attempt < 2) continue;
            throw new AppError(409, 'ACCESS_CONFLICT', 'Não foi possível emitir o convite. Tente novamente.');
          }
          throw error;
        }
      }
    },

    async redeem(raw: unknown) {
      const body = accessBody(raw, ['inviteToken']);
      if (typeof body.inviteToken !== 'string' || !/^[0-9a-f]{64}$/.test(body.inviteToken)) invalidInvite();
      const tokenHash = sha256(body.inviteToken);
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            const invitation = await tx.comandaInvitation.findUnique({ where: { tokenHash }, select: {
              id: true, comandaId: true, createdAt: true, expiresAt: true, consumedAt: true, revokedAt: true,
              comanda: { select: { id: true, number: true, status: true, closedAt: true } },
              issuer: { select: { isActive: true } },
            } });
            const time = now();
            if (!invitation || invitation.createdAt > time || invitation.expiresAt <= time || invitation.consumedAt !== null ||
                invitation.revokedAt !== null || !invitation.issuer.isActive || invitation.comandaId !== invitation.comanda.id ||
                invitation.comanda.status !== 'OPEN' || invitation.comanda.closedAt !== null) invalidInvite();
            const claimed = await tx.comandaInvitation.updateMany({ where: {
              id: invitation.id, comandaId: invitation.comandaId, consumedAt: null, revokedAt: null,
              createdAt: { lte: time }, expiresAt: { gt: time },
              comanda: { is: { status: 'OPEN', closedAt: null } }, issuer: { is: { isActive: true } },
            }, data: { consumedAt: time } });
            if (claimed.count !== 1) invalidInvite();
            const token = randomBytes(32).toString('hex');
            const session = await tx.comandaSession.create({ data: {
              comandaId: invitation.comandaId, invitationId: invitation.id, credentialHash: sha256(token),
              createdAt: time, expiresAt: new Date(time.getTime() + COMANDA_SESSION_MS),
            }, select: { expiresAt: true } });
            return { token, expiresAt: session.expiresAt, comanda: { number: invitation.comanda.number, status: 'OPEN' as const } };
          }, transactionOptions);
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2034') {
              if (attempt < 2) continue;
              throw new AppError(409, 'ACCESS_CONFLICT', 'Não foi possível concluir o resgate. Verifique sua sessão antes de tentar novamente.');
            }
            if (error.code === 'P2002' && Array.isArray(error.meta?.target) &&
                error.meta.target.some((key) => key === 'invitation_id' || key === 'invitationId')) invalidInvite();
          }
          throw error;
        }
      }
    },

    async current(token: string | undefined) {
      const credentialHash = sha256(validateSessionToken(token));
      const session = await prisma.comandaSession.findUnique({ where: { credentialHash }, select: sessionSelect });
      assertActiveSession(session, now());
      return { comanda: { number: session.comanda.number, status: session.comanda.status }, expiresAt: session.expiresAt };
    },
  };
}
