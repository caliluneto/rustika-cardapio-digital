import express, { Router } from 'express';
import type { CookieOptions, RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { createAdminAuth, accessBody } from '../services/adminAuth.service';
import { createComandaAccess } from '../services/comandaAccess.service';
import { ADMIN_COOKIE, readOpaqueCookie } from '../security/adminSessions';
import { accessLimit } from '../security/accessLimits';
import { assertWriteRequest } from '../security/writeGuard';
import { SESSION_COOKIE } from '../services/orderSession';

interface AccessOptions { origin: string; secureCookies: boolean; now?: () => Date }

const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

export function createAccessRouters(prisma: PrismaClient | undefined, options: AccessOptions) {
  const now = options.now ?? (() => new Date());
  const auth = prisma ? createAdminAuth(prisma, now) : undefined;
  const access = prisma && auth ? createComandaAccess(prisma, auth, now) : undefined;
  function services() {
    if (!auth || !access) throw new AppError(503, 'ACCESS_UNAVAILABLE', 'Serviço de acesso temporariamente indisponível.');
    return { auth, access };
  }
  const adminRouter = Router(); const sessionRouter = Router();
  const noStore: RequestHandler = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).length) return next(new AppError(400, 'INVALID_INPUT', 'Não envie tokens ou parâmetros na URL.'));
    next();
  };
  const writeGuard: RequestHandler = (req, _res, next) => {
    try { assertWriteRequest(req, options.origin); next(); } catch (error) { next(error); }
  };
  const json = express.json({ limit: 4096 });
  const adminCookie: CookieOptions = { httpOnly: true, secure: options.secureCookies, sameSite: 'strict', path: '/api/admin' };
  const clientCookie: CookieOptions = { httpOnly: true, secure: options.secureCookies, sameSite: 'lax', path: '/api' };
  adminRouter.use(noStore); sessionRouter.use(noStore);

  adminRouter.post('/auth/login', writeGuard, accessLimit(10, 15 * 60000, now), json, asyncRoute(async (req, res) => {
    const result = await services().auth.login(req.body, readOpaqueCookie(req.get('Cookie'), ADMIN_COOKIE));
    res.cookie(ADMIN_COOKIE, result.token, { ...adminCookie, maxAge: Math.max(0, result.expiresAt.getTime() - now().getTime()) });
    res.json({ success: true, data: { admin: result.admin, expiresAt: result.expiresAt } });
  }));
  adminRouter.get('/auth/session', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await services().auth.authenticate(readOpaqueCookie(req.get('Cookie'), ADMIN_COOKIE)) });
  }));
  adminRouter.post('/auth/logout', writeGuard, json, asyncRoute(async (req, res) => {
    accessBody(req.body, []);
    services().auth.logout(readOpaqueCookie(req.get('Cookie'), ADMIN_COOKIE));
    res.clearCookie(ADMIN_COOKIE, adminCookie).status(204).end();
  }));
  adminRouter.post('/comanda-invitations', writeGuard, accessLimit(60, 5 * 60000, now), json, asyncRoute(async (req, res) => {
    res.status(201).json({ success: true, data: await services().access.issue(req.body, readOpaqueCookie(req.get('Cookie'), ADMIN_COOKIE)) });
  }));
  sessionRouter.post('/', writeGuard, accessLimit(30, 5 * 60000, now), json, asyncRoute(async (req, res) => {
    const result = await services().access.redeem(req.body);
    res.cookie(SESSION_COOKIE, result.token, { ...clientCookie, maxAge: Math.max(0, result.expiresAt.getTime() - now().getTime()) });
    res.status(201).json({ success: true, data: { comanda: result.comanda, expiresAt: result.expiresAt } });
  }));
  sessionRouter.get('/current', asyncRoute(async (req, res) => {
    res.json({ success: true, data: await services().access.current(readOpaqueCookie(req.get('Cookie'), SESSION_COOKIE)) });
  }));
  return { adminRouter, sessionRouter };
}
