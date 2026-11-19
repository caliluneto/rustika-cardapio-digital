import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler';

export const WRITE_HEADER = 'X-Rustika-Request';
export const WRITE_HEADER_VALUE = '1';

/**
 * CSRF contract for every cookie-authenticated write under /api:
 * exact Origin and `X-Rustika-Request: 1` (403 ORIGIN_NOT_ALLOWED), then JSON (415).
 * The custom header forces a CORS preflight, which only the configured origin passes.
 */
export function assertWriteRequest(request: Request, allowedOrigin: string): void {
  if (request.get('Origin') !== allowedOrigin || request.get(WRITE_HEADER) !== WRITE_HEADER_VALUE) {
    throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Origem ou proteção da requisição inválida.');
  }
  // DELETE normalmente não tem corpo; apenas POST/PATCH/PUT exigem Content-Type JSON
  if (['POST', 'PATCH', 'PUT'].includes(request.method ?? '') && !request.is('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie application/json.');
  }
}
