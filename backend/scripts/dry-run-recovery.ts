import * as fs from 'fs';
import * as path from 'path';
import { readExcelExpectations, type ExpectedProduct } from './inspect-reconciliation';

export async function executeDryRun() {
  const basePath = path.join(__dirname, '../../');
  
  function readFileFallback(filename: string) {
    let fileContent = '';
    try {
        fileContent = fs.readFileSync(path.join(basePath, filename), 'utf8');
        if (fileContent.charCodeAt(0) === 0xFEFF || fileContent.charCodeAt(0) === 0xFFFE || fileContent.includes('\0')) {
            fileContent = fs.readFileSync(path.join(basePath, filename), 'utf16le');
        }
    } catch (e) {
        fileContent = fs.readFileSync(path.join(basePath, filename), 'utf16le');
    }
    return fileContent.replace(/^\uFEFF/, '');
  }

  const validacaoData = JSON.parse(readFileFallback('validacao-vinculos.json'));
  const mapeamentoData = JSON.parse(readFileFallback('mapeamento.json'));
  const catalog = readExcelExpectations();

  console.log(`\n=== DRY RUN OFFLINE - RECUPERAÇÃO DO CATÁLOGO ===`);
  
  const preservar = mapeamentoData.filter((m: any) => m.grauConfianca === 'CORRETO');
  const preservarIds = preservar.map((p: any) => p.idPersistido);
  console.log(`\n--- 1. REGISTROS A PRESERVAR (${preservar.length}) ---`);
  preservar.forEach((p: any) => {
    console.log(`- ID: ${p.idPersistido} | Código: ${p.codigoOriginalEsperado} | Nome: ${p.nomePersistido}`);
  });

  const aVincular = validacaoData.resultados.filter((r: any) => !preservarIds.includes(r.idPersistido));
  console.log(`\n--- 2. REGISTROS A VINCULAR / ATUALIZAR (${aVincular.length}) ---`);
  
  let pa062240Tratado = false;

  aVincular.forEach((r: any) => {
    const candidato = catalog.candidatos.find(c => c.codigo === r.codigoOriginalEsperado);
    const mapInfo = mapeamentoData.find((m: any) => m.idPersistido === r.idPersistido);
    const correcaoEncoding = r.nomePersistido !== candidato?.nome;
    const isPA062240 = r.codigoOriginalEsperado === 'PA062240';
    if (isPA062240) pa062240Tratado = true;

    console.log(`\n  * ID Persistido: ${r.idPersistido}`);
    console.log(`    Código (sourceCode): ${r.codigoOriginalEsperado} ${isPA062240 ? '[ALFANUMÉRICO]' : ''}`);
    const ehPublico = candidato?.classificacao === 'COMERCIALIZADO';
    console.log(`    Chave Pública: ${ehPublico ? 'rustika-' + r.codigoOriginalEsperado : 'NULA (Interno)'}`);
    console.log(`    Nome Persistido: ${r.nomePersistido}`);
    if (correcaoEncoding) {
        console.log(`    -> CORREÇÃO DE ENCODING PARA: ${candidato?.nome}`);
    } else {
        console.log(`    -> Nome confere com Excel.`);
    }
    console.log(`    Operação simulada: UPDATE onde id=${r.idPersistido}, preenchendo rastreabilidade (sourceCode=${r.codigoOriginalEsperado}, publicKey=${ehPublico ? 'rustika-' + r.codigoOriginalEsperado : 'null'}).`);
  });

  const persistidosCodigos = [
    ...preservar.map((p: any) => p.codigoOriginalEsperado),
    ...aVincular.map((v: any) => v.codigoOriginalEsperado)
  ];

  const aInserir = catalog.candidatos.filter(c => !persistidosCodigos.includes(c.codigo));
  console.log(`\n--- 3. REGISTROS A INSERIR (${aInserir.length}) ---`);
  
  if (aInserir.length !== 141) {
    console.warn(`[AVISO] Esperados 141 produtos a inserir, encontrados ${aInserir.length}.`);
  }

  console.log(`\n=== TOTAIS ESPERADOS PÓS-RECUPERAÇÃO ===`);
  console.log(`Total Produtos: ${27 + aInserir.length} (esperado: 168)`);
  console.log(`Preservados: 2`);
  console.log(`Vinculados (Updates): 25`);
  console.log(`Inseridos (Novos): 141`);
  console.log(`Tratamento de PA062240: ${pa062240Tratado ? 'Incluído nos Vínculos (Alfanumérico Seguro)' : 'Não encontrado'}`);

  console.log(`\nDry-run offline concluído. Nenhuma operação de escrita foi realizada no banco de dados.`);
}

executeDryRun().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
