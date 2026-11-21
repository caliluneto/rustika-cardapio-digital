import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { adminProductSelect, mapAdminProduct } from '../mappers/catalog.mapper';
import type { AdminProductRecord } from '../mappers/catalog.mapper';
import { AppError } from '../middleware/errorHandler';
import { publicProductWhere } from './catalog.service';
import type { createAdminAuth } from './adminAuth.service';
import { accessBody } from './adminAuth.service';

/**
 *  disponibilidade de produtos decidida pelo estabelecimento.
 *
 * Fonte da verdade: `Product.availabilityState` (UNKNOWN | AVAILABLE | UNAVAILABLE). O pedido exige AVAILABLE e o
 * catálogo público já mapeia UNKNOWN→null, AVAILABLE→true, UNAVAILABLE→false. A coluna legada `isAvailable`
 * (boolean, padrão true) NÃO é lida nem escrita por esta operação (nem recebe privilégio): é histórica e pode divergir.
 * Só é gerenciável o que o catálogo pode publicar (`publicProductWhere`); nada aqui reativa produto, abre insumo
 * interno ou altera preço, categoria, chaves, estoque ou pedidos.
 *
 * Transições: de qualquer estado para AVAILABLE ou UNAVAILABLE, desde que diferente do atual. UNKNOWN nunca é alvo
 * (só a importação o produz). Concorrência: compare-and-set por `expectedState` em transação Serializable.
 */
export const ADMIN_PRODUCT_LIST_LIMIT = 500;
export const SETTABLE_AVAILABILITY = ['AVAILABLE', 'UNAVAILABLE'] as const;
const STATES = ['UNKNOWN', 'AVAILABLE', 'UNAVAILABLE'] as const;
export type AvailabilityState = (typeof STATES)[number];
const PRODUCT_ID = /^rustika-[0-9A-Z]{1,64}$/;

type ProductOpsDb = Pick<PrismaClient, 'product' | '$transaction'>;
type AdminAuth = ReturnType<typeof createAdminAuth>;

export interface AvailabilityUpdate { expectedState: AvailabilityState; toState: AvailabilityState }

export function parseProductId(raw: unknown): string {
  if (typeof raw !== 'string' || !PRODUCT_ID.test(raw)) throw new AppError(400, 'INVALID_PRODUCT_ID', 'Identificador de produto inválido.');
  return raw;
}

const asState = (value: unknown): AvailabilityState => {
  if (typeof value !== 'string' || !(STATES as readonly string[]).includes(value)) {
    throw new AppError(400, 'INVALID_AVAILABILITY', 'Estado de disponibilidade inválido.');
  }
  return value as AvailabilityState;
};

/** Corpo estrito: exatamente `expectedState` e `toState`; qualquer outro campo é rejeitado. */
export function parseAvailabilityUpdate(raw: unknown): AvailabilityUpdate {
  const body = accessBody(raw, ['expectedState', 'toState']);
  if (!('expectedState' in body) || !('toState' in body)) throw new AppError(400, 'INVALID_INPUT', 'Informe expectedState e toState.');
  return { expectedState: asState(body.expectedState), toState: asState(body.toState) };
}

/** Espelho em JS de `publicProductWhere`, usado para decidir 422 depois de achar o produto. */
export function isManageable(record: AdminProductRecord): boolean {
  return record.isActive && record.publicKey !== null && !!record.sourceCode && !!record.sourceName?.trim() &&
    !!record.sourceGroup?.trim() && record.category.isActive && record.category.publicKey !== null;
}

const retryable = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

export function createProductAvailability(prisma: ProductOpsDb, auth: AdminAuth) {
  return {
    /** Sem parâmetros (o roteador administrativo proíbe query string): filtros e busca ficam no cliente. */
    async list(token: string | undefined) {
      await auth.authenticate(token);
      const records = await prisma.product.findMany({
        where: publicProductWhere(), select: adminProductSelect,
        orderBy: [{ category: { displayOrder: 'asc' } }, { category: { publicKey: 'asc' } }, { publicKey: 'asc' }],
        take: ADMIN_PRODUCT_LIST_LIMIT + 1,
      });
      return { truncated: records.length > ADMIN_PRODUCT_LIST_LIMIT, products: records.slice(0, ADMIN_PRODUCT_LIST_LIMIT).map(mapAdminProduct) };
    },

    async updateAvailability(rawProductId: unknown, rawBody: unknown, token: string | undefined) {
      await auth.authenticate(token); // 401 antes de qualquer validação de entrada
      const productId = parseProductId(rawProductId);
      const update = parseAvailabilityUpdate(rawBody);
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            await auth.authenticate(token, tx); // reautentica dentro da transação
            const current = await tx.product.findUnique({ where: { publicKey: productId }, select: adminProductSelect });
            if (!current) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
            if (!isManageable(current)) {
              throw new AppError(422, 'PRODUCT_NOT_MANAGEABLE', 'Este produto não é comercializável pelo cardápio digital e não pode ter a disponibilidade alterada.');
            }
            if (current.availabilityState !== update.expectedState) {
              throw new AppError(409, 'AVAILABILITY_CONFLICT', `A disponibilidade já é ${current.availabilityState}. Atualize a lista e tente novamente.`);
            }
            if (!(SETTABLE_AVAILABILITY as readonly string[]).includes(update.toState) || update.toState === current.availabilityState) {
              throw new AppError(422, 'INVALID_TRANSITION', 'Mudança de disponibilidade não permitida.');
            }
            const changed = await tx.product.updateMany({
              where: { publicKey: productId, availabilityState: update.expectedState }, data: { availabilityState: update.toState },
            });
            if (changed.count !== 1) {
              throw new AppError(409, 'AVAILABILITY_CONFLICT', 'O produto foi alterado por outra operação. Atualize a lista e tente novamente.');
            }
            const product = await tx.product.findUnique({ where: { publicKey: productId }, select: adminProductSelect });
            if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
            return { product: mapAdminProduct(product) };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
        } catch (error) {
          if (retryable(error)) {
            if (attempt < 2) continue;
            throw new AppError(409, 'PRODUCT_CONFLICT', 'Não foi possível concluir a atualização. Atualize a lista e tente novamente.');
          }
          throw error;
        }
      }
    },
  };
}
