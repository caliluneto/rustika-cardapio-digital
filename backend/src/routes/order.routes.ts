import express, { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ORDER_LIMITS } from '../domain/rules';
import { parseIdempotencyKey } from '../domain/orderInput';
import { AppError } from '../middleware/errorHandler';
import { clientAddress, createFixedWindowLimiter, DEFAULT_LIMIT_CAPACITY, tooManyRequests } from '../security/accessLimits';
import { assertWriteRequest } from '../security/writeGuard';
import { createOrderService } from '../services/order.service';
import { readSessionCookie, sha256 } from '../services/orderSession';

/**
 * Rate limits for POST /api/orders (per process, in memory). Values and rationale are in
 * docs/orders-api.md, section "Limites de requisição".
 */
export interface WindowLimit { max: number; windowMs: number }
export interface OrderRateLimits {
  perSession: WindowLimit; invalidSessionPerIp: WindowLimit; perIp: WindowLimit;
  trustedSessionMs: number; capacity: number;
}

export const ORDER_RATE_LIMITS: Readonly<OrderRateLimits> = {
  /** L1: one comanda session (one device). A table rarely sends more than a few orders per hour. */
  perSession: { max: 10, windowMs: 5 * 60_000 },
  /** L2: failed session checks per IP. Blocks cookie probing, never sessions already proven valid. */
  invalidSessionPerIp: { max: 30, windowMs: 5 * 60_000 },
  /** L3: wide ceiling per IP. Many tables share the venue Wi-Fi (one public IP behind NAT). */
  perIp: { max: 300, windowMs: 5 * 60_000 },
  /** Sessions that recently completed an order keep working while their IP is under L2. */
  trustedSessionMs: 8 * 60 * 60_000,
  capacity: DEFAULT_LIMIT_CAPACITY,
};

export interface OrderRouterOptions {
  now?: () => Date;
  limits?: Partial<OrderRateLimits>;
}

const isAppError = (error: unknown, status: number, code?: string): error is AppError =>
  error instanceof AppError && error.statusCode === status && (code === undefined || error.code === code);

export function createOrderRouter(prisma: PrismaClient | undefined, allowedOrigin: string, options: OrderRouterOptions = {}): Router {
  const router = Router();
  const now = options.now ?? (() => new Date());
  const limits = { ...ORDER_RATE_LIMITS, ...options.limits };
  const service = prisma ? createOrderService(prisma, now) : undefined;
  const capacity = limits.capacity;
  const perIp = createFixedWindowLimiter({ ...limits.perIp, now, capacity });
  const failures = createFixedWindowLimiter({ ...limits.invalidSessionPerIp, now, capacity });
  const perSession = createFixedWindowLimiter({ ...limits.perSession, now, capacity });
  // A limiter with max=1 used as a bounded, expiring set of session hashes proven valid.
  const trusted = createFixedWindowLimiter({ max: 1, windowMs: limits.trustedSessionMs, now, capacity });

  router.post('/', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    try {
      const ip = clientAddress(request);
      const ceiling = perIp.hit(ip);
      if (ceiling.limited) throw tooManyRequests(response, ceiling.retryAfterSeconds);

      assertWriteRequest(request, allowedOrigin);
      if (Object.keys(request.query).length) throw new AppError(400, 'INVALID_INPUT', 'O envio de pedidos não aceita parâmetros de consulta.');

      let credential: string;
      try { credential = readSessionCookie(request.get('Cookie')); } catch (error) {
        failures.hit(ip);
        throw error;
      }
      const sessionKey = sha256(credential);
      const probing = failures.peek(ip);
      if (probing.limited && !trusted.peek(sessionKey).limited) throw tooManyRequests(response, probing.retryAfterSeconds);
      const session = perSession.hit(sessionKey);
      if (session.limited) throw tooManyRequests(response, session.retryAfterSeconds);

      response.locals.orderCredential = credential;
      response.locals.orderSessionKey = sessionKey;
      response.locals.orderIp = ip;
      response.locals.orderKey = parseIdempotencyKey(request.get('Idempotency-Key'));
      next();
    } catch (error) { next(error); }
  }, express.json({ limit: ORDER_LIMITS.maxBodyBytes }), (request, response, next) => {
    if (!service) return next(new AppError(503, 'ORDERS_UNAVAILABLE', 'Serviço de pedidos temporariamente indisponível.'));
    const sessionKey = response.locals.orderSessionKey as string;
    const markTrusted = () => { if (!trusted.peek(sessionKey).limited) trusted.hit(sessionKey); };
    service.createOrder(request.body, response.locals.orderCredential as string, response.locals.orderKey)
      .then(({ replayed, order }) => {
        markTrusted();
        response.status(replayed ? 200 : 201).json({ success: true, data: order });
      })
      .catch((error: unknown) => {
        if (isAppError(error, 401, 'INVALID_SESSION')) failures.hit(response.locals.orderIp as string);
        // These outcomes are only reachable after the session was validated inside the transaction.
        else if (isAppError(error, 404, 'PRODUCT_NOT_FOUND') || isAppError(error, 409) || isAppError(error, 422)) markTrusted();
        next(error);
      });
  });
  return router;
}
