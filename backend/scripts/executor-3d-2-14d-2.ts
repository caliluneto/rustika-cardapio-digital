import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { readExcelExpectations } from './inspect-reconciliation';

const basePath = path.join(__dirname, '../../');
function read(file: string) {
  let c = fs.readFileSync(path.join(basePath, file), 'utf8');
  if (c.charCodeAt(0) === 0xFEFF || c.includes('\0')) c = fs.readFileSync(path.join(basePath, file), 'utf16le');
  return JSON.parse(c.replace(/^\uFEFF/, ''));
}

async function run() {
  const v = read('validacao-vinculos.json');
  const m = read('mapeamento.json');
  const c = readExcelExpectations();
  const prisma = new PrismaClient({ log: ['error', 'warn'] });

  try {
    console.log('Iniciando pre-flight checks...');
    const [dbInfo]: any = await prisma.$queryRaw`SELECT current_database() AS db, current_user AS usr`;
    console.log(`Banco/Role: ${dbInfo.db} / ${dbInfo.usr}`);
    if (dbInfo.db !== 'cardapio_digital_dev' || dbInfo.usr !== 'cardapio_migrator') throw new Error(`Pré-voo: Banco/role incorretos.`);

    const mgCheck: any = await prisma.$queryRaw`SELECT * FROM _prisma_migrations WHERE migration_name LIKE '%update_products_source_identity_constraint%'`;
    if (!mgCheck || mgCheck.length === 0) throw new Error(`Pré-voo: Migration não aplicada.`);

    const preCount = await prisma.product.count();
    if (preCount !== 27) throw new Error(`Pré-voo: Produtos difere de 27 (${preCount}).`);

    const p = m.filter((x: any) => x.grauConfianca === 'CORRETO').map((x: any) => x.idPersistido);
    const aV = v.resultados.filter((r: any) => !p.includes(r.idPersistido));
    const pC = [...m.filter((x:any)=>x.grauConfianca==='CORRETO').map((x:any)=>x.codigoOriginalEsperado), ...aV.map((x:any)=>x.codigoOriginalEsperado)];
    const aI = c.candidatos.filter(x => !pC.includes(x.codigo));
    const cats = Array.from(new Set(c.candidatos.map(x => x.grupo)));

    console.log(`Pre-flight ok. Preparando ${aV.length} updates e ${aI.length} inserts.`);
    await prisma.$transaction(async (tx) => {
      console.log('Iniciando Transaction...');
      for (const cg of cats) await tx.category.upsert({ where: { name: cg as string }, update: {}, create: { name: cg as string } });
      const cM = new Map();
      (await tx.category.findMany()).forEach(cg => cM.set(cg.name, cg.id));

      let [u, i] = [0, 0];
      for (const r of aV) {
        const cd = c.candidatos.find(x => x.codigo === r.codigoOriginalEsperado);
        if (!cd) throw new Error(`Candidato ${r.codigoOriginalEsperado} não achado`);
        const pub = cd.classificacao === 'COMERCIALIZADO';
        await tx.product.update({
          where: { id: r.idPersistido },
          data: {
            name: cd.nome,
            sourceCode: pub ? String(r.codigoOriginalEsperado) : null,
            publicKey: pub ? `rustika-${r.codigoOriginalEsperado}` : null,
            sourceName: pub ? cd.nome : null,
            sourceGroup: pub ? cd.grupo : null,
            categoryId: cM.get(cd.grupo),
            availabilityState: pub ? 'AVAILABLE' : 'UNKNOWN'
          }
        });
        u++;
      }
      for (const cd of aI) {
        const pub = cd.classificacao === 'COMERCIALIZADO';
        await tx.product.create({
          data: {
            name: cd.nome,
            description: '',
            price: cd.centavos / 100,
            isActive: cd.ativo,
            categoryId: cM.get(cd.grupo),
            sourceCode: pub ? String(cd.codigo) : null,
            publicKey: pub ? `rustika-${cd.codigo}` : null,
            sourceName: pub ? cd.nome : null,
            sourceGroup: pub ? cd.grupo : null,
            availabilityState: pub ? (cd.ativo ? 'AVAILABLE' : 'UNAVAILABLE') : 'UNKNOWN'
          }
        });
        i++;
      }
      console.log(`Transação concluiu DML: ${u} ups, ${i} ins. Validando constraint atômica...`);

      const fC = await tx.product.count();
      if (fC !== 168) throw new Error(`Total falhou: ${fC}`);

      const pc = await tx.product.count({ where: { publicKey: { not: null } } });
      if (pc !== 144) throw new Error(`Públicos falhou: ${pc}!=144`);

      const ic = await tx.product.count({ where: { publicKey: null } });
      if (ic !== 24) throw new Error(`Internos falhou: ${ic}!=24`);

      const cc = await tx.category.count();
      if (cc !== 12) throw new Error(`Categorias falhou: ${cc}!=12`);

      const pa = await tx.product.findFirst({ where: { sourceCode: 'PA062240' } });
      if (!pa || pa.publicKey !== 'rustika-PA062240') throw new Error(`PA062240 falhou: ${pa?.publicKey}`);
      console.log('Committing transaction...');
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 60000 });

    const fT = await prisma.product.count();
    console.log(`Sucesso final. Produtos no banco: ${fT}`);
  } catch (e) { console.error('Erro geral:', e); process.exit(1); } finally { await prisma.$disconnect(); }
}
run();
