import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import { defaultCatalogPath, generateClassificationReport, validateAllPrices } from '../../scripts/seed-real';
import { executeSeedReal } from '../../scripts/executor-seed-real';
import { assertCatalogTotals, readExcelExpectations } from '../../scripts/inspect-reconciliation';
import { syntheticCatalogPath, syntheticInvalidPricesPath } from '../helpers/catalog-sources';
import {
  buildInvalidPricesCsv, buildSyntheticCatalogCsv, CATALOG_HEADERS, INVALID_PRICE_CODES, SYNTHETIC_EXPECTED, syntheticRows,
} from '../fixtures/catalog/synthetic-catalog';

const scriptsDir = path.resolve(__dirname, '..', '..', 'scripts');
const rowsOf = (file: string) => {
  const wb = xlsx.read(readFileSync(file), { type: 'buffer' });
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
};

describe('fixture sintética do catálogo (3D.3.25-D)', () => {
  it('o CSV versionado é idêntico ao gerador determinístico (BOM incluído)', () => {
    expect(readFileSync(syntheticCatalogPath, 'utf8')).toBe(buildSyntheticCatalogCsv());
    expect(readFileSync(syntheticInvalidPricesPath, 'utf8')).toBe(buildInvalidPricesCsv());
    expect(buildSyntheticCatalogCsv()).toBe(buildSyntheticCatalogCsv());
    expect(readFileSync(syntheticCatalogPath)[0]).toBe(0xef); // BOM UTF-8: sem ele "Código" vira mojibake
  });

  it('tem as colunas da planilha real e os quantitativos de referência', () => {
    const rows = rowsOf(syntheticCatalogPath);
    expect(rows).toHaveLength(SYNTHETIC_EXPECTED.total);
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    for (const header of ['Código', 'Nome curto', 'Estado', 'Grupo', 'Preço venda']) expect(keys.has(header), header).toBe(true);
    expect(CATALOG_HEADERS).toContain('Preço custo');
    expect(rows.filter((r) => r['Estado'] === 'Ativo')).toHaveLength(SYNTHETIC_EXPECTED.ativos);
    expect(rows.filter((r) => r['Estado'] === 'Inativo')).toHaveLength(SYNTHETIC_EXPECTED.inativosExcluidos);
    expect(new Set(rows.map((r) => String(r['Código']))).size).toBe(rows.length); // códigos únicos
  });

  it('é inteiramente fictício: nomes SINT, preços da fórmula, nenhuma credencial', () => {
    const text = readFileSync(syntheticCatalogPath, 'utf8');
    for (const r of syntheticRows()) expect(r.nome.startsWith('SINT '), r.nome).toBe(true);
    expect(text).not.toMatch(/postgres|password|senha|secret|token|@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\//i);
    const prices = rowsOf(syntheticCatalogPath).map((r) => Number(r['Preço venda']));
    expect(prices.every((p) => Number.isFinite(p) && p >= 0.01 && p < 100)).toBe(true);
  });

  it('o totalizador do inspetor aceita a fixture (mesmos totais de referência) e conta os mesmos números', () => {
    const catalog = readExcelExpectations(syntheticCatalogPath);
    expect(() => assertCatalogTotals(catalog)).not.toThrow();
    expect(catalog.totais.candidatos).toBe(SYNTHETIC_EXPECTED.candidatos);
  });

  it('exercita as regras: 0.01→INSUMO, tokens de incerto, exceções do grupo INSUMO e aparo do grupo', async () => {
    const report = await generateClassificationReport(syntheticCatalogPath);
    expect(report.filter((r) => r.preco === 0.01).map((r) => r.classificacao)).toEqual(['INSUMO', 'INSUMO', 'INSUMO']);
    expect(report.filter((r) => r.classificacao === 'INCERTO').map((r) => r.nome).sort()).toEqual([
      'SINT CDB', 'SINT CHICLETE', 'SINT GUARDA VOLUME', 'SINT HALLS', 'SINT ISQUEIRO MACARICO', 'SINT PALHEIRO',
    ]);
    expect(report.find((r) => r.nome === SYNTHETIC_EXPECTED.balyName)?.classificacao).toBe('COMERCIALIZADO');
    // Há uma linha cujo grupo bruto termina em espaço; o relatório deve aparar.
    expect(rowsOf(syntheticCatalogPath).some((r) => String(r['Grupo']).endsWith(' '))).toBe(true);
    expect(report.some((r) => r.grupo.endsWith(' '))).toBe(false);
  });
});

describe('caminhos de falha com preços inválidos (fixture sintética)', () => {
  it('validateAllPrices lista cada preço inválido ativo e ignora inativos', async () => {
    const error = await validateAllPrices(syntheticInvalidPricesPath).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(`${INVALID_PRICE_CODES.length} erro(s) de preco`);
    for (const code of INVALID_PRICE_CODES) expect(message, code).toContain(`Codigo ${code}:`);
    expect(message).not.toContain('Codigo 9006'); // inativo
    expect(message).not.toContain('Codigo 9001'); // válido
  });

  it('o executor aborta antes de qualquer escrita quando há preço inválido', async () => {
    const prisma = {
      $queryRaw: vi.fn(), $transaction: vi.fn(), $disconnect: vi.fn(),
      product: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), create: vi.fn() },
    } as unknown as PrismaClient;
    await expect(executeSeedReal(prisma, { dryRun: true, catalogPath: syntheticInvalidPricesPath })).rejects.toThrow(/erro\(s\) de preco/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect((prisma as unknown as { product: { upsert: unknown } }).product.upsert).not.toHaveBeenCalled();
  });
});

describe('a planilha real continua sendo o padrão das operações reais', () => {
  it('o caminho padrão aponta para backend/data/Exportacao-produtos.xlsx', () => {
    expect(path.normalize(defaultCatalogPath).split(path.sep).slice(-3)).toEqual(['backend', 'data', 'Exportacao-produtos.xlsx']);
  });

  it('nenhum script de operação referencia a fixture ou lê variável de ambiente para trocar a planilha', () => {
    for (const file of ['seed-real.ts', 'executor-seed-real.ts', 'inspect-reconciliation.ts']) {
      // Só o código conta: os comentários explicam a fixture e podem citá-la.
      const source = readFileSync(path.join(scriptsDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/fixtures|synthetic|sintetic/i);
      expect(source, file).not.toMatch(/process\.env\.\w*(CATALOG|XLSX)/i);
    }
  });

  it('a linha de comando do executor não repassa catalogPath (usa sempre a planilha real)', () => {
    const source = readFileSync(path.join(scriptsDir, 'executor-seed-real.ts'), 'utf8');
    expect(source).toMatch(/executeSeedReal\(prisma, \{ dryRun, requireConfirm: dryRun \}\)/);
  });
});
