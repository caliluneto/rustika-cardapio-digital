import type { Prisma, PrismaClient, ProductAvailability } from '@prisma/client';
import type { Category, Product } from '../domain/contracts';
import { categorySelect, productSelect, mapCategory, mapProduct } from '../mappers/catalog.mapper';
import { AppError } from '../middleware/errorHandler';

export type CatalogPrisma = Pick<PrismaClient, 'category' | 'product'>;
export interface ProductFilters {
  categoryId?: string;
  availability?: ProductAvailability;
  cursor?: string;
  limit: number;
}
export interface ProductPage {
  items: Product[];
  nextCursor: string | null;
}

const publicCategory = { isActive: true, publicKey: { not: null } } satisfies Prisma.CategoryWhereInput;

export function createCatalogService(prisma: CatalogPrisma) {
  function productWhere(filters: Pick<ProductFilters, 'categoryId' | 'availability'>): Prisma.ProductWhereInput {
    return {
      isActive: true, publicKey: { not: null },
      sourceCode: { not: null }, sourceName: { not: null }, sourceGroup: { not: null },
      category: { is: {
        ...publicCategory,
        ...(filters.categoryId ? { publicKey: filters.categoryId } : {}),
      } },
      ...(filters.availability ? { availabilityState: filters.availability } : {}),
    };
  }

  return {
    async listCategories(): Promise<Category[]> {
      const records = await prisma.category.findMany({
        where: publicCategory, select: categorySelect,
        orderBy: [{ displayOrder: 'asc' }, { publicKey: 'asc' }],
      });
      return records.map(mapCategory);
    },

    async listProducts(filters: ProductFilters): Promise<ProductPage> {
      const where = productWhere(filters);
      if (filters.cursor) {
        const cursor = await prisma.product.findFirst({
          where: { ...where, publicKey: filters.cursor }, select: { publicKey: true },
        });
        if (!cursor) throw new AppError(400, 'INVALID_CURSOR', 'Cursor inválido para os filtros informados.');
      }
      const records = await prisma.product.findMany({
        where, select: productSelect,
        orderBy: [{ category: { displayOrder: 'asc' } }, { category: { publicKey: 'asc' } }, { publicKey: 'asc' }],
        take: filters.limit + 1,
        ...(filters.cursor ? { cursor: { publicKey: filters.cursor }, skip: 1 } : {}),
      });
      const items = records.slice(0, filters.limit).map(mapProduct);
      return {
        items,
        nextCursor: records.length > filters.limit ? items[items.length - 1]?.id ?? null : null,
      };
    },

    async getProduct(productId: string): Promise<Product> {
      const record = await prisma.product.findFirst({
        where: { ...productWhere({}), publicKey: productId }, select: productSelect,
      });
      if (!record) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
      return mapProduct(record);
    },
  };
}
