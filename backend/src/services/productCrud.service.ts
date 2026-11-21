import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { accessBody } from '../services/adminAuth.service';

type ProductOpsDb = Pick<PrismaClient, 'product' | '$transaction' | 'orderItem' | 'category'>;

interface ProductCreateInput {
  name: string;
  description?: string | null;
  ingredients?: string | null;
  priceInCents: number;
  categoryId: string; // publicKey da categoria (ex: 'frios', 'bebidas')
  imageUrl?: string | null;
  imageAlt?: string | null;
}

interface ProductUpdateInput {
  name?: string;
  description?: string | null;
  ingredients?: string | null;
  priceInCents?: number;
  imageUrl?: string | null;
  imageAlt?: string | null;
}

interface ProductCrudDto {
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

interface ProductDeleteResult {
  deleted: boolean;
  reason?: string;
  message?: string;
}

const PRODUCT_ID = /^rustika-[0-9A-Z]{1,64}$/;
const MAX_PRICE_IN_CENTS = 99_999_999;
const SOURCE_CODE_MAX_LENGTH = 64;

function validateProductId(raw: unknown): string {
  if (typeof raw !== 'string' || !PRODUCT_ID.test(raw)) throw new AppError(400, 'INVALID_PRODUCT_ID', 'Identificador de produto inválido.');
  return raw;
}

function validatePriceInCents(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > MAX_PRICE_IN_CENTS) {
    throw new AppError(400, 'INVALID_PRICE', `Preço em centavos inválido. Deve ser inteiro entre 1 e ${MAX_PRICE_IN_CENTS}.`);
  }
}

function validateName(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new AppError(400, 'INVALID_INPUT', 'Nome é obrigatório.');
}

function validateOptionalText(value: unknown): asserts value is string | null | undefined {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new AppError(400, 'INVALID_INPUT', 'Dados da requisição inválidos.');
  }
}

function parseCreateInput(rawBody: unknown): ProductCreateInput {
  const body = accessBody(rawBody, [
    'name', 'description', 'ingredients', 'priceInCents', 'categoryId',
    'imageUrl', 'imageAlt',
  ]);

  validateName(body.name);
  validatePriceInCents(body.priceInCents);
  validateOptionalText(body.description);
  validateOptionalText(body.ingredients);
  validateOptionalText(body.imageUrl);
  validateOptionalText(body.imageAlt);
  if (typeof body.categoryId !== 'string') {
    throw new AppError(400, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada ou inativa.');
  }

  return {
    name: body.name.trim(),
    description: body.description,
    ingredients: body.ingredients,
    priceInCents: body.priceInCents,
    categoryId: body.categoryId,
    imageUrl: body.imageUrl,
    imageAlt: body.imageAlt,
  };
}

function parseUpdateInput(rawBody: unknown): ProductUpdateInput {
  const body = accessBody(rawBody, [
    'name', 'description', 'ingredients', 'priceInCents', 'imageUrl', 'imageAlt',
  ]);

  if (body.name !== undefined) validateName(body.name);
  if (body.priceInCents !== undefined) validatePriceInCents(body.priceInCents);
  validateOptionalText(body.description);
  validateOptionalText(body.ingredients);
  validateOptionalText(body.imageUrl);
  validateOptionalText(body.imageAlt);

  return {
    name: typeof body.name === 'string' ? body.name.trim() : undefined,
    description: body.description,
    ingredients: body.ingredients,
    priceInCents: body.priceInCents,
    imageUrl: body.imageUrl,
    imageAlt: body.imageAlt,
  };
}

/**
 * Gera um sourceCode a partir do nome do produto, seguindo o padrão do catálogo público:
 * apenas [0-9A-Z]{1,64}, maiúsculo, sem acentos ou símbolos.
 * Em caso de colisão, anexa um sufixo numérico.
 */
function generateSourceCode(name: string, existingCodes: Set<string>): string {
  const base = name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, SOURCE_CODE_MAX_LENGTH);

  if (!base || existingCodes.has(base)) {
    // Fallback: usar timestamp curto + contador para garantir unicidade
    const fallback = `MANUAL${Date.now().toString(36).toUpperCase().slice(-6)}`;
    if (!existingCodes.has(fallback)) return fallback;
    let i = 1;
    while (existingCodes.has(`${fallback}${i}`)) i++;
    return `${fallback}${i}`;
  }

  let code = base;
  let i = 1;
  while (existingCodes.has(code)) {
    const suffix = String(i);
    code = base.slice(0, SOURCE_CODE_MAX_LENGTH - suffix.length) + suffix;
    i++;
  }
  return code;
}

