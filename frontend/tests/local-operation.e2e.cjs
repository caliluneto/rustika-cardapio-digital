/** Jornada persistente, SOMENTE no PostgreSQL isolado 127.0.0.1:55432 criado para operação local. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { Client } = require('../../backend/node_modules/pg');

const secrets = path.join(process.env.LOCALAPPDATA, 'CardapioDigital', 'rustika-isolated-secrets');
const databaseUrl = JSON.parse(fs.readFileSync(path.join(secrets, 'rustika-isolated-migrator.env'), 'utf8').slice(13));
const { email, password } = JSON.parse(fs.readFileSync(path.join(secrets, 'rustika-isolated-admin-login.json'), 'utf8'));
const parsed = new URL(databaseUrl);
assert.equal(parsed.hostname, '127.0.0.1');
assert.equal(parsed.port, '55432');
assert.equal(parsed.pathname, '/cardapio_digital_dev');
assert.equal(parsed.username, 'cardapio_migrator');

async function main() {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  let browser;
  let temporaryCategoryKey = null;
  try {
    const facts = (await db.query(`SELECT current_database() db, current_user usr, inet_server_port() port,
      host(inet_server_addr()) addr, current_setting('neon.project_id', true) neon,
      (SELECT count(*)::int FROM public._prisma_migrations WHERE finished_at IS NOT NULL) migrations,
      (SELECT count(*)::int FROM public.products WHERE source_code IS NOT NULL) imported`)).rows[0];
    assert.deepEqual(facts, { db: 'cardapio_digital_dev', usr: 'cardapio_migrator', port: 55432,
      addr: '127.0.0.1', neon: null, migrations: 10, imported: 144 });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('http://localhost:5175/#admin');
    await page.locator('.admin-login-container[data-session-state="anonymous"]').waitFor();
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.locator('h2:has-text("Painel Administrativo")').waitFor();
    await page.locator('.admin-product').first().waitFor();
    assert.equal(await page.locator('.admin-product').count(), 144);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false,
      'o painel administrativo excede 390px');
    console.log('local-e2e=admin-login-dashboard-products PASS');

    const manualName = `LOCAL TESTE ${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await page.getByRole('button', { name: 'Novo produto' }).click();
    await page.locator('#admin-product-name').fill(manualName);
    await page.locator('#admin-product-category').selectOption({ index: 1 });
    await page.locator('#admin-product-price').fill('1234');
    const [createdProduct] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/admin/products') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Criar produto' }).click(),
    ]);
    assert.equal(createdProduct.status(), 201);
    await page.locator('.admin-products input[type="search"]').fill(manualName);
    const manualRow = page.locator('.admin-product', { hasText: manualName });
    await manualRow.waitFor();
    await manualRow.getByRole('button', { name: 'Editar produto' }).click();
    await page.locator('#admin-product-price').fill('2345');
    const [editedProduct] = await Promise.all([
      page.waitForResponse(r => /\/api\/admin\/products\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Salvar alterações' }).click(),
    ]);
    assert.equal(editedProduct.status(), 200);
    await manualRow.getByText('R$ 23,45').waitFor();
    const badProduct = await page.request.post('http://localhost:4200/api/admin/products', {
      headers: { 'x-rustika-request': '1', origin: 'http://localhost:5175' },
      data: { name: 'PRECO INVALIDO', priceInCents: -1, categoryId: 'invalid' },
    });
    assert.equal(badProduct.status(), 400);
    page.once('dialog', dialog => dialog.accept());
    const [deletedProduct] = await Promise.all([
      page.waitForResponse(r => /\/api\/admin\/products\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE'),
      manualRow.getByRole('button', { name: 'Excluir produto' }).click(),
    ]);
    assert.equal(deletedProduct.status(), 200);
    await manualRow.waitFor({ state: 'detached' });
    const catalogCount = (await db.query('SELECT count(*)::int count FROM public.products')).rows[0].count;
    assert.equal(catalogCount, 144);
    console.log('local-e2e=product-create-edit-delete-validation PASS');

    const categoryName = `TESTE LOCAL ${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const categoryForm = page.locator('.admin-categories');
    await categoryForm.getByText('Categorias (12)').waitFor();
    await categoryForm.locator('#admin-category-name').fill(categoryName);
    await categoryForm.locator('#admin-category-description').fill('Categoria temporária para E2E');
    await categoryForm.locator('#admin-category-order').fill('999');
    const [categoryCreated] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/admin/categories') && r.request().method() === 'POST'),
      categoryForm.getByRole('button', { name: 'Cadastrar categoria' }).click(),
    ]);
    assert.equal(categoryCreated.status(), 201);
    const newCategory = (await categoryCreated.json()).data;
    assert.match(newCategory.publicKey, /^rustika-category-local-[a-f0-9]{24}$/);
    temporaryCategoryKey = newCategory.publicKey;
    await categoryForm.getByText('Categorias (13)').waitFor();
    await categoryForm.getByRole('button', { name: `Editar categoria ${categoryName}` }).click();
    await categoryForm.locator('#admin-category-name').fill(`${categoryName} EDITADA`);
    await categoryForm.locator('#admin-category-order').fill('998');
    const [categoryEdited] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith(`/api/admin/categories/${newCategory.publicKey}`) && r.request().method() === 'PATCH'),
      categoryForm.getByRole('button', { name: 'Salvar categoria' }).click(),
    ]);
    assert.equal(categoryEdited.status(), 200);
    const savedCategory = (await db.query('SELECT name,display_order,public_key FROM public.categories WHERE public_key=$1', [newCategory.publicKey])).rows[0];
    assert.deepEqual(savedCategory, { name: `${categoryName} EDITADA`, display_order: 998, public_key: newCategory.publicKey });
    const invalidCategory = await page.request.patch(`http://localhost:4200/api/admin/categories/${newCategory.publicKey}`, {
      headers: { 'x-rustika-request': '1', origin: 'http://localhost:5175' },
      data: { publicKey: 'forged', isActive: false },
    });
    assert.equal(invalidCategory.status(), 400);
    const runtimeUrl = JSON.parse(fs.readFileSync(path.join(secrets, 'rustika-isolated-app.env'), 'utf8').slice(13));
    const runtime = new Client({ connectionString: runtimeUrl });
    await runtime.connect();
    try {
      await assert.rejects(
        runtime.query('UPDATE public.categories SET is_active=false WHERE public_key=$1', [newCategory.publicKey]),
        error => error.code === '42501', 'a role runtime não pode alterar is_active no banco',
      );
      await assert.rejects(
        runtime.query('DELETE FROM public.categories WHERE public_key=$1', [newCategory.publicKey]),
        error => error.code === '42501', 'a role runtime não pode excluir categorias',
      );
    } finally { await runtime.end(); }
    const duplicateCategory = await page.request.post('http://localhost:4200/api/admin/categories', {
      headers: { 'x-rustika-request': '1', origin: 'http://localhost:5175' },
      data: { name: 'PORÇÕES', displayOrder: 42 },
    });
    assert.equal(duplicateCategory.status(), 409);
    const noCsrf = await page.request.post('http://localhost:4200/api/admin/categories', {
      headers: { origin: 'http://localhost:5175' }, data: { name: 'SEM CSRF' },
    });
    assert.equal(noCsrf.status(), 403);
    const removed = await db.query('DELETE FROM public.categories WHERE public_key=$1 AND NOT EXISTS (SELECT 1 FROM public.products WHERE category_id=categories.id) RETURNING public_key', [newCategory.publicKey]);
    assert.equal(removed.rowCount, 1, 'limpeza restrita à categoria temporária criada pelo teste');
    temporaryCategoryKey = null;
    assert.equal((await db.query('SELECT count(*)::int count FROM public.categories')).rows[0].count, 12);
    console.log('local-e2e=category-create-edit-db-validation-csrf-and-fixture-cleanup PASS');

    await page.locator('.admin-products input[type="search"]').fill('BATATA FRITA');
    const productRow = page.locator('.admin-product').filter({ has: page.locator('strong').filter({ hasText: /^BATATA FRITA$/ }) });
    if (await productRow.locator('[data-availability="AVAILABLE"]').count() === 0) {
      await productRow.locator('[data-to-state="AVAILABLE"]').click();
      const [availability] = await Promise.all([
        page.waitForResponse(r => /\/availability$/.test(r.url()) && r.request().method() === 'PATCH'),
        productRow.getByRole('button', { name: 'Confirmar' }).click(),
      ]);
      assert.equal(availability.status(), 200);
    }
    await productRow.locator('[data-availability="AVAILABLE"]').waitFor();
    console.log('local-e2e=availability-unknown-to-available PASS');

    const comanda = String(700000 + crypto.randomInt(100000));
    await page.locator('#comanda').fill(comanda);
    await page.getByRole('button', { name: 'Emitir Convite' }).click();
    const token = page.locator('.admin-invite-token');
    await token.waitFor();
    const inviteToken = await token.innerText();
    await page.goto('http://localhost:5175/#catalog');
    await page.getByRole('button', { name: 'Abrir carrinho' }).click();
    await page.locator('#comanda-invite-token').fill(inviteToken);
    await page.getByRole('button', { name: 'Resgatar' }).click();
    await page.locator('.comanda-active-status').waitFor();
    await page.locator('dialog.cart-drawer').getByRole('button', { name: 'Fechar' }).first().click();
    await page.getByRole('button', { name: 'Ver detalhes de BATATA FRITA', exact: true }).click();
    await page.locator('.product-add-form').getByRole('button', { name: 'Adicionar ao carrinho' }).click();
    await page.getByRole('button', { name: 'Ver meu carrinho' }).click();
    await page.getByRole('button', { name: 'Revisar pedido' }).click();
    await page.getByRole('button', { name: 'Prosseguir para envio' }).click();
    await page.locator('#checkout-name').fill('Cliente Local E2E');
    const [orderResponse] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Enviar pedido' }).click(),
    ]);
    assert.equal(orderResponse.status(), 201);
    const order = (await orderResponse.json()).data;
    assert.equal(order.comandaNumber, comanda);
    assert.equal(order.totalInCents, 3900);
    await page.locator('#checkout-title:has-text("Pedido recebido")').waitFor();
    const stored = (await db.query(`SELECT o.id,o.status,o.total_amount,oi.quantity,oi.product_public_key_snapshot,
      (SELECT count(*)::int FROM public.order_status_history h WHERE h.order_id=o.id) history
      FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id WHERE o.order_number=$1`, [order.orderNumber])).rows;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, 'RECEIVED');
    assert.equal(Number(stored[0].total_amount), 39);
    assert.equal(stored[0].quantity, 1);
    assert.equal(stored[0].product_public_key_snapshot, 'rustika-124');
    assert.equal(stored[0].history, 1);
    console.log('local-e2e=invite-cart-order-postgres-persistence PASS');

    await page.goto('http://localhost:5175/#admin');
    const card = page.locator('.admin-order', { hasText: `Pedido #${order.orderNumber}` });
    await card.waitFor({ timeout: 25000 });
    await card.locator('[data-to-status="IN_PREPARATION"]').click();
    const [statusResponse] = await Promise.all([
      page.waitForResponse(r => /\/status$/.test(r.url()) && r.request().method() === 'PATCH'),
      card.getByRole('button', { name: 'Confirmar' }).click(),
    ]);
    assert.equal(statusResponse.status(), 200);
    const after = (await db.query('SELECT status,(SELECT count(*)::int FROM public.order_status_history WHERE order_id=$1) history FROM public.orders WHERE id=$1', [stored[0].id])).rows[0];
    assert.equal(after.status, 'IN_PREPARATION');
    assert.equal(after.history, 2);
    const stale = await page.request.patch(`http://localhost:4200/api/admin/orders/${stored[0].id}/status`, {
      headers: { 'x-rustika-request': '1', origin: 'http://localhost:5175' },
      data: { expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' },
    });
    assert.equal(stale.status(), 409);
    console.log('local-e2e=admin-order-status-conflict PASS');

    await page.getByRole('button', { name: 'Sair' }).click();
    await page.locator('.admin-login-container[data-session-state="anonymous"]').waitFor();
    const denied = await page.request.get('http://localhost:4200/api/admin/orders');
    assert.equal(denied.status(), 401);
    assert.equal((await page.request.get('http://localhost:4200/api/admin/categories')).status(), 401);
    await page.goto('http://localhost:5175/#catalog');
    await page.locator('.catalog-tag').waitFor({ state: 'attached' });
    assert.match(await page.locator('.catalog-tag').textContent(), /144 itens · 12 categorias/);
    await page.screenshot({ path: path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'rustika-local-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'layout do catálogo excede 390px');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.reload();
    await page.locator('.catalog-tag').waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'rustika-local-desktop.png'), fullPage: true });
    console.log('local-e2e=logout-public-catalog-responsive PASS');
  } finally {
    if (browser) await browser.close();
    if (temporaryCategoryKey) {
      await db.query('DELETE FROM public.categories WHERE public_key=$1 AND NOT EXISTS (SELECT 1 FROM public.products WHERE category_id=categories.id)', [temporaryCategoryKey]);
    }
    await db.end();
  }
}

main().catch(error => { console.error('local-e2e-failed=' + error.message.slice(0, 350)); process.exitCode = 1; });
