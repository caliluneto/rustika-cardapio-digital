import { Prisma, PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as path from 'path';

/** Parser monetario deterministico para centavos */
export function parsePrice(raw: any): Prisma.Decimal {
  if (raw === null || raw === undefined || raw === '') {
    throw new Error('Preco vazio ou nulo.');
  }
  let price: number;
  if (typeof raw === 'number') {
    price = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') throw new Error('Preco vazio.');
    if (!/^[\d,.]+$/.test(trimmed)) {
      throw new Error('Preco com caracteres invalidos: ' + JSON.stringify(raw));
    }
    const normalized = trimmed.replace(',', '.');
    if (normalized.split('.').length > 2) {
      throw new Error('Preco com multiplos separadores decimais: ' + JSON.stringify(raw));
    }
    price = parseFloat(normalized);
  } else {
    throw new Error('Preco com tipo invalido: ' + typeof raw);
  }
  if (!Number.isFinite(price)) {
    throw new Error('Preco nao e um numero finito: ' + JSON.stringify(raw));
  }
  if (price < 0) {
    throw new Error('Preco negativo: ' + JSON.stringify(raw));
  }
  const cents = Math.round(price * 100);
  return new Prisma.Decimal(cents / 100);
}

/** Classificacao: 'COMERCIALIZADO' | 'INSUMO' | 'INCERTO' */
export function classifyProduct(
  _codigo: string,
  nome: string,
  grupo: string,
  preco: number
): 'COMERCIALIZADO' | 'INSUMO' | 'INCERTO' {
  if (preco === 0.01) return 'INSUMO';
  if (grupo === 'INSUMO') {
    if (['BALY 2L', 'PANCETA'].some(n => nome.includes(n))) return 'COMERCIALIZADO';
    return 'INSUMO';
  }
  if (grupo === 'DIVERSOS') {
    const incertos = ['CDB', 'CHICLETE', 'HALLS', 'GUARDA VOLUME', 'PALHEIRO', 'ISQUEIRO'];
    if (incertos.some(n => nome.includes(n))) return 'INCERTO';
    return 'COMERCIALIZADO';
  }
  return 'COMERCIALIZADO';
}

export interface ClassificationRecord {
  codigo: string;
  nome: string;
  grupo: string;
  preco: number;
  classificacao: 'COMERCIALIZADO' | 'INSUMO' | 'INCERTO';
}

export async function generateClassificationReport(): Promise<ClassificationRecord[]> {
  const filePath = path.join(__dirname, '../data/Exportacao-produtos.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Arquivo Excel sem abas.');
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error('Aba nao encontrada.');
  const data = xlsx.utils.sheet_to_json(ws) as Record<string, unknown>[];

  // Processar TODOS os produtos ativos (não apenas INSUMO/DIVERSOS)
  const rows = data.filter(r => r['Estado'] === 'Ativo');

  return rows.map(r => {
    const codigo = String(r['Código'] ?? '');
    const nome = String(r['Nome curto'] ?? '').trim();
    const grupo = String(r['Grupo'] ?? '').trim();
    const rawP = r['Preço venda'];
    const preco = typeof rawP === 'number' ? rawP : parseFloat(String(rawP ?? '0'));
    return { codigo, nome, grupo, preco, classificacao: classifyProduct(codigo, nome, grupo, preco) };
  });
}

export async function validateAllPrices(): Promise<void> {
  const filePath = path.join(__dirname, '../data/Exportacao-produtos.xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Arquivo Excel sem abas.');
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error('Aba nao encontrada.');
  const data = xlsx.utils.sheet_to_json(ws) as Record<string, unknown>[];

  const ativos = data.filter(r => r['Estado'] === 'Ativo');
  const errors: string[] = [];

  for (const row of ativos) {
    const rawP = row['Preço venda'];
    const codigo = String(row['Código'] ?? '?');
    try {
      parsePrice(rawP);
    } catch (e) {
      errors.push('Codigo ' + codigo + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.length + ' erro(s) de preco encontrado(s). Importacao abortada.\n' + errors.join('\n'));
  }
}
