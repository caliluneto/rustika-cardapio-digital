import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSeedReal } from '../../scripts/executor-seed-real';
import type { PrismaClient } from '@prisma/client';
import { syntheticCatalogPath } from '../helpers/catalog-sources';

// 3D.3.25-D: fixture SINTETICA no lugar da planilha real.
const catalogPath = syntheticCatalogPath;

describe('Seed atual: executor offline', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
      $transaction: vi.fn((callback: (tx: any) => Promise<unknown>) => callback(mockPrisma)),
      $disconnect: vi.fn(),
      product: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), create: vi.fn() },
    } as unknown as PrismaClient;
  });

  it('aceita banco de desenvolvimento com a role de migracao', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { db: 'cardapio_digital_dev', usr: 'cardapio_migrator' },
    ]);

    const result = await executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath });

    expect(result.errors).toHaveLength(0);
  });

  it('rejeita a role de aplicacao cardapio_dev_app', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { db: 'cardapio_digital_dev', usr: 'cardapio_dev_app' },
    ]);

    await expect(executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath }))
      .rejects.toThrow('Role incorreto');
  });

  it('rejeita banco diferente do esperado', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { db: 'cardapio_digital_test', usr: 'cardapio_migrator' },
    ]);

    await expect(executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath }))
      .rejects.toThrow('Banco incorreto');
  });

  it('dry-run nao acessa o banco', async () => {
    const result = await executeSeedReal(mockPrisma, { dryRun: true, catalogPath });

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(result.plan).toEqual({
      publicos: 144,
      internos: 24,
      incertos: 6,
      inativos: 30,
      total: 204,
    });
  });
});
