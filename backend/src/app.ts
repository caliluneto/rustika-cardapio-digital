import cors from 'cors';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { healthRouter } from './routes/health.routes';

export interface AppDependencies {
  prisma?: PrismaClient;
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();

  if (dependencies.prisma) {
    app.locals.prisma = dependencies.prisma;
  }

  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.use('/api/health', healthRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
