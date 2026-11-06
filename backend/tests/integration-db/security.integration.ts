import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIntegrationGate } from './support/preflight';
import { ORIGIN, openSession, placeOrder, startHarness } from './support/harness';
import type { Harness } from './support/harness';

assertIntegrationGate(process.env);

let h: Harness;
let session: string;
let number: string;
const items = () => [{ productId: h.fx.products.numeric.publicKey!, quantity: 1, expectedUnitPriceInCents: h.fx.products.numeric.priceInCents }];

beforeAll(async () => {
  h = await startHarness();
  number = h.run.identity.comandas.open;
  session = await openSession(h.app(), h, number);
});
afterAll(async () => {
  const run = h?.run;
  await h?.stop();
  if (run) expect(await run.remaining()).toEqual({ admins: 0, categories: 0, products: 0, comandas: 0, orders: 0 });
});

const count = async () => (await h.run.ordersFor(number)).length;
const raw = (app: ReturnType<Harness['app']>) => request(app).post('/api/orders').set('Cookie', `rustika_session=${session}`)
  .set('Idempotency-Key', randomUUID()).set('Content-Type', 'application/json');

describe('segurança e concorrência com PostgreSQL real', () => {
  it.each([
    ['sem X-Rustika-Request', (r: request.Test) => r.set('Origin', ORIGIN)],
    ['X-Rustika-Request inválido', (r: request.Test) => r.set('Origin', ORIGIN).set('X-Rustika-Request', '0')],
    ['Origin inválida', (r: request.Test) => r.set('Origin', 'https://attacker.example').set('X-Rustika-Request', '1')],
    ['sem Origin', (r: request.Test) => r.set('X-Rustika-Request', '1')],
  ])('CSRF: %s → 403 e nada gravado', async (_label, mutate) => {
    const before = await count();
    const response = await mutate(raw(h.app())).send({ customerName: 'Cliente', items: items() });
    expect(response.status).toBe(403);
    expect(await count()).toBe(before);
  });

  it('sessão inexistente: 401 e nada gravado', async () => {
    const before = await count();
    const response = await placeOrder(h.app(), 'a'.repeat(64), items());
    expect(response.status).toBe(401);
    expect(await count()).toBe(before);
  });

  it('rate limiting por sessão com banco real: o excedente recebe 429 e não grava', async () => {
    const app = h.app({ perSession: { max: 2, windowMs: 60_000 } });
    const before = await count();
    expect((await placeOrder(app, session, items())).status).toBe(201);
    expect((await placeOrder(app, session, items())).status).toBe(201);
    const limited = await placeOrder(app, session, items());
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(await count()).toBe(before + 2);
  });

  it('requisições simultâneas com chaves diferentes: todas gravadas uma vez, números únicos', async () => {
    const app = h.app(); const before = await count();
    const responses = await Promise.all(Array.from({ length: 6 }, () => placeOrder(app, session, items())));
    const created = responses.filter((r) => r.status === 201);
    expect(created.length + responses.filter((r) => r.status === 409 && r.body.error.code === 'ORDER_CONFLICT').length).toBe(6);
    expect(new Set(created.map((r) => r.body.data.orderNumber)).size).toBe(created.length);
    expect(await count()).toBe(before + created.length);
  });

  it('proteção contra duplicados entre instâncias do app (limites em memória separados): mesma chave, um pedido', async () => {
    const key = randomUUID(); const before = await count();
    const [a, b] = await Promise.all([placeOrder(h.app(), session, items(), key), placeOrder(h.app(), session, items(), key)]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([201]));
    expect(await count()).toBe(before + 1);
  });

  it('a role da aplicação não consegue apagar pedidos nem alterar colunas além de status/updated_at (privilégios pós-migration 3D.4.1)', async () => {
    await expect(h.db.app.order.deleteMany({ where: { comanda: { number } } })).rejects.toThrow();
    // 3D.4.1: UPDATE só nas colunas status e updated_at. Qualquer outra coluna continua negada.
    await expect(h.db.app.order.updateMany({ where: { comanda: { number } }, data: { customerName: 'x' } })).rejects.toThrow();
    await expect(h.db.app.order.updateMany({ where: { comanda: { number } }, data: { totalAmount: 0 } })).rejects.toThrow();
    await expect(h.db.app.$executeRawUnsafe('TRUNCATE TABLE orders')).rejects.toThrow();
    await expect(h.db.app.$queryRawUnsafe('SELECT count(*) FROM _prisma_migrations')).rejects.toThrow();
  });

  /**
   * Matriz mínima aprovada na 3D.3.7 (seção 20.3). A 3D.3.10 preparou a migration
   * 20261104000000_runtime_least_privilege, mas ela ainda não foi aplicada: pelas ACLs lidas na
   * 3D.3.9, cardapio_test_app mantém INSERT/UPDATE/DELETE em admins/categories/products e o
   * default ACL concede DML a tabelas novas. Este teste deve falhar até a Operação C aplicar a
   * migration e as ACLs reais serem conferidas. Ele existe para tornar a lacuna visível na
   * primeira execução real, não para ser ajustado.
   */
  it('privilégios efetivos da role da aplicação conferem com a matriz mínima', async () => {
    const rows = await h.db.app.$queryRawUnsafe<{ table_name: string; privileges: string }[]>(
      `SELECT c.relname AS table_name, concat_ws(',',
         CASE WHEN has_table_privilege(c.oid, 'SELECT') THEN 'SELECT' END,
         CASE WHEN has_table_privilege(c.oid, 'INSERT') THEN 'INSERT' END,
         CASE WHEN has_table_privilege(c.oid, 'UPDATE') THEN 'UPDATE' END,
         CASE WHEN has_table_privilege(c.oid, 'DELETE') THEN 'DELETE' END,
         CASE WHEN has_table_privilege(c.oid, 'TRUNCATE') THEN 'TRUNCATE' END) AS privileges
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`);
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.privileges]))).toEqual({
      _prisma_migrations: '',
      admins: 'SELECT', categories: 'SELECT', products: 'SELECT',
      orders: 'SELECT,INSERT', order_items: 'SELECT,INSERT', order_status_history: 'SELECT,INSERT', comanda_sessions: 'SELECT,INSERT',
      comandas: 'SELECT,INSERT,UPDATE', comanda_invitations: 'SELECT,INSERT,UPDATE',
    });
  });

  it('UPDATE em orders é exclusivamente por coluna: apenas status e updated_at (3D.4.1)', async () => {
    const rows = await h.db.app.$queryRawUnsafe<{ attname: string; can_update: boolean }[]>(
      `SELECT a.attname, has_column_privilege(a.attrelid, a.attnum, 'UPDATE') AS can_update
       FROM pg_attribute a WHERE a.attrelid = 'public.orders'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY 1`);
    expect(rows.filter((row) => row.can_update).map((row) => row.attname)).toEqual(['status', 'updated_at']);
  });

  it('role de fixtures não acessa migrations, sequência nem cria objetos', async () => {
    const [row] = await h.db.fixtures.$queryRawUnsafe<{
      create_schema: boolean; migrations: boolean; sequence: boolean; create_db: boolean;
    }[]>(
      `SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS create_schema,
              has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT') AS migrations,
              has_sequence_privilege(current_user, 'public.orders_order_number_seq', 'USAGE') AS sequence,
              has_database_privilege(current_user, current_database(), 'CREATE') AS create_db`);
    expect(row).toEqual({ create_schema: false, migrations: false, sequence: false, create_db: false });
  });

  it('limpeza da execução remove somente as linhas desta execução', async () => {
    const remaining = await h.run.remaining();
    expect(remaining.orders).toBeGreaterThan(0); // há o que limpar; afterAll confere que tudo foi removido
  });
});
