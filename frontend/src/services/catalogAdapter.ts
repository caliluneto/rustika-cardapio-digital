import type { Category, Product } from '../types/catalog';

export function invalidCatalog(): never {
  throw new Error('A API retornou um catálogo inválido. Tente carregar novamente.');
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidCatalog();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') invalidCatalog();
  return value;
}

export function categoryId(value: unknown): string {
  const id = text(value);
  if (id.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) invalidCatalog();
  return id;
}

export function productId(value: unknown): string {
  const id = text(value);
  if (!/^rustika-[0-9A-Z]{1,64}$/.test(id)) invalidCatalog();
  return id;
}

export function adaptCategory(value: unknown): Category {
  const data = record(value);
  if (!Number.isSafeInteger(data.displayOrder)) invalidCatalog();
  return { id: categoryId(data.id), name: text(data.name), description: text(data.description), displayOrder: data.displayOrder as number };
}

/**
 * Absolute API base for resolving relative image paths. `VITE_API_URL=/api` (same-origin hosting, 3D.5.3-B) is resolved
 * against the page origin; without one (non-browser) the relative base cannot be resolved, so images are omitted.
 */
function absoluteBase(baseUrl: string): string | undefined {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(base)) return base;
  if (/^\/(?![/\\])/.test(base)) {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    if (origin && /^https?:\/\//i.test(origin)) return `${origin}${base}`;
  }
  return undefined;
}

/**
 * Relative image paths belong to the API host, not the Vite development server. Absolute values must be http(s) without
 * credentials. Relative values may not be protocol-relative (`//host/x`), contain backslashes (browsers treat `/\host`
 * as `//host`) or control characters, and must stay on the API origin after resolution.
 */
function imageUrl(value: string, baseUrl: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return undefined;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (!absolute && raw.startsWith('//')) return undefined;
  try {
    let url: URL;
    if (absolute) {
      url = new URL(raw);
    } else {
      const base = absoluteBase(baseUrl);
      if (!base) return undefined;
      url = new URL(raw, `${base}/`);
      if (url.origin !== new URL(base).origin) return undefined;
    }
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function adaptProduct(value: unknown, baseUrl: string): Product {
  const data = record(value);
  const id = productId(data.id);
  const sourceCode = text(data.sourceCode);
  if (id !== `rustika-${sourceCode}` || !Number.isSafeInteger(data.priceInCents) || (data.priceInCents as number) < 0 ||
      (data.isAvailable !== true && data.isAvailable !== false && data.isAvailable !== null)) invalidCatalog();
  const product: Product = {
    id, sourceCode, sourceName: text(data.sourceName), sourceGroup: text(data.sourceGroup),
    categoryId: categoryId(data.categoryId), name: text(data.name),
    priceInCents: data.priceInCents as number, isAvailable: data.isAvailable,
  };
  for (const key of ['description', 'descriptionSource', 'ingredients', 'imageAlt'] as const) {
    if (data[key] !== undefined) product[key] = text(data[key]);
  }
  if (data.imageUrl !== undefined) product.imageUrl = imageUrl(text(data.imageUrl), baseUrl);
  return product;
}

export function filterProducts(products: readonly Product[], selectedCategoryId: string | null): readonly Product[] {
  return selectedCategoryId === null ? products : products.filter((product) => product.categoryId === selectedCategoryId);
}
