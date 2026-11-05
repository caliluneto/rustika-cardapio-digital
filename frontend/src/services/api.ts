import type { CatalogData, Category, Product } from '../types/catalog';
import {
  adaptCategory,
  adaptProduct,
  categoryId as validateCategoryId,
  invalidCatalog,
  productId as validateProductId,
} from './catalogAdapter';

const DEFAULT_API_URL = 'http://localhost:4000/api';

/** Literal `import.meta.env` is required for Vite to inject VITE_* (see orderSubmission.ts, 3D.3.21-A). */
export function configuredApiUrl(env: { VITE_API_URL?: string } | undefined = import.meta.env): string {
  const configured = env?.VITE_API_URL?.trim();
  return configured || DEFAULT_API_URL;
}

export const API_BASE_URL = configuredApiUrl().replace(/\/+$/, '');

export type AvailabilityFilter = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';

export interface ProductQuery {
  categoryId?: string;
  availability?: AvailabilityFilter;
  signal?: AbortSignal;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}

export const WRITE_HEADER = 'X-Rustika-Request';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OrderRequest {
  customerName: string;
  customerPhone?: string;
  tableOrReference?: string;
  notes?: string;
  items: { productId: string; quantity: number; expectedUnitPriceInCents: number; notes?: string }[];
}

export interface OrderConfirmation {
  orderNumber: number;
  status: string;
  comandaNumber: string;
  customerName: string;
  totalInCents: number;
  [key: string]: unknown;
}

