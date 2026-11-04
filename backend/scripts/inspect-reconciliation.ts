import type { Prisma, PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as path from 'path';
import { classifyProduct, parsePrice } from './seed-real';
import { loadDatabaseProfile, type DatabaseSecrets } from '../src/config/secrets';

// Importar este módulo não lê segredos, não cria cliente e não conecta ao banco.
const DATABASE = 'cardapio_digital_dev';
const ROLE = 'cardapio_dev_app';
const FLAG = '--inspect-dev-read-only';
const messages = {
  AUTORIZACAO: 'Execução exige a opção explícita de inspeção Dev somente leitura.',
  DESTINO: 'Configuração rejeitada: destino ou role fora da lista permitida.',
  IDENTIDADE: 'Identidade da sessão Dev não confirmada. Inspeção interrompida.',
  LEITURA: 'Transação somente leitura não confirmada. Inspeção interrompida.',
  CATALOGO: 'Catálogo inválido: conferir campos, códigos únicos, estados e preços offline.',
  CONTAGEM: 'Quantitativos do catálogo diferem da referência desta entrega.',
  PRECO: 'Preço inválido ou fora do limite Decimal(10,2).',
} as const;
type ErrorCode = keyof typeof messages;
export class InspectionError extends Error {
  constructor(readonly code: ErrorCode) { super(messages[code]); }
}
export function safeDiagnostic(error: unknown, etapa: 'preparacao' | 'inspecao' = 'inspecao') {
  // Lista fechada: nunca serializar mensagem, stack, cause, meta ou objeto externo.
  const code = error instanceof InspectionError && Object.hasOwn(messages, error.code)
    ? error.code : null;
  return { etapa, codigo: code ?? 'FALHA_EXTERNA', mensagem: code ? messages[code]
    : 'Falha na inspeção; detalhes externos omitidos para proteger credenciais.' };
}
export function priceInCents(raw: unknown): number {
  try {
    const cents = parsePrice(raw).mul(100).toNumber();
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 9_999_999_999) throw new Error();
    return cents;
  } catch { throw new InspectionError('PRECO'); }
}

type Classification = ReturnType<typeof classifyProduct>;
export interface ExpectedProduct {
  codigo: string;
  nome: string;
  grupo: string;
  centavos: number;
  classificacao: Classification;
  ativo: boolean;
  // Somente um vínculo UUID previamente verificado pode preencher este campo.
  // O Excel atual não fornece UUID e o leitor nunca inventa este vínculo.
  idExistente?: string;
}
export interface Catalog {
  registros: ExpectedProduct[];
  candidatos: ExpectedProduct[];
  totais: { total: number; ativos: number; publicos: number; internos: number;
    incertosSuspensos: number; inativosExcluidos: number; candidatos: number };
}
export function catalogFromRows(rows: Record<string, unknown>[]): Catalog {
  const codes = new Set<string>();
  const registros = rows.map(row => {
    const codigo = String(row['Código'] ?? '').trim();
    const nome = String(row['Nome curto'] ?? '').trim();
    const grupo = String(row['Grupo'] ?? '').trim();
    if (!codigo || codigo.length > 64 || codes.has(codigo) || !nome || (row['Estado'] === 'Ativo' && !grupo) ||
        !['Ativo', 'Inativo'].includes(String(row['Estado']))) throw new InspectionError('CATALOGO');
    codes.add(codigo);
    const rawPrice = row['Preço venda'];
    const centavos = priceInCents(rawPrice);
    // A classificação usa o preço original; o arredondamento pertence à comparação monetária.
    const originalPrice = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice).trim().replace(',', '.'));
    const classificacao = classifyProduct(codigo, nome, grupo, originalPrice);
    return { codigo, nome, grupo, centavos, classificacao, ativo: row['Estado'] === 'Ativo' };
  });
  const ativos = registros.filter(r => r.ativo);
  const candidatos = ativos.filter(r => r.classificacao !== 'INCERTO');
  return { registros, candidatos, totais: {
    total: registros.length, ativos: ativos.length,
    publicos: ativos.filter(r => r.classificacao === 'COMERCIALIZADO').length,
    internos: ativos.filter(r => r.classificacao === 'INSUMO').length,
    incertosSuspensos: ativos.filter(r => r.classificacao === 'INCERTO').length,
    inativosExcluidos: registros.length - ativos.length, candidatos: candidatos.length,
  } };
}
export function readExcelExpectations(): Catalog {
  const workbook = xlsx.readFile(path.join(__dirname, '../data/Exportacao-produtos.xlsx'));
  const sheet = workbook.SheetNames[0];
  const ws = sheet ? workbook.Sheets[sheet] : undefined;
  if (!ws) throw new InspectionError('CATALOGO');
  return catalogFromRows(xlsx.utils.sheet_to_json<Record<string, unknown>>(ws));
}
export function assertCatalogTotals(catalog: Catalog): void {
  const reference: Catalog['totais'] = { total: 204, ativos: 174, publicos: 144, internos: 24,
    incertosSuspensos: 6, inativosExcluidos: 30, candidatos: 168 };
  if ((Object.keys(reference) as (keyof typeof reference)[])
    .some(key => catalog.totais[key] !== reference[key])) throw new InspectionError('CONTAGEM');
}

