import type { ErrorRequestHandler } from 'express';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const isKnownError = error instanceof AppError;
  const statusCode = isKnownError ? error.statusCode : 500;
  const code = isKnownError ? error.code : 'INTERNAL_ERROR';
  const message = isKnownError ? error.message : 'Erro interno no servidor.';

  if (!isKnownError) {
    console.error('[api] Erro inesperado:', error);
  }

  response.status(statusCode).json({
    success: false,
    error: { code, message },
  });
};
