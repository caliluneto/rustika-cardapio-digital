import { createApp } from './app';
import { env } from './config/env';
import { createPrismaRuntime } from './lib/prisma';

const { databaseInfo, prisma } = createPrismaRuntime();
const app = createApp({ prisma });

const server = app.listen(env.port, () => {
  console.log(`[api] Cardápio Digital API disponível em http://localhost:${env.port}`);
  console.log(`[api] Origem CORS autorizada: ${env.corsOrigin}`);
  console.log(`[api] Banco de dados: ${databaseInfo}`);
});

function shutdown(signal: string): void {
  console.log(`[api] Sinal ${signal} recebido. Encerrando servidor...`);
  server.close(() => {
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
