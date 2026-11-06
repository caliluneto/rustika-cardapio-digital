import cors from 'cors';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { env } from './config/env';
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
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();
  if (dependencies.prisma) app.locals.prisma = dependencies.prisma;
  app.disable('x-powered-by');
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

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
