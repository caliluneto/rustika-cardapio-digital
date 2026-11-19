import { defineConfig } from 'vitest/config';

/**
 * Suíte PREPARADA (3D.5.2) para um PostgreSQL EFÊMERO e VAZIO, explicitamente autorizado (por exemplo, serviço de CI
 * descartável). Nunca faz parte de `npm test`/`test:ci` (sufixo `.ephemeral.ts` fora do padrão `*.test.ts`) e nunca
 * deve apontar para o PostgreSQL local de Dev/Test. Exige RUSTIKA_HOMOLOG_EPHEMERAL_URL e a confirmação explícita;
 * cada arquivo aborta antes de escrever se o servidor tiver qualquer banco cardapio_digital_* pré-existente.
 */
export default defineConfig({
  test: {
    include: ['tests/homolog-ephemeral/**/*.ephemeral.ts'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
