/**
 * 3D.3.29-FIX02: contrato do snapshot de estado do E2E (produzido por `inspect-e2e-state.ts --out`).
 *
 * Funções puras: nenhuma E/S, nenhuma conexão. Qualquer desvio do contrato é um erro explícito
 * (`E2eStateError`); nunca vira "resíduo zero". Tabela AUSENTE (migrations não aplicadas, consulta que não rodou)
 * é distinta de tabela VAZIA.
 */

/** Tabelas de dados que devem existir e estar vazias depois do E2E. */
export const DATA_TABLES = [
  'orders', 'order_items', 'order_status_history', 'comandas', 'comanda_invitations', 'comanda_sessions',
  'admins', 'categories', 'products',
] as const;

/** Seções obrigatórias do JSON, todas arrays de linhas. */
export const REQUIRED_SECTIONS = [
  'identity', 'migrations', 'rows', 'legacy_e2e_residue', 'fixture_residue', 'other_sessions', 'locks',
] as const;

export const EXPECTED_DATABASE = 'cardapio_digital_test';

export class E2eStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'E2eStateError';
  }
}

export interface E2eState {
  identity: { database: string; user: string; version: string; read_only: string }[];
  migrations: { name: string; finished: boolean; rolled_back: boolean }[];
  rows: { tabela: string; linhas: number }[];
  legacy_e2e_residue: Record<string, number>[];
  fixture_residue: Record<string, number>[];
  other_sessions: Record<string, unknown>[];
  locks: Record<string, number>[];
}

export interface ResidueReport {
  /** Tabelas esperadas que não existem no banco (distinto de vazia). */
  missingTables: string[];
  /** Tabelas esperadas com linhas remanescentes. */
  residualTables: { table: string; rows: number }[];
  /** Resíduo identificado por chave (fixtures legados/atuais). */
  residualMarkers: { section: string; field: string; count: number }[];
  /** Transações preparadas ou outros sinais de estado pendurado. */
  pendingTransactions: number;
  ok: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Interpreta o texto do arquivo. Exige JSON único e completo; nunca procura "a primeira chave" no texto. */
export function parseE2eState(text: string): E2eState {
  if (text.trim() === '') throw new E2eStateError('Arquivo de estado vazio.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new E2eStateError('Arquivo de estado não é JSON válido (esperado somente JSON, sem logs misturados).');
  }
  if (!isRecord(raw)) throw new E2eStateError('Estado inválido: a raiz deve ser um objeto.');
  for (const section of REQUIRED_SECTIONS) {
    if (!(section in raw)) throw new E2eStateError(`Estado inválido: seção obrigatória ausente (${section}).`);
    if (!Array.isArray(raw[section])) throw new E2eStateError(`Estado inválido: a seção ${section} deve ser uma lista.`);
  }
  const state = raw as unknown as E2eState;

  const identity = state.identity;
  if (identity.length !== 1 || !isRecord(identity[0])) throw new E2eStateError('Estado inválido: identity deve ter exatamente uma linha.');
  if (identity[0].database !== EXPECTED_DATABASE) throw new E2eStateError(`Estado inválido: o banco inspecionado não é ${EXPECTED_DATABASE}.`);
  if (identity[0].read_only !== 'on') throw new E2eStateError('Estado inválido: a inspeção não rodou em transação somente leitura.');

  if (state.migrations.length === 0) throw new E2eStateError('Estado inválido: nenhuma migration registrada (banco sem migrations).');
  for (const m of state.migrations) {
    if (!isRecord(m) || typeof m.name !== 'string' || m.finished !== true || m.rolled_back !== false) {
      throw new E2eStateError('Estado inválido: há migration não finalizada ou revertida.');
    }
  }

  const seen = new Set<string>();
  for (const row of state.rows) {
    if (!isRecord(row) || typeof row.tabela !== 'string') throw new E2eStateError('Estado inválido: linha de contagem sem nome de tabela.');
    if (!isCount(row.linhas)) throw new E2eStateError(`Estado inválido: contagem inválida para a tabela ${row.tabela}.`);
    if (seen.has(row.tabela)) throw new E2eStateError(`Estado inválido: tabela duplicada (${row.tabela}).`);
    seen.add(row.tabela);
  }

  for (const section of ['legacy_e2e_residue', 'fixture_residue', 'locks'] as const) {
    const list = state[section];
    if (list.length !== 1 || !isRecord(list[0])) throw new E2eStateError(`Estado inválido: ${section} deve ter exatamente uma linha.`);
    const entries = Object.entries(list[0]);
    if (entries.length === 0) throw new E2eStateError(`Estado inválido: ${section} sem campos.`);
    for (const [field, value] of entries) {
      if (!isCount(value)) throw new E2eStateError(`Estado inválido: ${section}.${field} não é uma contagem válida.`);
    }
  }
  return state;
}

/** Calcula o resíduo a partir de um estado já validado. */
export function analyzeResidue(state: E2eState): ResidueReport {
  const counts = new Map(state.rows.map((r) => [r.tabela, r.linhas]));
  const missingTables = DATA_TABLES.filter((t) => !counts.has(t));
  const residualTables = DATA_TABLES.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => ({ table: t, rows: counts.get(t)! }));
  const residualMarkers: ResidueReport['residualMarkers'] = [];
  for (const section of ['legacy_e2e_residue', 'fixture_residue'] as const) {
    for (const [field, count] of Object.entries(state[section][0]!)) {
      if (count > 0) residualMarkers.push({ section, field, count });
    }
  }
  const pendingTransactions = state.locks[0]!.prepared ?? 0;
  return {
    missingTables, residualTables, residualMarkers, pendingTransactions,
    ok: missingTables.length === 0 && residualTables.length === 0 && residualMarkers.length === 0 && pendingTransactions === 0,
  };
}

/** Texto do arquivo -> relatório; lança se o contrato for violado. Quem chama decide o código de saída. */
export function verifyZeroResidue(text: string): ResidueReport {
  return analyzeResidue(parseE2eState(text));
}

/** Mensagem de falha legível (sem dados sensíveis: só nomes de tabela e contagens). */
export function describeFailure(report: ResidueReport): string {
  const parts: string[] = [];
  if (report.missingTables.length) parts.push(`tabelas ausentes: ${report.missingTables.join(', ')}`);
  if (report.residualTables.length) parts.push(`resíduo em tabelas: ${report.residualTables.map((r) => `${r.table}=${r.rows}`).join(', ')}`);
  if (report.residualMarkers.length) parts.push(`resíduo por chave: ${report.residualMarkers.map((r) => `${r.section}.${r.field}=${r.count}`).join(', ')}`);
  if (report.pendingTransactions) parts.push(`transações preparadas pendentes: ${report.pendingTransactions}`);
  return parts.join('; ');
}
