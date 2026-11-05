import test from 'node:test';
import assert from 'node:assert';
import { createApiClient } from '../src/services/api.ts';

test('Simulação de fluxo completo: Login, Convite, Resgate e Pedido', async () => {
  let requestLog = [];
  
  const mockFetcher = async (url, options) => {
    const { method, body } = options;
    const path = url.replace('http://localhost:4000/api', '');
    const parsedBody = body ? JSON.parse(body) : null;
    
    requestLog.push({ method, path, body: parsedBody });
    
    if (path === '/admin/auth/login' && method === 'POST') {
      if (parsedBody?.email === 'admin@example.com' && parsedBody?.password === 'Synthetic-Admin-Pw-1') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: { admin: { id: '1', name: 'Admin', email: 'admin@example.com' }, expiresAt: new Date().toISOString() } }) };
      }
      return { ok: false, status: 401, json: async () => ({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Credenciais inválidas' } }) };
    }
    
    if (path === '/admin/comanda-invitations' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ success: true, data: { inviteToken: 'mocked-invite-token-123' } }) };
    }
    
    if (path === '/comanda-sessions' && method === 'POST') {
      if (parsedBody?.inviteToken === 'mocked-invite-token-123') {
        return { ok: true, status: 201, json: async () => ({ success: true, data: { comanda: { number: '123' }, expiresAt: new Date().toISOString() } }) };
      }
      return { ok: false, status: 401, json: async () => ({ success: false, error: { code: 'INVALID_INVITATION', message: 'Convite inválido' } }) };
    }
    
    if (path === '/orders' && method === 'POST') {
      if (options.headers['Idempotency-Key']) {
        if (parsedBody.items[0].expectedUnitPriceInCents === 1000) {
          return { ok: false, status: 409, json: async () => ({ success: false, error: { code: 'PRICE_CHANGED', message: 'Preço alterado' } }) };
        }
        return { ok: true, status: 201, json: async () => ({ success: true, data: { orderNumber: 42, comandaNumber: '123', totalInCents: 5000, status: 'RECEIVED' } }) };
      }
    }
    
    throw new Error('Not mocked');
  };
  
  const api = createApiClient({ baseUrl: 'http://localhost:4000/api', fetcher: mockFetcher });

  // 1. Login Inválido
  await assert.rejects(
    async () => await api.post('/admin/auth/login', { email: 'admin@example.com', password: 'wrong' }),
    (err) => err.message === 'Credenciais inválidas'
  );

  // 2. Login Válido
  const loginRes = await api.post('/admin/auth/login', { email: 'admin@example.com', password: 'Synthetic-Admin-Pw-1' });
  assert.strictEqual(loginRes.admin.name, 'Admin');

  // 3. Emissão de Convite
  const inviteRes = await api.post('/admin/comanda-invitations', { comandaNumber: '123' });
  assert.strictEqual(inviteRes.inviteToken, 'mocked-invite-token-123');

  // 4. Resgate Válido
  const redeemRes = await api.post('/comanda-sessions', { inviteToken: 'mocked-invite-token-123' });
  assert.strictEqual(redeemRes.comanda.number, '123');
  
  // 5. Preço Alterado no Pedido
  await assert.rejects(
    async () => await api.post('/orders', {
      customerName: 'Cliente Teste',
      items: [{ productId: 'prod-1', quantity: 1, expectedUnitPriceInCents: 1000 }]
    }, undefined, { headers: { 'Idempotency-Key': 'key-1' } }),
    (err) => err.message === 'Preço alterado'
  );

  // 6. Pedido Bem Sucedido
  const orderRes = await api.post('/orders', {
    customerName: 'Cliente Teste',
    items: [{ productId: 'prod-1', quantity: 1, expectedUnitPriceInCents: 5000 }]
  }, undefined, { headers: { 'Idempotency-Key': 'key-1' } });
  
  assert.strictEqual(orderRes.orderNumber, 42);
  assert.strictEqual(orderRes.status, 'RECEIVED');
});
