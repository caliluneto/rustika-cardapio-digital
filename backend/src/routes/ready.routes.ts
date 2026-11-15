import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

/**
 * GET /api/ready — prontidão para receber tráfego: banco acessível e schema compatível com a API.
 * Só leitura (SELECT com a role de runtime), com timeout curto e cache de poucos segundos para não amplificar
 * carga. Responde apenas 200/503 e um código fixo: nenhum detalhe de infraestrutura, versão ou erro.
 * `GET /api/health` continua sendo apenas "processo vivo" (liveness) e não consulta o banco.
 */
export const READY_TIMEOUT_MS = 2000;
export const READY_OK_CACHE_MS = 5000;
export const READY_FAIL_CACHE_MS = 1000;

export function createReadyRouter(prisma?: PrismaClient, now: () => number = Date.now): Router {
  const router = Router();
  let cached: { ready: boolean; until: number } | undefined;

  async function probe(): Promise<boolean> {
    if (!prisma) return false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS); });
    try {
      await Promise.race([
        (async () => {
          await prisma.$queryRaw`SELECT 1`;
          // Coluna criada pelas migrations mais recentes: a ausência indica schema defasado.
          await prisma.$queryRaw`SELECT availability_state::text FROM products LIMIT 1`;
        })(),
        timeout,
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  router.get('/', async (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const time = now();
    if (!cached || cached.until <= time) {
      const ready = await probe();
      cached = { ready, until: time + (ready ? READY_OK_CACHE_MS : READY_FAIL_CACHE_MS) };
    }
    if (cached.ready) {
      response.status(200).json({ success: true, data: { status: 'ready' } });
    } else {
      response.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Serviço indisponível no momento.' } });
    }
  });

  return router;
}
