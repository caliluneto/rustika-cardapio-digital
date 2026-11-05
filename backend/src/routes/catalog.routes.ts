import { Router } from 'express';
import type { RequestHandler } from 'express';
import { AppError } from '../middleware/errorHandler';
import { createCatalogService } from '../services/catalog.service';
import type { CatalogPrisma, ProductFilters } from '../services/catalog.service';

function invalidInput(): never {
  throw new AppError(400, 'INVALID_INPUT', 'Parâmetros de catálogo inválidos.');
}

function validateQuery(query: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(query).some((key) => !allowed.includes(key) || typeof query[key] !== 'string')) invalidInput();
}

function productKey(value: unknown): string {
  if (typeof value !== 'string' || !/^rustika-[0-9A-Z]{1,64}$/.test(value)) invalidInput();
  return value;
}

function parseFilters(query: Record<string, unknown>): ProductFilters {
  validateQuery(query, ['categoryId', 'availability', 'limit', 'cursor']);
  const filters: ProductFilters = { limit: 30 };
  if (query.categoryId !== undefined) {
    const value = query.categoryId as string;
    if (value.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) invalidInput();
    filters.categoryId = value;
  }
  if (query.availability !== undefined) {
    const value = query.availability;
    if (value !== 'UNKNOWN' && value !== 'AVAILABLE' && value !== 'UNAVAILABLE') invalidInput();
    filters.availability = value;
  }
  if (query.limit !== undefined) {
    const value = query.limit as string;
    if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) invalidInput();
    filters.limit = Number(value);
  }
  if (query.cursor !== undefined) filters.cursor = productKey(query.cursor);
  return filters;
}

/** Express 4 requires explicit forwarding of rejected async handlers. */
function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve().then(() => handler(request, response, next)).catch(next);
  };
}

export function createCatalogRouter(prisma?: CatalogPrisma): Router {
  const router = Router();
  const service = prisma ? createCatalogService(prisma) : undefined;
  function catalog() {
    if (!service) throw new AppError(503, 'CATALOG_UNAVAILABLE', 'Catálogo temporariamente indisponível.');
    return service;
  }
  router.get('/categories', asyncRoute(async (request, response) => {
    validateQuery(request.query, []);
    response.json({ success: true, data: await catalog().listCategories() });
  }));
  router.get('/products', asyncRoute(async (request, response) => {
    const filters = parseFilters(request.query);
    response.json({ success: true, data: await catalog().listProducts(filters) });
  }));
  router.get('/products/:productId', asyncRoute(async (request, response) => {
    validateQuery(request.query, []);
    const id = productKey(request.params.productId);
    response.json({ success: true, data: await catalog().getProduct(id) });
  }));
  return router;
}
