import * as fs from 'fs';
import * as path from 'path';
import { readExcelExpectations } from './inspect-reconciliation';

const basePath = path.join(__dirname, '../../');
let fileContent = '';
try {
    fileContent = fs.readFileSync(path.join(basePath, 'reconciliation-output.json'), 'utf8');
    if (fileContent.charCodeAt(0) === 0xFEFF || fileContent.charCodeAt(0) === 0xFFFE || fileContent.includes('\0')) {
        fileContent = fs.readFileSync(path.join(basePath, 'reconciliation-output.json'), 'utf16le');
    }
} catch (e) {
    fileContent = fs.readFileSync(path.join(basePath, 'reconciliation-output.json'), 'utf16le');
}

fileContent = fileContent.replace(/^\uFEFF/, '');
const reconciliationData = JSON.parse(fileContent);

const banco = reconciliationData.inventario.produtos;
const ambiguidades = reconciliationData.ambiguidades;
const catalog = readExcelExpectations();
const candidatos = catalog.candidatos;

// 1. RECONCILIAR OS 25 REGISTROS
interface Mapeamento {
  idPersistido: string;
  nomePersistido: string;
  codigoOriginalEsperado: string | null;
  categoria: string;
  precoCentavos: number;
  statusComercial: string;
  identidadeEsperada: string | null;
  grauConfianca: 'ALTO' | 'PENDENTE_DE_DECISAO' | 'CORRETO';
}

const mapeamento: Mapeamento[] = [];

for (const p of banco) {
  let confianca: 'ALTO' | 'PENDENTE_DE_DECISAO' | 'CORRETO' = 'PENDENTE_DE_DECISAO';
  let codigo: string | null = null;
  let identity: string | null = null;

  if (p.sourceCode && p.publicKey) {
    confianca = 'CORRETO';
    codigo = p.sourceCode;
    identity = p.publicKey;
  } else {
    // Procura nas ambiguidades
    const amb = ambiguidades.find((a: any) => a.ids.includes(p.id));
    if (amb && amb.codigos.length === 1) {
      codigo = amb.codigos[0];
      const candidato = candidatos.find((c: any) => c.codigo === codigo);
      if (candidato) {
        if (candidato.nome.trim().toUpperCase() === p.name.trim().toUpperCase()) {
            confianca = 'PENDENTE_DE_DECISAO';
        }
      }
    } else {
        const candidato = candidatos.find((c: any) => c.nome.trim().toUpperCase() === p.name.trim().toUpperCase());
        if (candidato) {
            codigo = candidato.codigo;
            confianca = 'PENDENTE_DE_DECISAO';
        }
    }
  }

  mapeamento.push({
    idPersistido: p.id,
    nomePersistido: p.name,
    codigoOriginalEsperado: codigo,
    categoria: p.categoryId,
    precoCentavos: Math.round(Number(p.price) * 100),
    statusComercial: p.isActive ? 'Ativo' : 'Inativo',
    identidadeEsperada: codigo ? `rustika-${codigo}` : null,
    grauConfianca: confianca
  });
}

console.log(JSON.stringify(mapeamento, null, 2));
