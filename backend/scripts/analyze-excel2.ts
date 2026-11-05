import xlsx from 'xlsx';
import path from 'path';
import { readFileSync } from 'fs';

function analyzeExcel() {
  const filePath = path.join(__dirname, '../data/Exportacao-produtos.xlsx');
  const workbook = xlsx.read(readFileSync(filePath), { type: 'buffer' });
  
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Arquivo sem abas.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Aba não encontrada.');
  
  const data = xlsx.utils.sheet_to_json(sheet);
  
  const total = data.length;
  let activeCount = 0;
  let inactiveCount = 0;
  let ambiguousCount = 0;
  
  const categories = new Set();
  
  const duplications = new Map();
  const ambiguousRecords: any[] = [];
  
  data.forEach((row: any) => {
    const estado = row['Estado'];
    const codigo = row['Código'];
    const nome = row['Nome curto'];
    
    if (estado === 'Ativo') {
      activeCount++;
    } else if (estado === 'Inativo') {
      inactiveCount++;
    } else {
      ambiguousCount++;
      ambiguousRecords.push(row);
    }
    
    if (row['Grupo']) {
      categories.add(row['Grupo'].trim());
    }
    
    if (codigo) {
      if (duplications.has(codigo)) {
        duplications.get(codigo).push(nome);
      } else {
        duplications.set(codigo, [nome]);
      }
    }
  });
  
  console.log(`1. Total: ${total}`);
  console.log(`2. Ativos: ${activeCount}`);
  console.log(`3. Inativos: ${inactiveCount}`);
  console.log(`4. Ambíguos: ${ambiguousCount}`);
  if (ambiguousCount > 0) console.log(ambiguousRecords);
  
  console.log(`5. Categorias (${categories.size}):`, Array.from(categories));
  
  const dups = Array.from(duplications.entries()).filter(([k, v]) => v.length > 1);
  console.log(`6. Duplicações de código: ${dups.length}`);
  if (dups.length > 0) console.log(dups);
  
}

analyzeExcel();