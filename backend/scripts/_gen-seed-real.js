'use strict';
// Arquivo gerado pelo editor — UTF-8, sem acentuação nas strings literais.
// Execute: node scripts/_gen-seed-real.js
const fs   = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// Chaves reais do Excel (caracteres Unicode gravados em UTF-8 pelo editor)
const KEY_CODIGO = 'C\u00f3digo';
const KEY_PRECO  = 'Pre\u00e7o venda';

// ─── seed-real.ts ────────────────────────────────────────────────────────────
const SEED_REAL = `import { Prisma } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as path from 'path';

function parsePrice(raw: any): Prisma.Decimal {
  if (raw === null || raw === undefined || raw === '') throw new Error('Preco vazio ou nulo.');
  let price: number;
  if (typeof raw === 'number') {
    price = raw;
  } else if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '') throw new Error('Preco vazio.');
    if (!/^[\\d,.]+$/.test(t)) throw new Error('Preco com caracteres invalidos: ' + JSON.stringify(raw));
    const n = t.replace(',', '.');
    if (n.split('.').length > 2) throw new Error('Preco com multiplos separadores decimais: ' + JSON.stringify(raw));
    price = parseFloat(n);
  } else {
    throw new Error('Preco com tipo invalido: ' + typeof raw);
  }
  if (!Number.isFinite(price)) throw new Error('Preco nao e um numero finito: ' + JSON.stringify(raw));
  if (price < 0) throw new Error('Preco negativo: ' + JSON.stringify(raw));
  return new Prisma.Decimal(Math.round(price * 100) / 100);
}

function classifyProduct(_c: string, nome: string, grupo: string, preco: number): 'COMERCIALIZADO' | 'INSUMO' | 'INCERTO' {
  if (preco === 0.01) return 'INSUMO';
  if (grupo === 'INSUMO') {
    if (['BALY 2L', 'PANCETA'].some(n => nome.includes(n))) return 'COMERCIALIZADO';
    return 'INSUMO';
  }
  if (grupo === 'DIVERSOS') {
    if (['CDB', 'CHICLETE', 'HALLS', 'GUARDA VOLUME', 'PALHEIRO', 'ISQUEIRO'].some(n => nome.includes(n))) return 'INCERTO';
    return 'COMERCIALIZADO';
  }
  return 'COMERCIALIZADO';
}

export interface ClassificationRecord {
  codigo: string; nome: string; grupo: string; preco: number;
  classificacao: 'COMERCIALIZADO' | 'INSUMO' | 'INCERTO';
}

function openSheet(filePath: string) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Arquivo Excel sem abas.');
  const ws = workbook.Sheets[sheetName];
  if (!ws) throw new Error('Aba nao encontrada.');
  return xlsx.utils.sheet_to_json(ws) as Record<string, unknown>[];
}

export async function generateClassificationReport(): Promise<ClassificationRecord[]> {
  const data = openSheet(path.join(__dirname, '../data/Exportacao-produtos.xlsx'));
  const rows = data.filter(r => (r['Grupo'] === 'INSUMO' || r['Grupo'] === 'DIVERSOS ') && r['Estado'] === 'Ativo');
  return rows.map(r => {
    const codigo = String(r['${KEY_CODIGO}'] ?? '');
    const nome   = String(r['Nome curto'] ?? '').trim();
    const grupo  = String(r['Grupo'] ?? '').trim();
    const rawP   = r['${KEY_PRECO}'];
    const preco  = typeof rawP === 'number' ? rawP : parseFloat(String(rawP ?? '0'));
    return { codigo, nome, grupo, preco, classificacao: classifyProduct(codigo, nome, grupo, preco) };
  });
}

export async function validateAllPrices(): Promise<void> {
  const data = openSheet(path.join(__dirname, '../data/Exportacao-produtos.xlsx'));
  const ativos = data.filter(r => r['Estado'] === 'Ativo');
  const errors: string[] = [];
  for (const row of ativos) {
    const rawP   = row['${KEY_PRECO}'];
    const codigo = String(row['${KEY_CODIGO}'] ?? '?');
    try { parsePrice(rawP); }
    catch (e) { errors.push('Codigo ' + codigo + ': ' + (e instanceof Error ? e.message : String(e))); }
  }
  if (errors.length > 0) throw new Error(errors.length + ' erro(s) de preco. Importacao abortada.');
}

export { parsePrice, classifyProduct };
`;

fs.writeFileSync(path.join(root, 'scripts', 'seed-real.ts'), SEED_REAL, { encoding: 'utf8' });
const v = fs.readFileSync(path.join(root, 'scripts', 'seed-real.ts'), 'utf8');
const bad = [...Buffer.from(v, 'utf8')].filter(b => b > 0x7E && b < 0xC0);
console.log('seed-real.ts  bytes=' + Buffer.byteLength(v, 'utf8') + '  bad_bytes=' + bad.length);
console.log('Has KEY_CODIGO:', v.includes(KEY_CODIGO), '| Has KEY_PRECO:', v.includes(KEY_PRECO));