export const productSelect = {
  id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
  descriptionSource: true, categoryId: true, name: true, price: true, isActive: true,
} satisfies Prisma.ProductSelect;
export const categorySelect = { id: true, name: true, publicKey: true, isActive: true } satisfies Prisma.CategorySelect;
export type ExistingProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export type ExistingCategory = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;
type Status = 'EXISTENTE_CORRETO' | 'AUSENTE' | 'EXISTENTE_DIVERGENTE' | 'EXISTENTE_SEM_CORRESPONDENCIA';
interface ProductComparison {
  codigo: string | null;
  id: string | null;
  status: Status;
  divergencias: string[];
}
function validSourceIdentity(p: ExistingProduct): boolean {
  return (p.publicKey === null && p.sourceCode === null && p.sourceName === null && p.sourceGroup === null) ||
    (p.publicKey !== null && p.sourceCode !== null && /^\d+$/.test(p.sourceCode) &&
      !!p.sourceName?.trim() && !!p.sourceGroup?.trim() && p.publicKey === `rustika-${p.sourceCode}`);
}
function compareProduct(exp: ExpectedProduct, p: ExistingProduct, categories: ExistingCategory[]): string[] {
  const differences: string[] = [];
  const isPublic = exp.classificacao === 'COMERCIALIZADO';
  const expectedKey = isPublic ? `rustika-${exp.codigo}` : null;
  const check = (field: string, actual: unknown, expected: unknown) => {
    if (actual !== expected) differences.push(`${field}: esperado=${String(expected)}, encontrado=${String(actual)}`);
  };
  if (exp.idExistente) check('id', p.id, exp.idExistente);
  check('sourceCode', p.sourceCode, isPublic ? exp.codigo : null);
  check('name', p.name, exp.nome);
  check('sourceName', p.sourceName, isPublic ? exp.nome : null);
  check('sourceGroup', p.sourceGroup, isPublic ? exp.grupo : null);
  check('publicKey', p.publicKey, expectedKey);
  check('isActive', p.isActive, true);
  if (!validSourceIdentity(p)) differences.push('constraint products_source_identity_consistent incompatível');
  if (p.publicKey !== null && (p.publicKey.length > 80 || !/^rustika-\d+$/.test(p.publicKey))) {
    differences.push('publicKey fora do formato/limite do schema');
  }
  const category = categories.find(c => c.id === p.categoryId);
  const expectedCategories = categories.filter(c => c.name === exp.grupo);
  if (expectedCategories.length !== 1) differences.push('categoria esperada ausente ou ambígua');
  else check('categoryId', p.categoryId, expectedCategories[0]!.id);
  if (!category) differences.push('relacionamento categoryId sem categoria');
  else {
    check('category.name', category.name, exp.grupo);
    check('category.isActive', category.isActive, true);
    if (isPublic && (category.publicKey === null || category.publicKey.length > 64 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(category.publicKey))) differences.push('categoria pública sem chave válida');
  }
  try { check('priceCentavos', priceInCents(p.price.toString()), exp.centavos); }
  catch { differences.push('price inválido'); }
  return differences;
}

