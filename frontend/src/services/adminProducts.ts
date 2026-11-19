import { ApiError } from './api';

/**
 * 3D.4.2 — gestão administrativa da disponibilidade de produtos. A API não aceita query string no roteador
 * administrativo, então a lista completa é baixada uma vez e busca/filtros são aplicados aqui, no cliente.
 * Somente a disponibilidade é editável: nada de preço, ativação, categoria ou chaves.
 */
export type AvailabilityState = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';

export const AVAILABILITY_LABEL: Record<AvailabilityState, string> = {
  UNKNOWN: 'Não confirmado',
  AVAILABLE: 'Disponível',
  UNAVAILABLE: 'Indisponível',
};
const STATES = Object.keys(AVAILABILITY_LABEL) as AvailabilityState[];

export interface AdminProduct {
  id: string;
  sourceCode: string;
  name: string;
  categoryId: string;
  categoryName: string;
  priceInCents: number;
  availabilityState: AvailabilityState;
  updatedAt: string;
  description?: string;
  ingredients?: string;
  imageUrl?: string;
  imageAlt?: string;
}
export interface AdminProductsSnapshot { products: AdminProduct[]; truncated: boolean }

/** Alvos permitidos: UNKNOWN nunca é escolha do operador. */
export type SettableAvailability = 'AVAILABLE' | 'UNAVAILABLE';

const PRODUCT_ID = /^rustika-[0-9A-Z]{1,64}$/;
const bad = () => new ApiError(200, 'INVALID_RESPONSE', 'A API respondeu em um formato inesperado.', null);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => { if (typeof value !== 'string') throw bad(); return value; };
const optionalText = (value: unknown): string | undefined => value === null || value === undefined ? undefined : text(value);
const cents = (value: unknown): number => { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw bad(); return value; };
const state = (value: unknown): AvailabilityState => { if (typeof value !== 'string' || !STATES.includes(value as AvailabilityState)) throw bad(); return value as AvailabilityState; };

export function parseAdminProduct(value: unknown): AdminProduct {
  if (!isRecord(value)) throw bad();
  const id = text(value.id);
  if (!PRODUCT_ID.test(id)) throw bad();
  return {
    id, sourceCode: text(value.sourceCode), name: text(value.name), categoryId: text(value.categoryId), categoryName: text(value.categoryName),
    priceInCents: cents(value.priceInCents), availabilityState: state(value.availabilityState), updatedAt: text(value.updatedAt),
    description: optionalText(value.description), ingredients: optionalText(value.ingredients),
    imageUrl: optionalText(value.imageUrl), imageAlt: optionalText(value.imageAlt),
  };
}

export interface ProductCrudResult {
  id: string;
  publicKey: string;
  sourceCode: string;
  sourceName: string;
  sourceGroup: string;
  name: string;
  priceInCents: number;
  categoryId: string;
  categoryName: string;
}

function parseProductCrudResult(value: unknown): ProductCrudResult {
  if (!isRecord(value)) throw bad();
  const publicKey = text(value.publicKey);
  if (!PRODUCT_ID.test(publicKey)) throw bad();
  return {
    id: text(value.id), publicKey, sourceCode: text(value.sourceCode), sourceName: text(value.sourceName),
    sourceGroup: text(value.sourceGroup), name: text(value.name), priceInCents: cents(value.priceInCents),
    categoryId: text(value.categoryId), categoryName: text(value.categoryName),
  };
}

export function parseProductsSnapshot(value: unknown): AdminProductsSnapshot {
  if (!isRecord(value) || !Array.isArray(value.products) || typeof value.truncated !== 'boolean') throw bad();
  return { products: value.products.map(parseAdminProduct), truncated: value.truncated };
}

interface AdminProductsTransport {
  getWithAuth<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>;
  patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>;
  httpDelete<T>(path: string, signal?: AbortSignal): Promise<T>;
}