/** Error of an authenticated call: HTTP status (0 for network/timeout), backend code and Retry-After. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Network failures, timeouts, 5xx, 429 and ORDER_CONFLICT can be retried with the same Idempotency-Key. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.code === 'ORDER_CONFLICT';
  }
}

const DEFAULT_STATUS_MESSAGES: Record<number, string> = {
  401: 'Sua sessão expirou ou não é válida. Entre novamente.',
  403: 'A requisição foi bloqueada pela proteção de origem. Recarregue a página.',
  409: 'Não foi possível concluir: os dados mudaram. Revise e tente novamente.',
  429: 'Muitas tentativas. Aguarde antes de tentar novamente.',
};

function apiErrorFrom(response: ResponseLike, payload: unknown): ApiError {
  const retryHeader = response.headers?.get('Retry-After') ?? null;
  const retryAfter = retryHeader !== null && /^[0-9]{1,6}$/.test(retryHeader.trim()) ? Number(retryHeader.trim()) : null;
  const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string' ? payload.error.code : `HTTP_${response.status}`;
  let message = errorMessage(payload) ?? DEFAULT_STATUS_MESSAGES[response.status] ?? `A API respondeu com HTTP ${response.status}.`;
  if (response.status === 429 && retryAfter !== null) message = `${message} Tente novamente em ${retryAfter} s.`;
  return new ApiError(response.status, code, message, retryAfter);
}

export type Fetcher = (url: string, init: RequestInit) => Promise<ResponseLike>;

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export interface HealthData {
  status: string;
  service: string;
  timestamp: string;
  uptime: number;
}

export interface HealthResponse {
  success: boolean;
  data: HealthData;
}

class HttpResponseError extends Error {
  constructor(status: number) {
    super(`A API respondeu com HTTP ${status}.`);
    this.name = 'HttpResponseError';
  }
}

class InvalidPayloadError extends Error {
  constructor() {
    super('A API retornou um catálogo inválido. Tente carregar novamente.');
    this.name = 'InvalidPayloadError';
  }
}

function abortError(): DOMException {
  return new DOMException('Requisição cancelada.', 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function envelopeData(value: unknown): unknown {
  if (!isRecord(value) || value.success !== true || !Object.prototype.hasOwnProperty.call(value, 'data')) {
    invalidCatalog();
  }
  return value.data;
}

async function readJson(response: ResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new InvalidPayloadError();
  }
}

async function safeJson(response: ResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== 'string') return undefined;
  return value.error.message.trim() || undefined;
}

function requestHeaders(init?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init) return headers;
  if (Array.isArray(init)) {
    for (const [key, value] of init) headers[key] = value;
  } else if (typeof Headers !== 'undefined' && init instanceof Headers) {
    init.forEach((value, key) => { headers[key] = value; });
  } else {
    for (const [key, value] of Object.entries(init)) headers[key] = value;
  }
  return headers;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? API_BASE_URL).trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Configuração da API inválida.');
  const fetcher: Fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? 15000;

  async function request(method: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<ResponseLike> {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetcher(`${baseUrl}${path}`, { ...init, method, signal: controller.signal });
    } catch {
      if (timedOut) throw new Error('A API demorou para responder. Tente novamente.');
      if (signal?.aborted) throw abortError();
      throw new Error('Não foi possível acessar a API. Verifique a conexão e tente novamente.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function readEnvelope(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await request('GET', path, { headers: { Accept: 'application/json' } }, signal);
    if (!response.ok) throw new HttpResponseError(response.status);
    return envelopeData(await readJson(response));
  }

  function parseCategories(value: unknown): Category[] {
    if (!Array.isArray(value)) invalidCatalog();
    const categories = value.map(adaptCategory);
    const ids = new Set<string>();
    for (const category of categories) {
      if (ids.has(category.id)) invalidCatalog();
      ids.add(category.id);
    }
    return categories.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  }

  function parsePage(value: unknown): { items: unknown[]; nextCursor: string | null } {
    if (!isRecord(value) || !Array.isArray(value.items)) invalidCatalog();
    if (value.nextCursor !== null && typeof value.nextCursor !== 'string') invalidCatalog();
    if (typeof value.nextCursor === 'string') validateProductId(value.nextCursor);
    return { items: value.items, nextCursor: value.nextCursor as string | null };
  }

  async function getCategories(signal?: AbortSignal): Promise<Category[]> {
    return parseCategories(await readEnvelope('/categories', signal));
  }

  async function getAllProducts(query: ProductQuery = {}): Promise<Product[]> {
    if (query.categoryId !== undefined) validateCategoryId(query.categoryId);
    if (query.availability !== undefined && !['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE'].includes(query.availability)) {
      invalidCatalog();
    }

    const products: Product[] = [];
    const seenProducts = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
      const params = new URLSearchParams({ limit: '50' });
      if (query.categoryId !== undefined) params.set('categoryId', query.categoryId);
      if (query.availability !== undefined) params.set('availability', query.availability);
      if (cursor !== null) params.set('cursor', cursor);

      const page = parsePage(await readEnvelope(`/products?${params.toString()}`, query.signal));
      const items = page.items.map((item) => adaptProduct(item, baseUrl));
      if (page.nextCursor !== null && (items.length === 0 || page.nextCursor === cursor || seenCursors.has(page.nextCursor))) {
        invalidCatalog();
      }

      for (const product of items) {
        if (seenProducts.has(product.id)) invalidCatalog();
        seenProducts.add(product.id);
        products.push(product);
      }

      if (page.nextCursor === null) return products;
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    invalidCatalog();
  }

  async function getProduct(productId: string, signal?: AbortSignal): Promise<Product> {
    const id = validateProductId(productId);
    return adaptProduct(await readEnvelope(`/products/${encodeURIComponent(id)}`, signal), baseUrl);
  }

  async function getCatalog(signal?: AbortSignal): Promise<CatalogData> {
    const categories = await getCategories(signal);
    const products = await getAllProducts({ signal });
    const categoryIds = new Set(categories.map((category) => category.id));
    if (products.some((product) => !categoryIds.has(product.categoryId))) invalidCatalog();
    return { categories, products };
  }

  /**
   * Cookie-authenticated call. Credentials always travel as HttpOnly cookies set by the backend;
   * nothing is read from or written to localStorage. Network failures become ApiError('NETWORK').
   */
  async function authenticated<T>(method: 'GET' | 'POST', path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    let response: ResponseLike;
    try {
      response = await request(method, path, { ...init, credentials: 'include' }, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const message = error instanceof Error ? error.message : 'Não foi possível acessar a API.';
      throw new ApiError(0, /demorou/.test(message) ? 'TIMEOUT' : 'NETWORK', message, null);
    }
    if (response.status === 204) return undefined as T;
    const payload = await safeJson(response);
    if (!response.ok) throw apiErrorFrom(response, payload);
    if (!isRecord(payload) || payload.success !== true || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'A API respondeu em um formato inesperado.', null);
    }
    return payload.data as T;
  }

  /** Every backend POST is a cookie write: exact Origin (sent by the browser), JSON and X-Rustika-Request. */
  async function post<T = unknown>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    init?: RequestInit,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...requestHeaders(init?.headers),
      'Content-Type': 'application/json',
      [WRITE_HEADER]: '1',
    };
    return authenticated<T>('POST', path, { ...init, headers, body: JSON.stringify(body) }, signal);
  }

  async function getWithAuth<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    return authenticated<T>('GET', path, { headers: { Accept: 'application/json' } }, signal);
  }

  /** Sends an order. The caller owns the Idempotency-Key (see services/orderSubmission.ts). */
  async function createOrder(body: OrderRequest, idempotencyKey: string, signal?: AbortSignal): Promise<OrderConfirmation> {
    if (!UUID_V4.test(idempotencyKey)) throw new ApiError(0, 'INVALID_IDEMPOTENCY_KEY', 'Chave de envio inválida.', null);
    return post<OrderConfirmation>('/orders', body, signal, { headers: { 'Idempotency-Key': idempotencyKey } });
  }

  return { getCategories, getAllProducts, getProduct, getCatalog, post, getWithAuth, createOrder };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const api = createApiClient();

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    throw new Error(`A API respondeu com HTTP ${response.status}.`);
  }

  const body = (await response.json()) as Partial<HealthResponse>;

  if (body.success !== true || body.data?.status !== 'ok') {
    throw new Error('A API respondeu em um formato inesperado.');
  }

  return body as HealthResponse;
}
