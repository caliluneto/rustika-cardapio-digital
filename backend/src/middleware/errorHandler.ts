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

function requestError(error: unknown): AppError | undefined {
  if (error instanceof URIError) {
    return new AppError(400, 'INVALID_INPUT', 'Requisição inválida.');
  }
  if (error && typeof error === 'object') {
    const type = (error as { type?: unknown }).type;
    if (type === 'entity.parse.failed') {
      return new AppError(400, 'INVALID_INPUT', 'JSON inválido.');
    }
    if (type === 'entity.too.large') {
      return new AppError(413, 'BODY_TOO_LARGE', 'Corpo da requisição excede o limite.');
    }
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const knownError = error instanceof AppError ? error : requestError(error);
  const statusCode = knownError?.statusCode ?? 500;
  const code = knownError?.code ?? 'INTERNAL_ERROR';
  const message = knownError?.message ?? 'Erro interno no servidor.';

  if (!knownError) {
    const name = error instanceof Error ? error.name : 'unknown';
    console.error(`[api] Erro inesperado (${name}); detalhes omitidos.`);
  }

  response.status(statusCode).json({
    success: false,
    error: { code, message },
  });
};