export function reconcileWithBank(catalog: Catalog, products: ExistingProduct[], categories: ExistingCategory[]) {
  const expected = catalog.candidatos;
  const detalhes: ProductComparison[] = [];
  const ambiguidades: { codigos: string[]; ids: string[]; motivo: string }[] = [];
  const pendentes = new Set<string>();
  const used = new Set<string>();
  // União das identidades estáveis: conflitos nunca são resolvidos por prioridade arbitrária.
  const links = expected.map(exp => products.filter(p => p.sourceCode === exp.codigo ||
    p.publicKey === `rustika-${exp.codigo}` || (exp.idExistente !== undefined && p.id === exp.idExistente)));
  for (const [i, exp] of expected.entries()) {
    const matches = links[i]!;
    const p = matches[0];
    const conflict = p && ((p.sourceCode !== null && p.sourceCode !== exp.codigo) ||
      (p.publicKey !== null && /^rustika-\d+$/.test(p.publicKey) && p.publicKey !== `rustika-${exp.codigo}`) ||
      (exp.idExistente !== undefined && p.id !== exp.idExistente));
    if (matches.length > 1 || (p && links.filter(list => list.some(r => r.id === p.id)).length > 1) || conflict) {
      pendentes.add(exp.codigo);
      ambiguidades.push({ codigos: [exp.codigo], ids: matches.map(r => r.id), motivo: 'Identificadores estáveis conflitantes ou duplicados.' });
    } else if (p) {
      used.add(p.id);
      const divergencias = compareProduct(exp, p, categories);
      detalhes.push({ codigo: exp.codigo, id: p.id,
        status: divergencias.length ? 'EXISTENTE_DIVERGENTE' : 'EXISTENTE_CORRETO', divergencias });
    } else {
      // Nome é apenas indício de ambiguidade, nunca identidade definitiva.
      const hints = products.filter(r => r.sourceCode === null &&
        r.name.trim().toLocaleUpperCase('pt-BR') === exp.nome.toLocaleUpperCase('pt-BR'));
      if (hints.length) {
        pendentes.add(exp.codigo);
        ambiguidades.push({ codigos: [exp.codigo], ids: hints.map(r => r.id), motivo: 'Nome semelhante sem vínculo estável; correspondência não confirmada.' });
      } else detalhes.push({ codigo: exp.codigo, id: null, status: 'AUSENTE', divergencias: [] });
    }
  }
  const extras = products.filter(p => !used.has(p.id));
  for (const p of extras) {
    const issues = validSourceIdentity(p) ? [] : ['constraint products_source_identity_consistent incompatível'];
    const excluded = catalog.registros.find(e => !catalog.candidatos.includes(e) &&
      (e.codigo === p.sourceCode || `rustika-${e.codigo}` === p.publicKey));
    if (excluded) issues.push(excluded.ativo ? 'Identidade de incerto suspenso; fora dos candidatos.' : 'Identidade de inativo excluído; fora dos candidatos.');
    if (p.sourceCode === null && !ambiguidades.some(a => a.ids.includes(p.id))) {
      ambiguidades.push({ codigos: [], ids: [p.id], motivo: 'Sem código e sem vínculo confiável; UUID preservado para decisão manual.' });
    }
    detalhes.push({ codigo: p.sourceCode, id: p.id, status: 'EXISTENTE_SEM_CORRESPONDENCIA', divergencias: issues });
  }
  const count = (status: Status) => detalhes.filter(r => r.status === status).length;
  return {
    catalogoEsperado: catalog.totais,
    incompatibilidadesCatalogo: expected.filter(e => e.classificacao === 'COMERCIALIZADO' && !/^\d+$/.test(e.codigo))
      .map(e => ({ codigo: e.codigo, nome: e.nome,
        motivo: 'Produto público com código não numérico: chave esperada incompatível com products_source_identity_consistent. Não alterar identidade automaticamente.' })),
    bancoExistente: { produtos: products.length, categorias: categories.length,
      publicos: products.filter(p => p.publicKey !== null).length,
      internos: products.filter(p => p.publicKey === null).length,
      semSourceCode: products.filter(p => p.sourceCode === null).length, semCorrespondencia: extras.length },
    criterioPublico: 'Contagem estrutural por publicKey não nula; não equivale à visibilidade na API.',
    reconciliacao: {
      EXISTENTE_CORRETO: count('EXISTENTE_CORRETO'), AUSENTE: count('AUSENTE'),
      EXISTENTE_DIVERGENTE: count('EXISTENTE_DIVERGENTE'), EXISTENTE_SEM_CORRESPONDENCIA: extras.length,
      candidatosPendentesPorAmbiguidade: pendentes.size, candidatosEsperados: expected.length,
      existentesCorrespondentes: used.size, extrasExistentes: extras.length,
    },
    ambiguidades, candidatosPendentes: [...pendentes], detalhes,
    inventario: { categorias: categories, produtos: products.map(p => ({ ...p, price: p.price.toString() })) },
    rastreabilidade: 'sourceCode/sourceName/sourceGroup comparados conforme constraint; descriptionSource preservado no inventário, sem valor esperado no Excel.',
    propostasAutomaticas: false,
    restricao: 'Nenhuma alteração de identidade ou recuperação autorizada; ambiguidades exigem decisão manual.',
  };
}

