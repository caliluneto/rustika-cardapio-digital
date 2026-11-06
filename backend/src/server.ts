import { createApp } from './app';
import { env } from './config/env';
import { createPrismaRuntime } from './lib/prisma';
import { assertHomologRuntimeConfig } from './config/homologRuntime';
import { HOMOLOG_ROLES, loadDatabaseProfile } from './config/secrets';
import { evaluateServerIdentity, readServerFacts } from './config/serverIdentity';

if (env.nodeEnv === 'production') assertHomologRuntimeConfig(env);

const { databaseInfo, prisma } = createPrismaRuntime();
const app = createApp({ prisma });

let server: ReturnType<typeof app.listen> | undefined;

function startListening(): void {
  server = app.listen(env.port, () => {
    console.log(`[api] Cardápio Digital API disponível em http://localhost:${env.port}`);
    console.log(`[api] Origem CORS autorizada: ${env.corsOrigin}`);
    console.log(`[api] Banco de dados: ${databaseInfo}`);
  });
}

if (env.nodeEnv === 'production') {
  // 3D.5.2-A: o servidor de banco precisa provar a identidade (TLS, marca do cluster, banco definitivo) antes de aceitar tráfego.
  const clusterId = loadDatabaseProfile(env.databaseProfile, { purpose: 'runtime', secretsDir: env.secretsDir }).clusterId ?? '';
  readServerFacts(prisma)
    .then((facts) => {
      const problems = evaluateServerIdentity(facts, { phase: 'final', expectedClusterId: clusterId, expectedUser: HOMOLOG_ROLES.runtime });
      if (problems.length > 0) {
        console.error('[api] Identidade do servidor de banco não confere; encerrando sem aceitar tráfego.');
        process.exit(1);
      }
      startListening();
    })
    .catch(() => {
      console.error('[api] Não foi possível verificar a identidade do servidor de banco; encerrando.');
      process.exit(1);
    });
} else {
  startListening();
}

function shutdown(signal: string): void {
  console.log(`[api] Sinal ${signal} recebido. Encerrando servidor...`);
  const closing = server;
  if (!closing) { process.exit(0); return; }
  closing.close(() => {
    prisma
      .$disconnect()
      .catch((error: unknown) => {
        console.error('[api] Falha ao desconectar o Prisma:', error);
      })
      .finally(() => {
        console.log('[api] Servidor encerrado.');
        process.exit(0);
      });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
