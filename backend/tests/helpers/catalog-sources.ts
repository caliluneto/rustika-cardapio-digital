import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Fontes de catalogo para os testes (3D.3.25-D).
 *
 * - `syntheticCatalogPath`: fixture ficticia versionada; usada por TODOS os testes de importacao/seed, em CI e local.
 * - `realCatalogPath`: planilha real privada (fora do Git). So `private-catalog.test.ts` a le, e apenas se existir.
 *
 * `RUSTIKA_IGNORE_PRIVATE_CATALOG=1` (definido pelo `npm run test:ci`) finge que a planilha real nao existe,
 * para reproduzir localmente o que o CI ve. `RUSTIKA_REQUIRE_PRIVATE_CATALOG=1` faz a ausencia ser erro.
 */
const backendRoot = path.resolve(__dirname, '..', '..');

export const syntheticCatalogPath = path.join(backendRoot, 'tests', 'fixtures', 'catalog', 'synthetic-catalog.csv');
export const syntheticInvalidPricesPath = path.join(backendRoot, 'tests', 'fixtures', 'catalog', 'synthetic-catalog-invalid-prices.csv');
export const realCatalogPath = path.join(backendRoot, 'data', 'Exportacao-produtos.xlsx');

export const hasRealCatalog = process.env.RUSTIKA_IGNORE_PRIVATE_CATALOG !== '1' && existsSync(realCatalogPath);

if (!hasRealCatalog && process.env.RUSTIKA_REQUIRE_PRIVATE_CATALOG === '1') {
  throw new Error('RUSTIKA_REQUIRE_PRIVATE_CATALOG=1, mas a planilha real nao esta disponivel.');
}