export function assertDevTarget(database: Pick<DatabaseSecrets, 'profile' | 'purpose' | 'database' | 'user' | 'databaseUrl' | 'shadowDatabaseUrl'>): string {
  try {
    const url = new URL(database.databaseUrl);
    if (database.profile !== 'app-dev' || database.purpose !== 'runtime' || database.database !== DATABASE ||
      database.user !== ROLE || database.shadowDatabaseUrl !== undefined ||
      url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432' ||
      decodeURIComponent(url.pathname) !== `/${DATABASE}` || decodeURIComponent(url.username) !== ROLE ||
      !url.password || url.hash) throw new Error();
    // Não permitir options/host/role ou outro redirecionamento vindo da URL.
    for (const [key, value] of url.searchParams) {
      if (key === 'schema' ? value !== 'public' : key === 'sslmode' ? value !== 'disable' :
        !['connection_limit', 'connect_timeout', 'pool_timeout'].includes(key) || !/^\d+$/.test(value)) throw new Error();
    }
    const sslDisabled = url.searchParams.has('sslmode'); // Todos os valores já foram validados.
    url.search = '';
    if (sslDisabled) url.searchParams.set('sslmode', 'disable');
    url.searchParams.set('schema', 'public');
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('connect_timeout', '5');
    return url.toString();
  } catch { throw new InspectionError('DESTINO'); }
}
export function assertSessionIdentity(rows: unknown): { banco: string; role: string; sessionRole: string; somenteLeitura: true } {
  if (!Array.isArray(rows) || rows.length !== 1) throw new InspectionError('IDENTIDADE');
  const row = rows[0] as Record<string, unknown> | null;
  if (!row || row.db !== DATABASE || row.usr !== ROLE || row.session_usr !== ROLE) throw new InspectionError('IDENTIDADE');
  if (row.read_only !== 'on') throw new InspectionError('LEITURA');
  return { banco: DATABASE, role: ROLE, sessionRole: ROLE, somenteLeitura: true };
}
export interface InspectionDependencies {
  environment: { NODE_ENV?: string; DB_PROFILE?: string };
  loadProfile: () => DatabaseSecrets;
  createClient: (url: string) => Promise<PrismaClient>;
  readCatalog: () => Catalog;
}
const defaultDependencies: InspectionDependencies = {
  environment: process.env,
  loadProfile: () => loadDatabaseProfile('app-dev', { purpose: 'runtime' }),
  createClient: async url => {
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient({ datasources: { db: { url } }, log: [] });
  },
  readCatalog: readExcelExpectations,
};
export async function runInspection(args: string[], deps: InspectionDependencies = defaultDependencies) {
  if (args.length !== 1 || args[0] !== FLAG) throw new InspectionError('AUTORIZACAO');
  if (deps.environment.NODE_ENV === 'test' ||
    (deps.environment.DB_PROFILE !== undefined && deps.environment.DB_PROFILE !== 'app-dev')) throw new InspectionError('DESTINO');
  const catalog = deps.readCatalog();
  assertCatalogTotals(catalog);
  const url = assertDevTarget(deps.loadProfile());
  const prisma = await deps.createClient(url);
  try {
    return await prisma.$transaction(async tx => {
      // Controle da transação, sem DML/DDL. Deve preceder toda consulta de dados.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await tx.$queryRaw`SELECT current_database() AS db, current_user AS usr,
        session_user AS session_usr, current_setting('transaction_read_only') AS read_only`;
      const identidade = assertSessionIdentity(rows);
      const constraints = await tx.$queryRaw`SELECT c.conname AS nome, pg_get_constraintdef(c.oid) AS definicao,
        c.convalidated AS validada, t.relname AS tabela
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname IN ('products', 'categories') ORDER BY t.relname, c.conname`;
      const indices = await tx.$queryRaw`SELECT tablename AS tabela, indexname AS nome, indexdef AS definicao
        FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('products', 'categories') ORDER BY tablename, indexname`;
      const categories = await tx.category.findMany({ select: categorySelect, orderBy: { id: 'asc' } });
      const products = await tx.product.findMany({ select: productSelect, orderBy: { id: 'asc' } });
      return { origem: 'PostgreSQL Dev real', identidade, constraints, indices,
        ...reconcileWithBank(catalog, products, categories) };
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 30000 });
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  runInspection(process.argv.slice(2)).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(JSON.stringify(safeDiagnostic(error)));
    process.exitCode = 1;
  });
}
