import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_request, response) => {
  response.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'cardapio-digital-api',
      timestamp: new Date().toISOString(),
      uptime: Number(process.uptime().toFixed(3)),
    },
  });
});
