import cors from 'cors';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { env } from './config/env';
import type { WebConfig } from './config/webConfig';
import { createHomologGate } from './security/homologGate';
import { createStaticFrontend } from './web/staticFrontend';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { healthRouter } from './routes/health.routes';
import { createReadyRouter } from './routes/ready.routes';
import { createAccessRouters } from './routes/access.routes';
import { createCatalogRouter } from './routes/catalog.routes';
import { createOrderRouter } from './routes/order.routes';
import type { OrderRouterOptions } from './routes/order.routes';

export interface AppDependencies {
  prisma?: PrismaClient;
  authClock?: () => Date;
  orderLimits?: OrderRouterOptions['limits'];
  /** 3D.5.3-B: hospedagem em um único serviço (frontend estático, proxy confiável, portão). Sem isso: somente API. */
  web?: Partial<WebConfig>;
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();
  const web = dependencies.web ?? {};
  if (dependencies.prisma) app.locals.prisma = dependencies.prisma;
  app.disable('x-powered-by');
  // Padrão restritivo: 0 saltos = `request.ip` é o endereço do socket e X-Forwarded-For é ignorado.
  if ((web.trustProxyHops ?? 0) > 0) app.set('trust proxy', web.trustProxyHops);
  if (web.noindex) app.use((_request, response, next) => { response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
  if (web.gate) app.use(createHomologGate(web.gate, dependencies.authClock));
  app.use(cors({ origin: env.corsOrigin, credentials: true,
    allowedHeaders: ['Content-Type', 'X-Rustika-Request', 'Idempotency-Key'] }));

  app.use('/api/health', healthRouter);
  app.use('/api/ready', createReadyRouter(dependencies.prisma));
  app.use('/api', createCatalogRouter(dependencies.prisma));
  const access = createAccessRouters(dependencies.prisma, {
    origin: env.corsOrigin,
    secureCookies: env.nodeEnv === 'production' || env.corsOrigin.startsWith('https://'),
    now: dependencies.authClock,
  });
  app.use('/api/admin', access.adminRouter);
  app.use('/api/comanda-sessions', access.sessionRouter);
  app.use('/api/orders', createOrderRouter(dependencies.prisma, env.corsOrigin, { now: dependencies.authClock, limits: dependencies.orderLimits }));

  // Frontend estático depois de TODAS as rotas /api e antes do 404: /api desconhecido nunca recebe HTML.
  if (web.frontendDir) app.use(createStaticFrontend(web.frontendDir, { privateCache: web.gate !== undefined }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
