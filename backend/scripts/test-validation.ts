import * as fs from 'fs';
import * as path from 'path';

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

import { readExcelExpectations } from './inspect-reconciliation';
const catalog = readExcelExpectations();

console.log(`\n--- CONTAGENS E CATEGORIZAÇÃO (Total Persistidos = ${validacaoData.resultados.length}) ---`);

const preservar = mapeamentoData.filter((m: any) => m.grauConfianca === 'CORRETO');
const preservarIds = preservar.map((p: any) => p.idPersistido);

let contagemPreservar = 0;
let contagemVincularValidado = 0;
let contagemVincularAmbiguo = 0;

for (const res of validacaoData.resultados) {
  if (preservarIds.includes(res.idPersistido)) {
    contagemPreservar++;
  } else if (res.statusValidacao === 'VINCULO_VALIDADO') {
    contagemVincularValidado++;
  } else if (res.statusValidacao === 'VINCULO_AMBIGUO') {
    contagemVincularAmbiguo++;
  }
}

console.log(`PRESERVAR (Já corretos no BD): ${contagemPreservar}`);
console.log(`VINCULAR_VALIDADO (A vincular): ${contagemVincularValidado}`);
console.log(`VINCULAR_AMBIGUO (A vincular, mas com encoding ruim): ${contagemVincularAmbiguo}`);
console.log(`TOTAL ÚNICOS: ${contagemPreservar + contagemVincularValidado + contagemVincularAmbiguo}`);

// Ensure exactly 27 IDs uniquely accounted for
const uniqueIds = new Set(validacaoData.resultados.map((r: any) => r.idPersistido));
console.log(`\nIDs ÚNICOS no array de resultados: ${uniqueIds.size}`);

console.log(`\n--- INVESTIGAÇÃO DOS 5 REGISTROS COM ENCODING CORROMPIDO ---`);
const ambiguos = validacaoData.resultados.filter((r: any) => r.statusValidacao === 'VINCULO_AMBIGUO');
for (const a of ambiguos) {
  const candidato = catalog.candidatos.find(c => c.codigo === a.codigoOriginalEsperado);
  const m = mapeamentoData.find((m: any) => m.idPersistido === a.idPersistido);
  console.log(`- ID Persistido: ${a.idPersistido}`);
  console.log(`  Nome corrompido: ${a.nomePersistido}`);
  console.log(`  Nome correto esperado: ${candidato?.nome}`);
  console.log(`  Código original (Excel): ${a.codigoOriginalEsperado}`);
  console.log(`  Categoria esperada ID: ${m.categoria}`);
  console.log(`  Preço em centavos: ${m.precoCentavos} === ${candidato?.centavos} (${m.precoCentavos === candidato?.centavos ? 'OK' : 'DIVERGENTE'})`);
  console.log(`  Status esperado: ${candidato?.ativo ? 'Ativo' : 'Inativo'}`);
  console.log(`  Classificação: ${candidato?.classificacao} (${candidato?.classificacao === 'COMERCIALIZADO' ? 'Público' : 'Interno'})`);
  
  const duplicatasCod = validacaoData.resultados.filter((r: any) => r.codigoOriginalEsperado === a.codigoOriginalEsperado);
  console.log(`  Mapeamentos para este código: ${duplicatasCod.length} (${duplicatasCod.length === 1 ? 'Única correspondência' : 'DIVERGENTE - Múltiplos'})`);
  console.log('');
}
