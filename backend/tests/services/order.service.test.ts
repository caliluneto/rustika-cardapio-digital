import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { createOrderService } from '../../src/services/order.service';
import { sha256 } from '../../src/services/orderSession';
import { body, conflict, KEY, mockOrderPrisma, NOW, product, TOKEN } from '../fixtures/orders';

function setup() {
  const mock = mockOrderPrisma();
  return { ...mock, service: createOrderService(mock.prisma, () => NOW) };
}

describe('criação transacional de pedidos', () => {
  it('calcula preços do catálogo e grava itens, snapshots e histórico com número gerado', async () => {
    const mock = setup();
    mock.products.push(product({ id: 'product-2', publicKey: 'rustika-3', sourceCode: '3', name: 'Cerveja', price: new Prisma.Decimal('14.99') }));
    const input = body();
    input.items.push({ productId: 'rustika-3', quantity: 3, expectedUnitPriceInCents: 1499 });
    const result = await mock.service.createOrder(input, TOKEN, KEY);
    expect(result).toMatchObject({ replayed: false, order: {
      orderNumber: 42, customerName: 'Ana Silva', comandaNumber: '000123', status: 'RECEIVED', totalInCents: 16495,
      items: [{ productId: 'rustika-131', unitPriceInCentsSnapshot: 5999, subtotalInCents: 11998 }, { productId: 'rustika-3', unitPriceInCentsSnapshot: 1499, subtotalInCents: 4497 }],
    } });
    expect(result.order.createdAt).toBe(NOW.toISOString());
    expect(mock.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
    const data = mock.orderCreate.mock.calls[0]?.[0].data;
    expect(data.totalAmount.toString()).toBe('164.95');
    expect(data.items.create[0].subtotal.toString()).toBe('119.98');
    expect(data.items.create[0].productNameSnapshot).toBe('Frios');
    expect(data.items.create[0].productId).toBe(mock.products[0]!.id);
    expect(data.statusHistory).toEqual({ create: { fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null } });
    expect(data).not.toHaveProperty('orderNumber');
    expect(data.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(data.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(mock.committed.size).toBe(1);
    expect(mock.sessionFind).toHaveBeenCalledWith(expect.objectContaining({ where: { credentialHash: sha256(TOKEN) } }));
  });

  it('aceita produto público com código alfanumérico PA062240', async () => {
    const mock = setup();
    mock.products.push(product({
      id: 'product-pa062240', publicKey: 'rustika-PA062240', sourceCode: 'PA062240',
      name: 'Panceta', price: new Prisma.Decimal('50.00'),
    }));
    const input = body();
    input.items = [{ productId: 'rustika-PA062240', quantity: 1, expectedUnitPriceInCents: 5000 }];
    const result = await mock.service.createOrder(input, TOKEN, KEY);
    expect(result.order.totalInCents).toBe(5000);
    expect(result.order.items[0]).toMatchObject({
      productId: 'rustika-PA062240', unitPriceInCentsSnapshot: 5000, subtotalInCents: 5000,
    });
  });

  it('não confia em preço menor enviado pelo cliente nem cria pedido com preço alterado', async () => {
    const mock = setup();
    const input = body(); input.items[0]!.expectedUnitPriceInCents = 1;
    await expect(mock.service.createOrder(input, TOKEN, KEY)).rejects.toMatchObject({ statusCode: 409, code: 'PRICE_CHANGED' });
    expect(mock.orderCreate).not.toHaveBeenCalled();
  });

  it('recalcula pelo preço vigente após nova revisão do cliente', async () => {
    const mock = setup();
    mock.products[0]!.price = new Prisma.Decimal('60.01');
    const input = body(); input.items[0]!.expectedUnitPriceInCents = 6001;
    expect((await mock.service.createOrder(input, TOKEN, KEY)).order.totalInCents).toBe(12002);
  });

  it.each(['missing', 'inactive', 'category-inactive', 'category-private', 'private-product'])(
    'recusa produto inexistente/não público: %s', async (scenario) => {
      const mock = setup();
      if (scenario === 'missing') mock.products.length = 0;
      if (scenario === 'inactive') mock.products[0]!.isActive = false;
      if (scenario === 'category-inactive') mock.products[0]!.category.isActive = false;
      if (scenario === 'category-private') mock.products[0]!.category.publicKey = null;
      if (scenario === 'private-product') mock.products[0]!.sourceCode = null;
      await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
      expect(mock.orderCreate).not.toHaveBeenCalled();
    },
  );

  it.each(['UNAVAILABLE', 'UNKNOWN'] as const)('recusa disponibilidade %s', async (state) => {
    const mock = setup(); mock.products[0]!.availabilityState = state;
    await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 409, code: 'PRODUCT_UNAVAILABLE' });
    expect(mock.committed.size).toBe(0);
  });

  it.each([0, -1, 1.5, 100, '2', null])('rejeita quantidade %s antes de abrir transação', async (quantity) => {
    const mock = setup();
    await expect(mock.service.createOrder({ ...body(), items: [{ ...body().items[0], quantity }] }, TOKEN, KEY)).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it.each(['absent', 'revoked', 'expired', 'closed', 'cancelled', 'scope'])(
    'recusa sessão %s antes de consultar pedido ou catálogo', async (scenario) => {
      const mock = setup();
      if (scenario === 'absent') mock.sessionFind.mockResolvedValue(null);
      if (scenario === 'revoked') mock.session.revokedAt = NOW;
      if (scenario === 'expired') mock.session.expiresAt = NOW;
      if (scenario === 'closed') mock.session.comanda.status = 'CLOSED';
      if (scenario === 'cancelled') mock.session.comanda.status = 'CANCELLED';
      if (scenario === 'scope') mock.session.comanda.id = 'another-comanda';
      await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_SESSION' });
      expect(mock.orderFind).not.toHaveBeenCalled();
      expect(mock.productFind).not.toHaveBeenCalled();
      expect(mock.orderCreate).not.toHaveBeenCalled();
    },
  );

  it('revalida expiração antes da escrita', async () => {
    const mock = mockOrderPrisma(); let reads = 0;
    const service = createOrderService(mock.prisma, () => ++reads === 1 ? NOW : mock.session.expiresAt);
    await expect(service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.orderCreate).not.toHaveBeenCalled();
  });

  it('replay retorna mesmo pedido sem consultar preços ou inserir novamente', async () => {
    const mock = setup();
    const first = await mock.service.createOrder(body(), TOKEN, KEY);
    mock.products.length = 0;
    const second = await mock.service.createOrder(body(), TOKEN, KEY);
    expect(second).toEqual({ replayed: true, order: first.order });
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
    expect(mock.productFind).toHaveBeenCalledTimes(1);
    expect(mock.committed.size).toBe(1);
  });

  it('mesma chave com corpo diferente retorna conflito', async () => {
    const mock = setup(); await mock.service.createOrder(body(), TOKEN, KEY);
    await expect(mock.service.createOrder({ ...body(), customerName: 'Outro cliente' }, TOKEN, KEY)).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
  });

  it('replay continua exigindo sessão ativa', async () => {
    const mock = setup(); await mock.service.createOrder(body(), TOKEN, KEY);
    mock.session.revokedAt = NOW;
    await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.orderFind).toHaveBeenCalledTimes(1);
  });

  it('a mesma chave em outra sessão não recupera pedido alheio', async () => {
    const mock = setup(); await mock.service.createOrder(body(), TOKEN, KEY);
    mock.session.id = 'other-session';
    await mock.service.createOrder(body(), TOKEN, KEY);
    expect(mock.orderCreate).toHaveBeenCalledTimes(2);
    expect(mock.committed.size).toBe(2);
  });

  it('falha após a escrita simulada não retorna confirmação nem confirma o estágio da transação', async () => {
    const mock = setup(); mock.control.commitError = new Error('commit failed');
    await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toThrow('commit failed');
    expect(mock.orderCreate).toHaveBeenCalledTimes(1);
    expect(mock.committed.size).toBe(0);
    expect(mock.transaction).toHaveBeenCalledTimes(1);
  });

  it('erro na criação de itens/histórico é propagado sem replay automático', async () => {
    const mock = setup(); mock.orderCreate.mockRejectedValue(new Error('nested write failed'));
    await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toThrow();
    expect(mock.committed.size).toBe(0);
    expect(mock.transaction).toHaveBeenCalledTimes(1);
  });

  it.each([conflict(), conflict('P2002', { target: ['idempotency_key'] })])('repete apenas conflitos conhecidos de transação/idempotência', async (error) => {
    const mock = setup(); mock.transaction.mockRejectedValueOnce(error);
    expect((await mock.service.createOrder(body(), TOKEN, KEY)).order.orderNumber).toBe(42);
    expect(mock.transaction).toHaveBeenCalledTimes(2);
  });

  it('limita tentativas de conflitos serializáveis', async () => {
    const mock = setup(); mock.transaction.mockRejectedValue(conflict());
    await expect(mock.service.createOrder(body(), TOKEN, KEY)).rejects.toMatchObject({ statusCode: 409, code: 'ORDER_CONFLICT' });
    expect(mock.transaction).toHaveBeenCalledTimes(3);
  });

  it('teto monetário é validado após precificação do servidor', async () => {
    const mock = setup(); mock.products[0]!.price = new Prisma.Decimal('9999.99');
    const input = body(); input.items[0]!.expectedUnitPriceInCents = 999999;
    await expect(mock.service.createOrder(input, TOKEN, KEY)).rejects.toMatchObject({ statusCode: 422, code: 'LIMIT_EXCEEDED' });
    expect(mock.orderCreate).not.toHaveBeenCalled();
  });
});
