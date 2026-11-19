import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { accessBody } from './adminAuth.service';

type CategoryDb = Pick<PrismaClient, 'category' | '$transaction'>;
type AdminAuth = { authenticate: (token: string | undefined, db?: Pick<PrismaClient, 'admin'>) => Promise<unknown> };
const PUBLIC_KEY = /^rustika-category-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseBody(raw: unknown, creating: boolean) {
  const body = accessBody(raw, ['name', 'description', 'displayOrder']);
  if (creating ? body.name === undefined : Object.keys(body).length === 0) {
    throw new AppError(400, 'INVALID_INPUT', 'Informe os dados da categoria.');
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2 ||
    body.name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(body.name))) {
    throw new AppError(400, 'INVALID_INPUT', 'Nome de categoria inválido (2 a 100 caracteres).');
  }
  if (body.description !== undefined && body.description !== null &&
      (typeof body.description !== 'string' || body.description.length > 500 || /[\u0000-\u001f\u007f]/.test(body.description))) {
    throw new AppError(400, 'INVALID_INPUT', 'Descrição de categoria inválida.');
  }
  if (body.displayOrder !== undefined && (!Number.isSafeInteger(body.displayOrder) ||
      (body.displayOrder as number) < 0 || (body.displayOrder as number) > 9999)) {
    throw new AppError(400, 'INVALID_INPUT', 'Ordem de exibição inválida (0 a 9999).');
  }
  return {
    ...(body.name !== undefined ? { name: (body.name as string).trim() } : {}),
    ...(body.description !== undefined ? { description: typeof body.description === 'string' ? body.description.trim() || null : null } : {}),
    ...(body.displayOrder !== undefined ? { displayOrder: body.displayOrder as number } : {}),
  };
}

function databaseConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') throw new AppError(409, 'CATEGORY_CONFLICT', 'Já existe uma categoria com esse nome.');
    if (error.code === 'P2034') throw new AppError(409, 'CATEGORY_CONFLICT', 'Categoria alterada simultaneamente. Atualize e tente novamente.');
    if (error.code === 'P2025') throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
  }
  throw error;
}

const select = { publicKey: true, name: true, description: true, displayOrder: true, isActive: true } satisfies Prisma.CategorySelect;

export function createCategoryCrud(prisma: CategoryDb, auth: AdminAuth) {
  return {
    async list(token: string | undefined) {
      await auth.authenticate(token);
      return prisma.category.findMany({ where: { isActive: true, publicKey: { not: null } }, select,
        orderBy: [{ displayOrder: 'asc' }, { publicKey: 'asc' }] });
    },
    async create(raw: unknown, token: string | undefined) {
      await auth.authenticate(token);
      const input = parseBody(raw, true);
      try {
        return await prisma.$transaction(async (tx) => {
          await auth.authenticate(token, tx);
          return tx.category.create({ data: {
            name: input.name!, description: input.description ?? null,
            displayOrder: input.displayOrder ?? 0, publicKey: `rustika-category-local-${randomBytes(12).toString('hex')}`,
          }, select });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) { return databaseConflict(error); }
    },
    async update(publicKey: string, raw: unknown, token: string | undefined) {
      await auth.authenticate(token);
      if (!PUBLIC_KEY.test(publicKey) || publicKey.length > 64) throw new AppError(400, 'INVALID_CATEGORY_ID', 'Categoria inválida.');
      const input = parseBody(raw, false);
      try {
        return await prisma.$transaction(async (tx) => {
          await auth.authenticate(token, tx);
          const current = await tx.category.findUnique({ where: { publicKey }, select: { id: true, isActive: true } });
          if (!current?.isActive) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
          return tx.category.update({ where: { id: current.id }, data: input, select });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) { return databaseConflict(error); }
    },
  };
}
