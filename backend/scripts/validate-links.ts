import * as fs from 'fs';
import * as path from 'path';

const basePath = path.join(__dirname, '../../');
let fileContent = '';
try {
    fileContent = fs.readFileSync(path.join(basePath, 'mapeamento.json'), 'utf8');
    if (fileContent.charCodeAt(0) === 0xFEFF || fileContent.charCodeAt(0) === 0xFFFE || fileContent.includes('\0')) {
        fileContent = fs.readFileSync(path.join(basePath, 'mapeamento.json'), 'utf16le');
    }
} catch (e) {
    fileContent = fs.readFileSync(path.join(basePath, 'mapeamento.json'), 'utf16le');
}

fileContent = fileContent.replace(/^\uFEFF/, '');
const mapeamento = JSON.parse(fileContent);

import { readExcelExpectations } from './inspect-reconciliation';
const catalog = readExcelExpectations();

interface ValidationResult {
  idPersistido: string;
  nomePersistido: string;
  codigoOriginalEsperado: string | null;
  statusValidacao: 'VINCULO_VALIDADO' | 'VINCULO_AMBIGUO' | 'VINCULO_DIVERGENTE';
  motivos: string[];
}

const resultados: ValidationResult[] = [];

// Checar IDs ou codigos duplicados
const codigoCounts = new Map<string, number>();
for (const m of mapeamento) {
  if (m.codigoOriginalEsperado) {
    codigoCounts.set(m.codigoOriginalEsperado, (codigoCounts.get(m.codigoOriginalEsperado) || 0) + 1);
  }
}

for (const m of mapeamento) {
  const motivos: string[] = [];
  let statusValidacao: 'VINCULO_VALIDADO' | 'VINCULO_AMBIGUO' | 'VINCULO_DIVERGENTE' = 'VINCULO_VALIDADO';

  if (!m.codigoOriginalEsperado) {
    statusValidacao = 'VINCULO_AMBIGUO';
    motivos.push('Código original não identificado no mapeamento');
  } else {
    // 1. Verificar unicidade
    if (codigoCounts.get(m.codigoOriginalEsperado)! > 1) {
      statusValidacao = 'VINCULO_DIVERGENTE';
      motivos.push('Mais de um registro persistido aponta para o mesmo código original');
    }

    // 2. Localizar no Excel
    const candidato = catalog.candidatos.find(c => c.codigo === m.codigoOriginalEsperado);
    if (!candidato) {
      statusValidacao = 'VINCULO_DIVERGENTE';
      motivos.push('Candidato não encontrado no catálogo esperado');
    } else {
      // 3. Comparar preço
      if (m.precoCentavos !== candidato.centavos) {
        statusValidacao = 'VINCULO_DIVERGENTE';
        motivos.push(`Preço divergente: Banco=${m.precoCentavos}, Excel=${candidato.centavos}`);
      }
      
      // 4. Verificar status comercial
      const statusEsperado = candidato.ativo ? 'Ativo' : 'Inativo';
      if (m.statusComercial !== statusEsperado) {
         statusValidacao = 'VINCULO_DIVERGENTE';
         motivos.push(`Status divergente: Banco=${m.statusComercial}, Excel=${statusEsperado}`);
      }

      // 5. Comparar nome (já que nome isolado não é prova, validamos se divergem fortemente)
      if (m.nomePersistido.trim().toUpperCase() !== candidato.nome.trim().toUpperCase()) {
         statusValidacao = 'VINCULO_AMBIGUO';
         motivos.push(`Nomes não idênticos: Banco="${m.nomePersistido}", Excel="${candidato.nome}"`);
      }

      // 6. Confirmar identidade pública ou interna
      const expectedId = `rustika-${candidato.codigo}`;
      if (m.identidadeEsperada !== expectedId) {
          statusValidacao = 'VINCULO_DIVERGENTE';
          motivos.push(`Identidade esperada divergente`);
      }
    }
  }

  // Se nenhum motivo de ambiguidade ou divergência foi encontrado, o vínculo é considerado validado (pela exclusão).
  if (motivos.length === 0) {
    statusValidacao = 'VINCULO_VALIDADO';
  }

  resultados.push({
    idPersistido: m.idPersistido,
    nomePersistido: m.nomePersistido,
    codigoOriginalEsperado: m.codigoOriginalEsperado,
    statusValidacao,
    motivos
  });
}

const sumario = {
  VINCULO_VALIDADO: resultados.filter(r => r.statusValidacao === 'VINCULO_VALIDADO').length,
  VINCULO_AMBIGUO: resultados.filter(r => r.statusValidacao === 'VINCULO_AMBIGUO').length,
  VINCULO_DIVERGENTE: resultados.filter(r => r.statusValidacao === 'VINCULO_DIVERGENTE').length,
};

console.log(JSON.stringify({ sumario, resultados }, null, 2));