/**
 * Executa uma transação Serializable com retry automático em caso de conflito de
 * serialização (P2034). Após esgotar as tentativas, lança 409 PRODUCT_CONFLICT.
 */
async function serializableTransaction<T>(
  prisma: ProductOpsDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: any) {
      // Apenas conflitos de serialização (P2034) são retryáveis; outros erros (AppError etc.)
      // são lançados imediatamente.
      if (error?.code !== 'P2034') throw error;
      if (attempt === maxAttempts - 1) {
        throw new AppError(409, 'PRODUCT_CONFLICT', 'Não foi possível concluir a atualização. Atualize a lista e tente novamente.');
      }
    }
  }
  throw new AppError(409, 'PRODUCT_CONFLICT', 'Não foi possível concluir a atualização. Atualize a lista e tente novamente.');
}

/**
 * Converte centavos (inteiro) para Prisma.Decimal com precisão exata,
 * evitando arredondamento silencioso por ponto flutuante JavaScript.
 */
function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

function decimalToCents(decimal: Prisma.Decimal): number {
  const cents = decimal.mul(100);
  if (!cents.isFinite() || !cents.isInteger() || cents.isNegative() ||
      cents.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Preço armazenado com precisão inválida.');
  }
  return cents.toNumber();
}

const productCrudResultSelect = {
  id: true,
  publicKey: true,
  sourceCode: true,
  sourceName: true,
  sourceGroup: true,
  name: true,
  price: true,
  category: { select: { publicKey: true, name: true } },
} satisfies Prisma.ProductSelect;

type ProductCrudResult = Prisma.ProductGetPayload<{ select: typeof productCrudResultSelect }>;

function toProductCrudDto(product: ProductCrudResult): ProductCrudDto {
  if (!product.publicKey || !product.sourceCode || !product.sourceName || !product.sourceGroup ||
      !product.category.publicKey) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Produto armazenado não satisfaz o contrato administrativo.');
  }

  return {
    id: product.id,
    publicKey: product.publicKey,
    sourceCode: product.sourceCode,
    sourceName: product.sourceName,
    sourceGroup: product.sourceGroup,
    name: product.name,
    priceInCents: decimalToCents(product.price),
    categoryId: product.category.publicKey,
    categoryName: product.category.name,
  };
}

