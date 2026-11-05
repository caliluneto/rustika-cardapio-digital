import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import * as xlsx from 'xlsx';
import { generateClassificationReport, validateAllPrices } from '../../scripts/seed-real';
import { assertCatalogColumns, executeSeedReal, toCatalogRecord } from '../../scripts/executor-seed-real';
import { assertCatalogTotals, readExcelExpectations, reconcileWithBank } from '../../scripts/inspect-reconciliation';
import { hasRealCatalog, realCatalogPath } from '../helpers/catalog-sources';
import { syntheticRows } from '../fixtures/catalog/synthetic-catalog';

/**
 * Asserções sobre a planilha REAL (dado privado, fora do Git). Preservam as verificações que existiam antes da
 * 3D.3.25-D sobre o conteúdo real. Rodam só onde `backend/data/Exportacao-produtos.xlsx` existe; no CI aparecem como
 * "skipped". Que a fixture sintética passe NÃO substitui estas verificações.
 */
describe.skipIf(!hasRealCatalog)('planilha real privada (somente onde ela existe)', () => {
  it('seed-real: 174 ativos = 144 comercializáveis + 24 insumos + 6 incertos', async () => {
    const report = await generateClassificationReport(realCatalogPath);
    expect(report).toHaveLength(174);
    expect(report.filter((r) => r.classificacao === 'COMERCIALIZADO')).toHaveLength(144);
    expect(report.filter((r) => r.classificacao === 'INSUMO')).toHaveLength(24);
    expect(report.filter((r) => r.classificacao === 'INCERTO')).toHaveLength(6);
  });

  it('seed-real: itens e IDs conhecidos do ERP, grupos e aparo de espaços', async () => {
    const report = await generateClassificationReport(realCatalogPath);
    expect(report.find((r) => r.nome === 'BALY 2L')?.classificacao).toBe('COMERCIALIZADO');
    expect(report.find((r) => r.nome.includes('PANCETA'))?.classificacao).toBe('COMERCIALIZADO');
    expect(report.find((r) => r.codigo === '44')).toBeDefined();
    expect(report.find((r) => r.codigo === '47')).toBeDefined();
    const groups = new Set(report.map((r) => r.grupo));
    expect(groups.has('INSUMO') && groups.has('DIVERSOS')).toBe(true);
    expect(report.filter((r) => r.grupo.endsWith(' '))).toHaveLength(0);
    report.filter((r) => r.preco === 0.01).forEach((r) => expect(r.classificacao).toBe('INSUMO'));
  });

  it('seed-real: todos os preços ativos são válidos', async () => {
    await expect(validateAllPrices(realCatalogPath)).resolves.toBeUndefined();
  });

  it('executor: o plano de dry-run tem os quantitativos de referência', async () => {
    const prisma = {
      $queryRaw: vi.fn(), $transaction: vi.fn(), $disconnect: vi.fn(),
      product: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), create: vi.fn() },
    } as unknown as PrismaClient;
    const result = await executeSeedReal(prisma, { dryRun: true, catalogPath: realCatalogPath });
    expect(result.plan).toEqual({ publicos: 144, internos: 24, incertos: 6, inativos: 30, total: 204 });
  });


  it('executor (somente leitura): cabeçalhos reais OK, nenhum código vazio e mesma classificação do relatório', async () => {
    const wb = xlsx.read(readFileSync(realCatalogPath), { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    expect(() => assertCatalogColumns(rows)).not.toThrow();
    const viaExecutor = rows.filter((r) => r['Estado'] === 'Ativo').map(toCatalogRecord);
    expect(viaExecutor.every((r) => r.codigo !== '')).toBe(true);
    expect(viaExecutor.some((r) => r.preco > 0)).toBe(true); // antes todos saíam como 0
    const report = await generateClassificationReport(realCatalogPath);
    expect(viaExecutor.map((r) => [r.codigo, r.classificacao])).toEqual(report.map((r) => [r.codigo, r.classificacao]));
  });

  it('inspetor: totais de referência e a incompatibilidade do código alfanumérico real', () => {
    const catalog = readExcelExpectations(realCatalogPath);
    expect(catalog.totais).toEqual({ total: 204, ativos: 174, publicos: 144, internos: 24,
      incertosSuspensos: 6, inativosExcluidos: 30, candidatos: 168 });
    expect(() => assertCatalogTotals(catalog)).not.toThrow();
    const result = reconcileWithBank(catalog, [], []);
    expect(result.incompatibilidadesCatalogo.map((p) => p.codigo)).toEqual(['PA062240']);
    expect(result.reconciliacao.AUSENTE).toBe(168);
  });

  it('a fixture sintética não reproduz nenhum nome de produto da planilha real', () => {
    const wb = xlsx.read(readFileSync(realCatalogPath), { type: 'buffer' });
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
    const realNames = new Set(rows.map((r) => String(r['Nome curto'] ?? '').trim().toLowerCase()));
    const overlap = syntheticRows().filter((r) => realNames.has(r.nome.toLowerCase()));
    expect(overlap.map((r) => r.nome)).toEqual([]); // imprime só nomes sintéticos, nunca dados reais
  });
});
