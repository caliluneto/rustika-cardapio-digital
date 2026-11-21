/**
 * Validação de configuração de execução em modo production/homologação (3D.5.2). Pura e chamada apenas pelo
 * server.ts quando NODE_ENV=production: não altera o comportamento de desenvolvimento nem de testes.
 */
// 'app-homolog-neon' é um segundo perfil de homologação opt-in (Neon Free), com a mesma exigência de
// CORS https abaixo; a diferença fica inteiramente na verificação de identidade do servidor (neonServerIdentity.ts).
const HOMOLOG_RUNTIME_PROFILES = new Set(['app-homolog', 'app-homolog-neon']);

export function assertHomologRuntimeConfig(config: { nodeEnv: string; corsOrigin: string; databaseProfile: string }): void {
  if (config.nodeEnv !== 'production' || !HOMOLOG_RUNTIME_PROFILES.has(config.databaseProfile)) {
    throw new Error('Execução de homologação exige NODE_ENV=production e DB_PROFILE=app-homolog ou app-homolog-neon.');
  }
  let origin: URL;
  try {
    origin = new URL(config.corsOrigin);
  } catch {
    throw new Error('CORS_ORIGIN deve ser uma origem https válida em homologação.');
  }
  const host = origin.hostname.toLowerCase();
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '' ||
      origin.username !== '' || host === 'localhost' || host.endsWith('.localhost') || /^(127|0)\./.test(host) || host === '[::1]') {
    throw new Error('CORS_ORIGIN deve ser uma origem https pública, sem caminho, e nunca localhost.');
  }
  if (config.corsOrigin.endsWith('/')) {
    throw new Error('CORS_ORIGIN deve ser a origem exata, sem barra final.');
  }
}
