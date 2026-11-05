/**
 * Valida o arquivo de estado produzido por `npm run e2e:inspect -- --out <arquivo>` (3D.3.29-FIX02).
 * Somente leitura de arquivo; nenhuma conexão. Códigos de saída:
 *   0  contrato válido e resíduo zero
 *   1  contrato válido, mas há tabela ausente ou resíduo
 *   2  uso incorreto, arquivo ausente/ilegível ou contrato violado (JSON inválido, vazio, campos faltando)
 *
 *   npm run e2e:validate-state -- <arquivo>
 */
import fs from 'node:fs';
import { E2eStateError, describeFailure, verifyZeroResidue } from './e2e-state-contract';

function main(): number {
  const file = process.argv[2];
  if (!file || process.argv.length > 3) {
    console.error('Uso: e2e:validate-state -- <arquivo-de-estado.json>');
    return 2;
  }
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    console.error('Arquivo de estado ausente ou ilegível: a inspeção não produziu saída.');
    return 2;
  }
  try {
    const report = verifyZeroResidue(text);
    if (!report.ok) {
      console.error(`Resíduo ou inconsistência após o E2E: ${describeFailure(report)}`);
      return 1;
    }
    console.log('Resíduo zero em todas as tabelas de dados (contrato do estado validado).');
    return 0;
  } catch (error) {
    console.error(error instanceof E2eStateError ? error.message : 'Falha inesperada ao validar o estado.');
    return 2;
  }
}

process.exit(main());