/**
 * CRUD administrativo completo de produtos.
 *
 * Identidade do produto:
 *   - id (UUID interno): chave primária, nunca exposta no DTO público.
 *   - publicKey (rustika-<sourceCode>): identificador público exposto nas rotas admin.
 *   - sourceCode/sourceName/sourceGroup: identificadores de origem, gerados pelo servidor
 *     para produtos manuais; nunca aceitos nem alterados pelo formulário admin.
 *
 * Regras-chave:
 *   - Autenticação admin obrigatória (middleware).
 *   - Proteção Origin/CSRF via writeGuard + X-Rustika-Request.
 *   - Rate limit via accessLimit.
 *   - Validação estrita de payloads (accessBody com allowlist).
 *   - Preço em centavos: inteiro positivo, 1 a 99.999.999, conversão exata para Decimal.
 *   - Produto referenciado em order_items não pode ser excluído (onDelete: Restrict).
 *   - Unicidade de nome por categoria, protegida por transação Serializable.
 *   - Edição parcial: apenas campos presentes são atualizados.
 *   - Concorrência: transação Prisma Serializable para create e update.
 */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createProductCrud(
  prisma: ProductOpsDb,
  auth: { authenticate: (token: string | undefined, db?: Pick<PrismaClient, 'admin'>) => Promise<unknown> },
) {
  return {
    /**
     * POST /api/admin/products
     * Corpo: { name, description?, ingredients?, priceInCents, categoryId, imageUrl?, imageAlt? }
     * categoryId é a publicKey da categoria (ex: 'frios'), não o UUID interno.
     */
    async create(rawBody: unknown, token: string | undefined): Promise<ProductCrudDto> {
      await auth.authenticate(token);
      const body = parseCreateInput(rawBody);
      const { name } = body;
      const categoryPublicKey = body.categoryId;

      // Criar dentro de transação Serializable atômica (categoria, códigos e sessão revalidados na mesma visão)
      const result = await serializableTransaction<ProductCrudResult>(prisma, async (tx) => {
        await auth.authenticate(token, tx);
        const category = await tx.category.findFirst({
          where: { publicKey: categoryPublicKey, isActive: true },
          select: { id: true, publicKey: true, name: true },
        });
        if (!category) throw new AppError(400, 'CATEGORY_NOT_FOUND', 'Categoria não encontrada ou inativa.');

        const existingProducts = await tx.product.findMany({
          select: { sourceCode: true },
        });
        const existingCodes = new Set(existingProducts.map((p) => p.sourceCode).filter((c): c is string => Boolean(c)));

        const sourceCode = generateSourceCode(name, existingCodes);
        const publicKey = `rustika-${sourceCode}`;
        const sourceName = name;
        const sourceGroup = category.name.toUpperCase();

        // Re-verificar unicidade de nome dentro da categoria dentro da transação
        const existingByName = await tx.product.findFirst({
          where: { name, categoryId: category.id },
        });
        if (existingByName) throw new AppError(409, 'DUPLICATE_PRODUCT', 'Já existe um produto com este nome nesta categoria.');

        // Re-verificar que o sourceCode gerado não colidiu (concorrência)
        const existingByCode = await tx.product.findFirst({
          where: { sourceCode },
        });
        if (existingByCode) throw new AppError(409, 'DUPLICATE_PRODUCT', `Código de origem "${sourceCode}" já está em uso.`);

        return await tx.product.create({
          data: {
            publicKey,
            sourceCode,
            sourceName,
            sourceGroup,
            name,
            description: normalizeOptionalText(body.description),
            ingredients: normalizeOptionalText(body.ingredients),
            price: centsToDecimal(body.priceInCents),
            categoryId: category.id,
            availabilityState: 'UNKNOWN',
            imageUrl: normalizeOptionalText(body.imageUrl),
            imageAlt: normalizeOptionalText(body.imageAlt),
            isActive: true,
          },
          select: productCrudResultSelect,
        });
      });
      return toProductCrudDto(result);
    },

    /**
     * PATCH /api/admin/products/:productId
     * Corpo parcial: apenas campos presentes são atualizados.
     * Campos de identidade (sourceCode, sourceName, sourceGroup, publicKey, categoryId) são imutáveis.
     */
    async update(productId: string, rawBody: unknown, token: string | undefined): Promise<ProductCrudDto> {
      await auth.authenticate(token);

      const validPublicKey = validateProductId(productId);
      const body = parseUpdateInput(rawBody);

      // Buscar produto por publicKey para obter o UUID interno
      const current = await prisma.product.findUnique({
        where: { publicKey: validPublicKey },
        select: {
          id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
          name: true, price: true, availabilityState: true, isActive: true,
          category: { select: { id: true, publicKey: true, name: true, isActive: true } },
        },
      });
      if (!current) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');

      // Verificar se produto é gerenciável pelo catálogo
      if (!current.isActive || !current.publicKey || !current.sourceCode || !current.sourceName?.trim() ||
          !current.sourceGroup?.trim() || !current.category.isActive || !current.category.publicKey) {
        throw new AppError(422, 'PRODUCT_NOT_MANAGEABLE', 'Este produto não pode ser modificado pelo cardápio digital.');
      }

      // Atualizar dentro de transação Serializable para proteger unicidade de nome/categoria
      const result = await serializableTransaction<ProductCrudResult>(prisma, async (tx) => {
        await auth.authenticate(token, tx);
        // Re-buscar dentro da transação para detectar alterações concorrentes
        const fresh = await tx.product.findUnique({
          where: { publicKey: validPublicKey },
          select: { id: true, name: true, categoryId: true },
        });
        if (!fresh) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');

        // Verificar unicidade de nome se o nome está sendo alterado
        if (body.name !== undefined) {
          const newName = body.name;
          if (newName !== fresh.name) {
            const existing = await tx.product.findFirst({
              where: { name: newName, categoryId: fresh.categoryId },
            });
            if (existing) throw new AppError(409, 'DUPLICATE_PRODUCT', 'Já existe um produto com este nome nesta categoria.');
          }
        }

        // Construir dados de update (apenas campos presentes no body)
        const updateData: Prisma.ProductUpdateInput = {};
        if (body.name !== undefined) updateData.name = body.name;
        if (body.description !== undefined) updateData.description = normalizeOptionalText(body.description);
        if (body.ingredients !== undefined) updateData.ingredients = normalizeOptionalText(body.ingredients);
        if (body.priceInCents !== undefined) updateData.price = centsToDecimal(body.priceInCents);
        if (body.imageUrl !== undefined) updateData.imageUrl = normalizeOptionalText(body.imageUrl);
        if (body.imageAlt !== undefined) updateData.imageAlt = normalizeOptionalText(body.imageAlt);

        return await tx.product.update({
          where: { publicKey: validPublicKey },
          data: updateData,
          select: productCrudResultSelect,
        });
      });
      return toProductCrudDto(result);
    },

    /**
     * DELETE /api/admin/products/:productId
     * Bloqueia exclusão se produto tiver referências em order_items.
     * Retorna 409 PRODUCT_REFERENCED quando houver histórico.
     * Preserva snapshots e dados históricos dos pedidos.
     */
    async delete(productId: string, token: string | undefined): Promise<ProductDeleteResult> {
      await auth.authenticate(token);

      const validPublicKey = validateProductId(productId);

      // Buscar produto por publicKey para obter o UUID interno
      const current = await prisma.product.findUnique({
        where: { publicKey: validPublicKey },
        select: { id: true, name: true, publicKey: true },
      });
      if (!current) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');

      // Verificar referências em order_items usando o UUID interno (product_id FK -> products.id)
      const orderItemsCount = await prisma.orderItem.count({ where: { productId: current.id } });
      if (orderItemsCount > 0) {
        return {
          deleted: false,
          reason: 'PRODUCT_REFERENCED',
          message: `Não é possível excluir "${current.name}": o produto está referenciado em ${orderItemsCount} item(ns) de pedido(s) existente(s).`,
        };
      }

      // Tentar exclusão pelo UUID interno
      try {
        await prisma.product.delete({
          where: { id: current.id },
        });
        return { deleted: true, reason: undefined };
      } catch (error: any) {
        // P2003 = Foreign key constraint violation (onDelete: Restrict)
        if (error?.code === 'P2003' || (error instanceof Error && error.message?.includes('Foreign key constraint'))) {
          return {
            deleted: false,
            reason: 'PRODUCT_REFERENCED',
            message: `Não é possível excluir "${current.name}": o produto está referenciado em pedidos existentes.`,
          };
        }
        if (error instanceof Error && error.message?.includes('Record to delete not found')) {
          throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Produto não encontrado.');
        }
        throw new AppError(500, 'INTERNAL_ERROR', 'Erro ao excluir produto.');
      }
    },
  };
}

export type { ProductCreateInput, ProductUpdateInput, ProductDeleteResult };
