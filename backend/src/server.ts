import path from 'node:path';
import { createApp } from './app';
import { env } from './config/env';
import { createPrismaRuntime } from './lib/prisma';
import { assertHomologRuntimeConfig } from './config/homologRuntime';
import { HOMOLOG_ROLES, getBackendRoot, loadDatabaseProfile } from './config/secrets';
import { readWebConfig } from './config/webConfig';
import { evaluateServerIdentity, readServerFacts } from './config/serverIdentity';
import { NEON_HOMOLOG_PROFILE, assertNeonProxyTlsAck, evaluateNeonServerIdentity, readNeonServerFacts } from './config/neonServerIdentity';

if (env.nodeEnv === 'production') assertHomologRuntimeConfig(env);

// 3D.5.3-B: hospedagem em um único serviço. Falha fechada se a configuração for inválida (mensagens sem valores).
const web = readWebConfig(process.env, () => path.resolve(getBackendRoot(), '..', 'frontend', 'dist'));
if (env.nodeEnv === 'production' && web.frontendDir && !web.gate) {
  console.warn('[api] Portão de homologação desativado (HOMOLOG_GATE): o frontend e a API estão acessíveis sem credencial adicional.');
}

const { databaseInfo, prisma } = createPrismaRuntime();
const app = createApp({ prisma, web });

let server: ReturnType<typeof app.listen> | undefined;

function startListening(): void {
  server = app.listen(env.port, () => {
    console.log(`[api] Cardápio Digital API disponível em http://localhost:${env.port}`);
    console.log(`[api] Origem CORS autorizada: ${env.corsOrigin}`);
    console.log(`[api] Banco de dados: ${databaseInfo}`);
  });
}

if (env.nodeEnv === 'production' && env.databaseProfile === NEON_HOMOLOG_PROFILE) {
  // 3D.5.3-C.5: perfil OPT-IN para o Neon Free. Exige reconhecimento humano explícito ANTES de qualquer conexão (ver
  // neonServerIdentity.ts); a verificação de identidade é independente da de app-homolog (política diferente, não mais fraca).
  try {
    assertNeonProxyTlsAck(process.env.RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK);
  } catch (error) {
    console.error(`[api] ${(error as Error).message}`);
    process.exit(1);
  }
  const profileSecrets = loadDatabaseProfile(env.databaseProfile, { purpose: 'runtime', secretsDir: env.secretsDir });
  const host = profileSecrets.host ?? '';
  readNeonServerFacts(profileSecrets.databaseUrl, host)
    .then(async (facts) => {
      const problems = evaluateNeonServerIdentity(facts, {
        expectedProjectId: profileSecrets.projectId ?? '',
        expectedClusterId: profileSecrets.clusterId ?? '',
        expectedUser: HOMOLOG_ROLES.runtime,
      });
      if (problems.length > 0) {
        console.error('[api] Identidade do servidor de banco (Neon) não confere; encerrando sem aceitar tráfego.');
        process.exit(1);
      }
      // 3D.5.3-C.5.1: VERIFICAÇÃO COMPLEMENTAR. O que foi comprovado acima (readNeonServerFacts) é o TLS externo de UMA
      // CONEXÃO INDEPENDENTE, aberta só para esta verificação — não o socket que o Prisma usa para servir tráfego (o
      // motor do Prisma não expõe seu socket ao código JS, então ele não pode ser inspecionado diretamente). A conexão
      // independente usa a MESMA URL/parâmetros (sslmode=require, sslaccept=strict — nunca relaxáveis, ver secrets.ts)
      // do Prisma; abaixo, o PRÓPRIO cliente Prisma que vai servir as requisições precisa provar, antes de aceitar
      // tráfego, que consegue conectar e chegar ao banco/role certos com esses mesmos parâmetros estritos. Isto reduz
      // a lacuna entre "uma sonda separada funcionou" e "o cliente real funciona", mas não é, e não é tratado como,
      // prova do socket do Prisma em si: nunca afirme TLS comprovado "até o processo PostgreSQL" a partir disto.
      try {
        const [confirmed] = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`SELECT current_database() AS db, current_user AS usr`;
        if (!confirmed || confirmed.db !== profileSecrets.database || confirmed.usr !== HOMOLOG_ROLES.runtime) {
          console.error('[api] O cliente Prisma conectou a um banco/role diferente do esperado (Neon); encerrando sem aceitar tráfego.');
          process.exit(1);
        }
      } catch {
        console.error('[api] O cliente Prisma não conseguiu confirmar a identidade do servidor (Neon); encerrando sem aceitar tráfego.');
        process.exit(1);
      }
      console.warn('[api] Perfil app-homolog-neon: pg_stat_ssl pode mostrar ssl=false (TLS termina no proxy do provedor); TLS externo foi comprovado de forma independente, com os mesmos parâmetros usados pelo Prisma.');
      startListening();
    })
    .catch(() => {
      console.error('[api] Não foi possível verificar a identidade do servidor de banco (Neon); encerrando.');
      process.exit(1);
    });
} else if (env.nodeEnv === 'production') {
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
