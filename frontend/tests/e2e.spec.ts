import { test, expect } from '@playwright/test';

/**
 * Jornada real: login admin -> convite -> resgate -> carrinho -> pedido (POSTGRES TEST).
 * ESCREVE no banco: so executar com autorizacao especifica (backend/docs/e2e-real.md).
 *
 * Os dados vem das fixtures SINTETICAS desta execucao (globalSetup -> manifesto); nada e fixo:
 * admin, comanda, produto e preco mudam a cada execucao e sao removidos pelo globalTeardown.
 *
 * 3D.3.21-A: sem atalhos. O teste nao habilita o envio por JavaScript, nao remove `disabled` e nao
 * forca cliques; se o envio estiver desligado o botao fica desabilitado e o teste falha ali.
 * 3D.3.21-B: confere o POST (cabecalhos, 201) e a idempotencia (mesmo POST reenviado => 200, mesmo pedido).
 * A conferencia do que foi gravado no banco (1 pedido, 1 item, total, historico, comanda) e feita
 * pelo globalTeardown, em somente leitura, ANTES de limpar.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fixture(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente: o globalSetup nao provisionou as fixtures desta execucao.`);
  return value;
}

test.describe('E2E Real Journey', () => {
  test('Complete flow: login -> invite -> redeem -> order -> verify', async ({ page, baseURL }) => {
    const adminEmail = fixture('RUSTIKA_E2E_ADMIN_EMAIL');
    const adminPassword = fixture('RUSTIKA_E2E_ADMIN_PASSWORD');
    const comanda = fixture('RUSTIKA_E2E_COMANDA');
    const productName = fixture('RUSTIKA_E2E_PRODUCT_NAME');

    // 1. Login administrativo (admin sintetico desta execucao)
    await page.goto('/#admin');
    await page.fill('input[type="email"]', adminEmail);
    await page.fill('input[type="password"]', adminPassword);
    await page.click('button[type="submit"]');
    await expect(page.locator('h2').first()).toContainText('Painel Administrativo');

    // 2. Convite para a comanda reservada desta execucao
    await page.fill('input[id="comanda"]', comanda);
    await page.click('button:has-text("Emitir Convite")');
    const tokenStrong = page.locator('.admin-success strong');
    await expect(tokenStrong).toBeVisible({ timeout: 10000 });
    const inviteToken = await tokenStrong.innerText();

    // 3. Resgate pelo cliente
    await page.goto('/#catalog');
    await page.click('button[aria-label="Abrir carrinho"]');
    const tokenInput = page.locator('input[id="comanda-invite-token"]');
    await expect(tokenInput).toBeVisible();
    await tokenInput.fill(inviteToken);
    await page.click('button:has-text("Resgatar")');
    await expect(page.locator('.comanda-active-status')).toBeVisible({ timeout: 15000 });
    await page.click('button:has-text("Fechar")');
    await expect(page.locator('#hero-title')).toContainText('Bem-vindo ao');

    // 4. Produto sintetico desta execucao no carrinho
    await page.click(`.product-card:has-text("${productName}")`);
    await page.click('.product-add-form button:has-text("Adicionar ao carrinho")');
    await page.click('button:has-text("Ver meu carrinho")');

    // 5. Revisao e checkout
    await page.click('button:has-text("Revisar pedido")');
    await page.click('button:has-text("Prosseguir para envio")');
    await page.fill('input[id="checkout-name"]', 'E2E Customer');

    // Guarda explicita: envio habilitado pelo ambiente do Vite (VITE_ORDER_SUBMISSION=enabled).
    const sendButton = page.getByRole('button', { name: 'Enviar pedido' });
    await expect(page.getByText('O envio de pedidos está desativado neste ambiente')).toHaveCount(0);
    await expect(sendButton).toBeEnabled();

    // Clique real; captura o POST e confere o contrato antes de olhar a interface.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST', { timeout: 15000 }),
      sendButton.click(),
    ]);
    const request = response.request();
    const headers = await request.allHeaders();
    expect(headers['x-rustika-request']).toBe('1');
    expect(headers['idempotency-key']).toMatch(UUID_V4);
    expect(headers['content-type']).toContain('application/json');
    expect(headers.cookie ?? '').toContain('rustika_session=');
    expect(headers.origin).toBe(baseURL);
    expect(response.status(), `POST /api/orders respondeu ${response.status()}: ${await response.text()}`).toBe(201);
    const created = (await response.json()) as { success: boolean; data: { orderNumber: number; totalInCents: number; comandaNumber: string } };
    expect(created.success).toBe(true);
    expect(created.data.comandaNumber).toBe(comanda);
    expect(created.data.totalInCents).toBe(Number(fixture('RUSTIKA_E2E_PRODUCT_PRICE_CENTS')));

    // Estado de sucesso e ausencia de erro visivel
    await expect(page.locator('.admin-error')).toHaveCount(0);
    await expect(page.locator('#checkout-title')).toContainText('Pedido recebido', { timeout: 15000 });

    // 6. Idempotencia: o MESMO POST (mesma chave, mesmo corpo) devolve o mesmo pedido, sem criar outro.
    const replay = await page.request.post(request.url(), {
      headers: {
        'content-type': 'application/json', 'x-rustika-request': '1', origin: String(baseURL),
        'idempotency-key': String(headers['idempotency-key']),
      },
      data: request.postData() ?? '',
    });
    expect(replay.status(), `replay respondeu ${replay.status()}`).toBe(200);
    const replayed = (await replay.json()) as { data: { orderNumber: number } };
    expect(replayed.data.orderNumber).toBe(created.data.orderNumber);
  });
});