export function createAdminProductsClient(transport: AdminProductsTransport) {
  return {
    async list(signal?: AbortSignal): Promise<AdminProductsSnapshot> {
      return parseProductsSnapshot(await transport.getWithAuth<unknown>('/admin/products', signal));
    },
    async create(body: {
      name: string;
      description?: string;
      ingredients?: string;
      priceInCents: number;
      categoryId: string;
      imageUrl?: string;
      imageAlt?: string;
    }, signal?: AbortSignal): Promise<ProductCrudResult> {
      if (body.priceInCents < 1 || body.priceInCents > 99_999_999) throw new ApiError(0, 'INVALID_PRICE', 'Preço em centavos deve estar entre 1 e 99.999.999.', null);
      
      const data = await transport.post<unknown>('/admin/products', body, signal);
      return parseProductCrudResult(data);
    },
    async updateAvailability(productId: string, change: { expectedState: AvailabilityState; toState: SettableAvailability }, signal?: AbortSignal): Promise<AdminProduct> {
      if (!PRODUCT_ID.test(productId)) throw new ApiError(0, 'INVALID_PRODUCT_ID', 'Identificador de produto inválido.', null);
      const body = { expectedState: change.expectedState, toState: change.toState };
      const data = await transport.patch<unknown>(`/admin/products/${productId}/availability`, body, signal);
      if (!isRecord(data)) throw bad();
      return parseAdminProduct(data.product);
    },
    async update(productId: string, body: {
      name?: string;
      description?: string;
      ingredients?: string;
      priceInCents?: number;
      categoryId?: string;
      imageUrl?: string;
      imageAlt?: string;
    }, signal?: AbortSignal): Promise<ProductCrudResult> {
      if (!PRODUCT_ID.test(productId)) throw new ApiError(0, 'INVALID_PRODUCT_ID', 'Identificador de produto inválido.', null);
      if (body.priceInCents !== undefined && (body.priceInCents < 1 || body.priceInCents > 99_999_999)) {
        throw new ApiError(0, 'INVALID_PRICE', 'Preço em centavos deve estar entre 1 e 99.999.999.', null);
      }
      const data = await transport.patch<unknown>(`/admin/products/${productId}`, body, signal);
      return parseProductCrudResult(data);
    },
    async httpDelete(productId: string, signal?: AbortSignal): Promise<{ deleted: boolean; reason?: string; message?: string }> {
      if (!PRODUCT_ID.test(productId)) throw new ApiError(0, 'INVALID_PRODUCT_ID', 'Identificador de produto inválido.', null);
      const data = await transport.httpDelete<unknown>(`/admin/products/${productId}`, signal);
      if (!isRecord(data) || typeof data.deleted !== 'boolean' ||
          (data.reason !== undefined && typeof data.reason !== 'string') ||
          (data.message !== undefined && typeof data.message !== 'string')) throw bad();
      return {
        deleted: data.deleted,
        ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
        ...(typeof data.message === 'string' ? { message: data.message } : {}),
      };
    },
  };
}
export type AdminProductsClient = ReturnType<typeof createAdminProductsClient>;

export interface ProductFilters { search: string; categoryId: string; availability: '' | AvailabilityState }
export const NO_FILTERS: ProductFilters = { search: '', categoryId: '', availability: '' };

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Busca por nome ou código (sem acento e sem diferenciar maiúsculas) + categoria + disponibilidade. */
export function filterProducts(products: AdminProduct[], filters: ProductFilters): AdminProduct[] {
  const term = fold(filters.search);
  return products.filter((product) =>
    (!term || fold(product.name).includes(term) || fold(product.sourceCode).includes(term))
    && (!filters.categoryId || product.categoryId === filters.categoryId)
    && (!filters.availability || product.availabilityState === filters.availability));
}

export function categoriesOf(products: AdminProduct[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const product of products) if (!seen.has(product.categoryId)) seen.set(product.categoryId, product.categoryName);
  return [...seen].map(([id, name]) => ({ id, name }));
}

/** Alvos oferecidos para cada estado atual: o servidor decide; a UI só evita cliques inúteis. */
export function offeredTargets(current: AvailabilityState): SettableAvailability[] {
  return current === 'AVAILABLE' ? ['UNAVAILABLE'] : current === 'UNAVAILABLE' ? ['AVAILABLE'] : ['AVAILABLE', 'UNAVAILABLE'];
}

export function confirmationMessage(product: AdminProduct, to: SettableAvailability): string {
  return `${product.name} (código ${product.sourceCode}): ${AVAILABILITY_LABEL[product.availabilityState]} → ${AVAILABILITY_LABEL[to]}. `
    + (to === 'UNAVAILABLE' ? 'Clientes não poderão pedir este produto. Confirmar?' : 'Clientes poderão pedir este produto. Confirmar?');
}

export function describeAvailabilityError(error: unknown): { message: string; conflict: boolean; unauthorized: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) return { message: 'Sua sessão expirou. Entre novamente.', conflict: false, unauthorized: true };
    if (error.status === 409) return { message: 'A disponibilidade deste produto foi alterada por outra pessoa. A lista foi atualizada; revise e tente novamente.', conflict: true, unauthorized: false };
    if (error.status === 422) return { message: 'Este produto não pode ter a disponibilidade alterada por aqui.', conflict: true, unauthorized: false };
    if (error.status === 404) return { message: 'Produto não encontrado. A lista foi atualizada.', conflict: true, unauthorized: false };
    if (error.status === 0) return { message: 'Falha de comunicação com o servidor. Verifique a conexão e tente novamente.', conflict: false, unauthorized: false };
    if (error.status === 429) return { message: error.message, conflict: false, unauthorized: false };
    if (error.status >= 500) return { message: 'O servidor não conseguiu concluir a operação. Tente novamente.', conflict: false, unauthorized: false };
  }
  return { message: 'Não foi possível atualizar a disponibilidade.', conflict: false, unauthorized: false };
}

export function describeProductsListError(error: unknown): { message: string; unauthorized: boolean } {
  if (error instanceof ApiError && error.status === 401) return { message: 'Sua sessão expirou. Entre novamente.', unauthorized: true };
  if (error instanceof ApiError && error.status === 0) return { message: 'Falha de comunicação com o servidor. Tente atualizar novamente.', unauthorized: false };
  return { message: 'Não foi possível carregar os produtos. Tente atualizar novamente.', unauthorized: false };
}
