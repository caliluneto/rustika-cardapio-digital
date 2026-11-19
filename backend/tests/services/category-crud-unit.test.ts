import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createCategoryCrud } from '../../src/services/categoryCrud.service';
import { AppError } from '../../src/middleware/errorHandler';

function setup() {
  const category = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue({ id: 'uuid', isActive: true }),
    create: vi.fn().mockImplementation(async (args) => ({ ...args.data, isActive: true })),
    update: vi.fn().mockImplementation(async (args) => ({ ...args.data, publicKey: 'rustika-category-test' })),
  };
  const prisma = { category, $transaction: vi.fn().mockImplementation(async (fn) => fn({ category })) };
  const auth = { authenticate: vi.fn().mockResolvedValue({ admin: { id: 'admin' } }) };
  return { category, prisma, auth,
    service: createCategoryCrud(prisma as unknown as PrismaClient, auth) };
}

describe('CRUD administrativo de categorias', () => {
  it('autentica antes de listar ou processar qualquer escrita', async () => {
    const { service, prisma, auth } = setup();
    auth.authenticate.mockRejectedValue(new AppError(401, 'UNAUTHORIZED', 'Não autorizado.'));
    await expect(service.list(undefined)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.create({ name: 'Teste' }, undefined)).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.update('rustika-category-test', { name: 'Teste' }, undefined)).rejects.toMatchObject({ statusCode: 401 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita payloads desconhecidos, nomes inválidos, ordem fracionária e alteração de identidade', async () => {
    const { service, category } = setup();
    await expect(service.create({ name: 'OK', isActive: false }, 'token')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create({ name: '\u0000' }, 'token')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.create({ name: 'Nova', displayOrder: 1.5 }, 'token')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('rustika-category-test', { publicKey: 'forged' }, 'token')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.update('invalida', { name: 'OK' }, 'token')).rejects.toMatchObject({ statusCode: 400 });
    expect(category.create).not.toHaveBeenCalled();
    expect(category.update).not.toHaveBeenCalled();
  });

  it('gera identidade no servidor, reautentica na transação e atualiza apenas campos permitidos', async () => {
    const { service, category, auth } = setup();
    const created = await service.create({ name: ' Nova categoria ', displayOrder: 42 }, 'token');
    expect(created.publicKey).toMatch(/^rustika-category-local-[a-f0-9]{24}$/);
    expect(category.create.mock.calls[0]?.[0].data).toMatchObject({ name: 'Nova categoria', displayOrder: 42 });
    await service.update(created.publicKey!, { description: ' Nova descrição ' }, 'token');
    expect(category.update.mock.calls[0]?.[0].data).toEqual({ description: 'Nova descrição' });
    expect(auth.authenticate).toHaveBeenCalledTimes(4);
  });

  it('transforma violação de unicidade e concorrência em 409 sem expor erro do banco', async () => {
    const { service, category } = setup();
    category.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' }));
    await expect(service.create({ name: 'Repetida' }, 'token')).rejects.toMatchObject({ statusCode: 409, code: 'CATEGORY_CONFLICT' });
  });
});
