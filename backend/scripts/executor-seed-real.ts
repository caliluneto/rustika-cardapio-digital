import { Prisma, PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import * as path from 'path';
import { parsePrice, classifyProduct, validateAllPrices } from './seed-real';
import { createPrismaRuntime } from '../src/lib/prisma';

export interface ExecutionPlan {
  publicos: number;
  internos: number;
  incertos: number;
  inativos: number;
  total: number;
}

export interface ReconciliationRecord {
  codigo: string;
  nome: string;
  grupo: string;
  preco: number;
  classificacao: "COMERCIALIZADO" | "INSUMO" | "INCERTO";
  status: "EXISTENTE_CORRETO" | "AUSENTE" | "EXISTENTE_DIVERGENTE" | "EXISTENTE_SEM_CORRESPONDENCIA";
  existente?: { id: string; publicKey: string | null; sourceCode: string | null; sourceName: string | null; sourceGroup: string | null; categoryId: string; price: Prisma.Decimal };
  divergencias?: string[];
}

export interface ExecutionResult {
  plan: ExecutionPlan;
  reconciliation: { corretos: number; ausentes: number; divergentes: number; semCorrespondencia: number; total: number; detalhes: ReconciliationRecord[] };
  created: number;
  skipped: number;
  errors: string[];
  dryRun: boolean;
}

async function reconcileWithExisting(prisma: PrismaClient, expected: Array<{ codigo: string; nome: string; grupo: string; preco: number; classificacao: string }>): Promise<ReconciliationRecord[]> {
  const reconciliation: ReconciliationRecord[] = [];
  const existentes = await prisma.product.findMany({
    where: { sourceCode: { not: null } },
    select: { id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true, categoryId: true, price: true },
  });
  const existentesMap = new Map<string, (typeof existentes)[number]>();
  for (const produto of existentes) {
    if (produto.sourceCode !== null) existentesMap.set(produto.sourceCode, produto);
  }

  for (const exp of expected) {
    const pubKey = exp.classificacao === "COMERCIALIZADO" ? "rustika-" + exp.codigo : undefined;
    const exist = existentesMap.get(exp.codigo);

    if (!exist) {
      reconciliation.push({ codigo: exp.codigo, nome: exp.nome, grupo: exp.grupo, preco: exp.preco, classificacao: exp.classificacao as any, status: "AUSENTE" });
    } else {
      const divergencias: string[] = [];
      if (exp.classificacao === "COMERCIALIZADO" && exist.publicKey !== pubKey) divergencias.push(`publicKey: ${pubKey} vs ${exist.publicKey}`);
      if (exp.nome !== exist.sourceName) divergencias.push(`nome: ${exp.nome} vs ${exist.sourceName}`);
      if (exp.grupo !== exist.sourceGroup) divergencias.push(`grupo: ${exp.grupo} vs ${exist.sourceGroup}`);
      if (Math.abs(exp.preco - exist.price.toNumber()) > 0.01) divergencias.push(`preco: ${exp.preco} vs ${exist.price}`);

      reconciliation.push({
        codigo: exp.codigo,
        nome: exp.nome,
        grupo: exp.grupo,
        preco: exp.preco,
        classificacao: exp.classificacao as any,
        status: divergencias.length === 0 ? "EXISTENTE_CORRETO" : "EXISTENTE_DIVERGENTE",
        existente: exist,
        divergencias: divergencias.length > 0 ? divergencias : undefined,
      });
    }
  }

  for (const [codigo, prod] of existentesMap) {
    if (!expected.find(e => e.codigo === codigo)) {
      reconciliation.push({
        codigo,
        nome: prod.sourceName || "N/A",
        grupo: prod.sourceGroup || "N/A",
        preco: prod.price.toNumber(),
        classificacao: "INSUMO",
        status: "EXISTENTE_SEM_CORRESPONDENCIA",
        existente: prod,
      });
    }
  }

  return reconciliation;
}

export async function executeSeedReal(prisma: PrismaClient, options: { dryRun?: boolean; requireConfirm?: boolean } = {}): Promise<ExecutionResult> {
  const dryRun = options.dryRun !== false;
  const requireConfirm = options.requireConfirm !== false;

  const result: ExecutionResult = {
    plan: { publicos: 0, internos: 0, incertos: 0, inativos: 0, total: 0 },
    reconciliation: { corretos: 0, ausentes: 0, divergentes: 0, semCorrespondencia: 0, total: 0, detalhes: [] },
    created: 0,
    skipped: 0,
    errors: [],
    dryRun,
  };

  try {
    if (!dryRun) {
      const dbCheck = await prisma.$queryRaw<{ db: string; usr: string }[]>`SELECT current_database() as db, current_user as usr`;
      if (!dbCheck || dbCheck.length === 0) throw new Error("Falha ao verificar banco.");
      const { db, usr } = dbCheck[0]!;
      if (db !== "cardapio_digital_dev") throw new Error("Banco incorreto: " + db);
      if (usr !== "cardapio_migrator") throw new Error("Role incorreto: " + usr + ". Esperado: cardapio_migrator");
    }

    await validateAllPrices();

    const filePath = path.join(__dirname, "../data/Exportacao-produtos.xlsx");
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Arquivo sem abas.");
    const ws = workbook.Sheets[sheetName];
    if (!ws) throw new Error("Aba nao encontrada.");
    const data = xlsx.utils.sheet_to_json(ws) as Record<string, unknown>[];

    const ativos = data.filter(r => r["Estado"] === "Ativo");
    const inativos = data.filter(r => r["Estado"] !== "Ativo");
    result.plan.inativos = inativos.length;
    result.plan.total = data.length;

    const allAtivos = ativos.map(r => ({
      codigo: String(r["C�digo"] ?? ""),
      nome: String(r["Nome curto"] ?? "").trim(),
      grupo: String(r["Grupo"] ?? "").trim(),
      preco: typeof r["Pre�o venda"] === "number" ? r["Pre�o venda"] : parseFloat(String(r["Pre�o venda"] ?? "0")),
      classificacao: classifyProduct(String(r["C�digo"] ?? ""), String(r["Nome curto"] ?? "").trim(), String(r["Grupo"] ?? "").trim(), typeof r["Pre�o venda"] === "number" ? r["Pre�o venda"] : parseFloat(String(r["Pre�o venda"] ?? "0"))),
    }));

    result.plan.publicos = allAtivos.filter(c => c.classificacao === "COMERCIALIZADO").length;
    result.plan.internos = allAtivos.filter(c => c.classificacao === "INSUMO").length;
    result.plan.incertos = allAtivos.filter(c => c.classificacao === "INCERTO").length;

    console.log("\n=== PLANO ===");
    console.log("Publicos: " + result.plan.publicos);
    console.log("Internos: " + result.plan.internos);
    console.log("Incertos: " + result.plan.incertos);
    console.log("Inativos: " + result.plan.inativos);
    console.log("Total: " + result.plan.total);
    console.log("Modo: " + (dryRun ? "DRY-RUN" : "EXEC"));

    if (dryRun) {
      console.log("\n=== RECONCILIACAO ===");
      const reconc = await reconcileWithExisting(prisma, allAtivos);
      result.reconciliation.total = reconc.length;
      result.reconciliation.corretos = reconc.filter(r => r.status === "EXISTENTE_CORRETO").length;
      result.reconciliation.ausentes = reconc.filter(r => r.status === "AUSENTE").length;
      result.reconciliation.divergentes = reconc.filter(r => r.status === "EXISTENTE_DIVERGENTE").length;
      result.reconciliation.semCorrespondencia = reconc.filter(r => r.status === "EXISTENTE_SEM_CORRESPONDENCIA").length;
      result.reconciliation.detalhes = reconc;

      console.log("Corretos: " + result.reconciliation.corretos);
      console.log("Ausentes: " + result.reconciliation.ausentes);
      console.log("Divergentes: " + result.reconciliation.divergentes);
      console.log("Sem corresp: " + result.reconciliation.semCorrespondencia);

      console.log("\nDry-run concluido. Use --execute para execu��o real.");
      return result;
    }

    console.log("\nValidacao concluida.");
    return result;
  } catch (error) {
    result.errors.push("Erro: " + (error instanceof Error ? error.message : String(error)));
    throw error;
  }
}

if (require.main === module) {
  (async () => {
    try {
      const dryRun = process.argv.includes("--execute") === false;
      const { prisma, databaseInfo } = createPrismaRuntime();
      console.log("\n=== BANCO ===");
      console.log(databaseInfo);
      const result = await executeSeedReal(prisma, { dryRun, requireConfirm: dryRun });
      console.log("\n=== RESULTADO ===");
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error("Erro:", error);
      process.exit(1);
    }
  })();
}
