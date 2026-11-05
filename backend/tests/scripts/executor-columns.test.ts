import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import { assertCatalogColumns, CATALOG_COLUMNS, executeSeedReal, toCatalogRecord } from '../../scripts/executor-seed-real';
import { generateClassificationReport } from '../../scripts/seed-real';
import { syntheticCatalogPath } from '../helpers/catalog-sources';
import { SYNTHETIC_EXPECTED } from '../fixtures/catalog/synthetic-catalog';

/**
 * 3D.3.25-E: regressão do bug dos cabeçalhos do executor. O código lia "C�digo" e "Pre�o venda"
 * (caractere de substituição U+FFFD), então `codigo` era sempre '' e `preco` sempre 0, sem erro algum.
 */
const rowsOf = (file: string) => {
  const wb = xlsx.read(readFileSync(file), { type: 'buffer' });
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!);
};
const base = { 'Nome curto': 'SINT X', Estado: 'Ativo', Grupo: 'SINT GRUPO 01' };
const fakePrisma = (existing: unknown[] = []) => ({
  $queryRaw: vi.fn(), $transaction: vi.fn(), $disconnect: vi.fn(),
  product: { findMany: vi.fn().mockResolvedValue(existing), upsert: vi.fn(), create: vi.fn() },
}) as unknown as PrismaClient & { product: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> } };
const tempCsv = (name: string, text: string) => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'rustika-cols-')), name);
  writeFileSync(file, '﻿' + text, 'utf8');
  return file;
};

describe('cabeçalhos do executor (regressão do U+FFFD)', () => {
  it('usa os cabeçalhos reais "Código" e "Preço venda", sem caractere de substituição', () => {
    expect(CATALOG_COLUMNS.codigo).toBe('Código');
    expect(CATALOG_COLUMNS.preco).toBe('Preço venda');
    for (const column of Object.values(CATALOG_COLUMNS)) expect(column).not.toContain('�');
    // Nenhum acesso por nome de coluna entre aspas pode conter U+FFFD no código-fonte.
    const source = readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'executor-seed-real.ts'), 'utf8');
    expect(source).not.toMatch(/\["[^"\n]*�[^"\n]*"\]/);
  });

  it('lê o código do produto, inclusive o alfanumérico, sem perdê-lo', () => {
    expect(toCatalogRecord({ ...base, 'Código': 'SX000001', 'Preço venda': 10 }).codigo).toBe('SX000001');
    expect(toCatalogRecord({ ...base, 'Código': 44, 'Preço venda': 10 }).codigo).toBe('44'); // numérico vira texto
    expect(toCatalogRecord({ ...base, 'Código': ' 77 ', 'Preço venda': 10 }).codigo).toBe('77');
  });

  it('lê o preço de venda (nunca 0 por engano) e aplica a regra 0.01 → INSUMO que antes não disparava', () => {
    expect(toCatalogRecord({ ...base, 'Código': '1', 'Preço venda': 12.5 }).preco).toBe(12.5);
    expect(toCatalogRecord({ ...base, 'Código': '1', 'Preço venda': '26' }).preco).toBe(26);
    expect(toCatalogRecord({ ...base, 'Código': '1', Grupo: 'DIVERSOS', 'Preço venda': 0.01 }).classificacao).toBe('INSUMO');
  });

  it('não substitui código vazio nem preço ilegível por valores padrão', () => {
    expect(() => toCatalogRecord({ ...base, 'Código': '', 'Preço venda': 10 })).toThrow(/Codigo vazio/);
    expect(() => toCatalogRecord({ ...base, 'Preço venda': 10 })).toThrow(/Codigo vazio/);
    expect(() => toCatalogRecord({ ...base, 'Código': '1' })).toThrow(/Preco ilegivel/);
    expect(() => toCatalogRecord({ ...base, 'Código': '1', 'Preço venda': 'abc' })).toThrow(/Preco ilegivel/);
  });

  it('cabeçalhos ausentes ou corrompidos falham de forma explícita e nomeada', () => {
    const ok = [{ ...base, 'Código': '1', 'Preço venda': 1 }];
    expect(() => assertCatalogColumns(ok)).not.toThrow();
    expect(() => assertCatalogColumns([{ ...base, 'Preço venda': 1 }])).toThrow(/Cabecalhos ausentes.*Código/);
    expect(() => assertCatalogColumns([{ ...base, 'Código': '1' }])).toThrow(/Preço venda/);
    // Cabeçalho com U+FFFD (o bug original) é inválido: não passa como se fosse "Código".
    expect(() => assertCatalogColumns([{ ...base, 'C�digo': '1', 'Preço venda': 1 }])).toThrow(/Cabecalhos ausentes.*Código/);
    expect(() => assertCatalogColumns([])).toThrow(/Cabecalhos ausentes/);
  });
});

