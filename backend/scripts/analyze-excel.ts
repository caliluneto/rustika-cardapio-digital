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
  
  const data = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);
  
  console.log('Total records:', data.length);
  
  const first = data[0];
  if (first) {
    console.log('--- Headers / Keys ---');
    console.log(Object.keys(first));
    console.log('--- Sample Data (first 3) ---');
    console.log(JSON.stringify(data.slice(0, 3), null, 2));
    
    // Check status/active fields
    const statuses = new Set();
    const groups = new Set();
    let nullCount = 0;

    data.forEach((row: any) => {
      // Find possible status columns
      const statusKey = Object.keys(row).find(k => k.toLowerCase().includes('status') || k.toLowerCase().includes('ativo') || k.toLowerCase().includes('active'));
      if (statusKey) statuses.add(row[statusKey]);
      
      const groupKey = Object.keys(row).find(k => k.toLowerCase().includes('grupo') || k.toLowerCase().includes('categoria') || k.toLowerCase().includes('category'));
      if (groupKey) groups.add(row[groupKey]);
      
      if (!statusKey && !row['Ativo']) nullCount++;
    });

    console.log('--- Possible Statuses ---');
    console.log(Array.from(statuses));
    
    console.log('--- Possible Groups ---');
    console.log(Array.from(groups));
  }
}

analyzeExcel();