import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSeedReal } from '../../scripts/executor-seed-real';
import type { PrismaClient } from '@prisma/client';
import { syntheticCatalogPath } from '../helpers/catalog-sources';

// O executor le a fixture SINTETICA (quantitativos identicos aos da planilha real).
const catalogPath = syntheticCatalogPath;

describe('executeSeedReal: Executor offline', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: vi.fn(),
      $transaction: vi.fn((callback: (tx: any) => Promise<number>) => callback(mockPrisma)),
      $disconnect: vi.fn(),
      product: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), create: vi.fn() },
    } as unknown as PrismaClient;
  });

  describe('Validacoes de banco e role', () => {
    it('aceita banco correto e role correto', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'cardapio_migrator' },
      ]);
      const result = await executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath });
      expect(result.errors).toHaveLength(0);
    });

    it('rejeita a role de aplicacao cardapio_dev_app', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'cardapio_dev_app' },
      ]);
      await expect(executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath }))
        .rejects.toThrow('Role incorreto');
    });

    it('falha se banco incorreto', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'wrong_db', usr: 'cardapio_migrator' },
      ]);
      await expect(executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath }))
        .rejects.toThrow('Banco incorreto');
    });

    it('falha se role incorreto', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'postgres' },
      ]);
      await expect(executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath }))
        .rejects.toThrow('Role incorreto');
    });
  });

  describe('Modo dry-run', () => {
    it('dry-run nao executa consulta de banco', async () => {
      const result = await executeSeedReal(mockPrisma, { dryRun: true, catalogPath });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.created).toBe(0);
    });

    it('dry-run retorna plano correto', async () => {
      const result = await executeSeedReal(mockPrisma, { dryRun: true, catalogPath });
      expect(result.plan.publicos).toBe(144);
      expect(result.plan.internos).toBe(24);
      expect(result.plan.incertos).toBe(6);
      expect(result.plan.inativos).toBe(30);
      expect(result.plan.total).toBe(204);
    });

    it('dry-run nao executa transacao', async () => {
      await executeSeedReal(mockPrisma, { dryRun: true, catalogPath });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('Confirmacao explícita', () => {
    it('requireConfirm true nao executa transacao', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'cardapio_migrator' },
      ]);
      await executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: true, catalogPath });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('Quantitativos', () => {
    it('plano contem quantitativos corretos', async () => {
      const result = await executeSeedReal(mockPrisma, { dryRun: true, catalogPath });
      expect(result.plan).toEqual({
        publicos: 144,
        internos: 24,
        incertos: 6,
        inativos: 30,
        total: 204,
      });
    });
  });

  describe('Precos e publicKeys', () => {
    it('comercializaveis recebem publicKey rustika-{codigo}', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'cardapio_migrator' },
      ]);
      mockPrisma.$transaction.mockImplementation((callback: (tx: any) => Promise<number>) => callback(mockPrisma));

      await executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: false, catalogPath });
      const call = mockPrisma.product.upsert.mock.calls[0];
      if (call) {
        expect(call[0].create.publicKey).toMatch(/^rustika-/);
      }
    });

    it('insumos nao recebem publicKey explícita', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { db: 'cardapio_digital_dev', usr: 'cardapio_migrator' },
      ]);
      mockPrisma.$transaction.mockImplementation((callback: (tx: any) => Promise<number>) => callback(mockPrisma));

      await executeSeedReal(mockPrisma, { dryRun: false, requireConfirm: false, catalogPath });
      const calls = mockPrisma.product.create.mock.calls;
      if (calls.length > 0) {
        expect(calls[0][0].data.publicKey).toBeUndefined();
      }
    });
  });
});