describe('executor com a planilha sintética', () => {
  it('o executor e o relatório classificam as mesmas linhas, com os mesmos códigos', async () => {
    const report = await generateClassificationReport(syntheticCatalogPath);
    const viaExecutor = rowsOf(syntheticCatalogPath).filter((r) => r['Estado'] === 'Ativo').map(toCatalogRecord);
    expect(viaExecutor.map((r) => [r.codigo, r.classificacao])).toEqual(report.map((r) => [r.codigo, r.classificacao]));
    expect(viaExecutor.every((r) => r.codigo !== '')).toBe(true);
    expect(viaExecutor.some((r) => r.codigo === SYNTHETIC_EXPECTED.alphaCode)).toBe(true);
  });

  it('o plano mantém os quantitativos e a reconciliação enxerga os códigos (antes tudo virava código vazio)', async () => {
    const existing = [{
      id: 'p-44', publicKey: 'rustika-44', sourceCode: '44', sourceName: SYNTHETIC_EXPECTED.balyName,
      sourceGroup: 'INSUMO', categoryId: 'c1', price: new Prisma.Decimal(26),
    }];
    const prisma = fakePrisma(existing);
    const result = await executeSeedReal(prisma, { dryRun: true, catalogPath: syntheticCatalogPath });
    expect(result.plan).toEqual({ publicos: 144, internos: 24, incertos: 6, inativos: 30, total: 204 });
    expect(result.reconciliation.corretos).toBe(1);
    expect(result.reconciliation.ausentes).toBe(173);
    expect(result.reconciliation.semCorrespondencia).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('planilha sem o cabeçalho de preço aborta antes de consultar o banco', async () => {
    const file = tempCsv('sem-preco.csv', 'Código,Nome curto,Estado,Grupo\n1,SINT A,Ativo,SINT GRUPO 01\n');
    const prisma = fakePrisma();
    await expect(executeSeedReal(prisma, { dryRun: true, catalogPath: file })).rejects.toThrow(/Cabecalhos ausentes.*Preço venda/);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('produto ativo sem código aborta com erro explícito, não vira código vazio', async () => {
    const file = tempCsv('sem-codigo.csv', 'Código,Nome curto,Estado,Grupo,Preço venda\n1,SINT OK,Ativo,SINT GRUPO 01,5\n,SINT A,Ativo,SINT GRUPO 01,10\n');
    const prisma = fakePrisma();
    await expect(executeSeedReal(prisma, { dryRun: true, catalogPath: file })).rejects.toThrow(/Codigo vazio/);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('cabeçalho corrompido na planilha é recusado, não aceito silenciosamente', async () => {
    const file = tempCsv('corrompido.csv', 'C�digo,Nome curto,Estado,Grupo,Preço venda\n1,SINT A,Ativo,SINT GRUPO 01,10\n');
    await expect(executeSeedReal(fakePrisma(), { dryRun: true, catalogPath: file })).rejects.toThrow(/Cabecalhos ausentes/);
  });
});
