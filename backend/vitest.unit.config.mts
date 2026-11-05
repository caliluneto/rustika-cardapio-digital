import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Configuração do `npm run test:ci` (3D.3.25-D). NÃO é vitest.config.ts: um teste proíbe esse arquivo para que a
 * suíte com escrita nunca entre no `npm test`.
 *
 * Nenhum arquivo de teste é excluído. Os testes de importação/seed usam a fixture SINTÉTICA versionada
 * (`tests/fixtures/catalog`); só `tests/scripts/private-catalog.test.ts` lê a planilha real privada
 * (`backend/data/Exportacao-produtos.xlsx`, fora do Git) e se autoignora quando ela não existe.
 *
 * Este script força `RUSTIKA_IGNORE_PRIVATE_CATALOG=1`: mesmo na máquina que TEM a planilha, os testes que dependem
 * dela aparecem como "skipped", reproduzindo exatamente o que o CI enxerga. `npm test` (sem esta config) roda
 * também os testes da planilha real quando ela existe.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude],
    env: { RUSTIKA_IGNORE_PRIVATE_CATALOG: '1' },
  },
});
