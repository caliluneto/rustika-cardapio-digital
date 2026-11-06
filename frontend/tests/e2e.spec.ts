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

    // 7. 3D.4.1 (PREPARADO, NAO EXECUTADO): operacao administrativa do pedido recem-criado.
    // So roda quando o setup foi iniciado com RUSTIKA_E2E_ORDER_OPS=enabled; o teardown entao espera
    // IN_PREPARATION e exatamente duas linhas de historico (verifyJourney). Sem atalhos: so a interface
    // para a transicao valida; as tentativas invalidas usam a API com a sessao do navegador e NAO gravam nada.
    if (fixture('RUSTIKA_E2E_ORDER_OPS') === 'enabled') await orderOperationsStep();
    if (fixture('RUSTIKA_E2E_PRODUCT_AVAILABILITY') === 'enabled') await productAvailabilityStep();

    async function orderOperationsStep() {
      const orderId = (created.data as unknown as { id: string }).id;
      expect(orderId).toMatch(UUID_V4);

      await page.goto('/#admin'); // mesma pagina (so o hash muda): a sessao admin continua; se o formulario voltar, entra de novo
      if (await page.locator('input[type="email"]').isVisible().catch(() => false)) {
        await page.fill('input[type="email"]', adminEmail);
        await page.fill('input[type="password"]', adminPassword);
        await page.click('button[type="submit"]');
      }
      const card = page.locator('.admin-order', { hasText: `Pedido #${created.data.orderNumber}` });
      await expect(card).toBeVisible({ timeout: 25000 }); // polling de 10 s ou o primeiro carregamento
      await expect(card).toContainText(`Comanda ${comanda}`);
      await expect(card).toContainText(productName);
      await expect(card.locator('.admin-order-status')).toHaveText('Recebido');
      // A interface so oferece o que a maquina de estados permite (RECEIVED -> preparo | cancelamento).
      await expect(card.locator('[data-to-status="READY"]')).toHaveCount(0);
      await expect(card.locator('[data-to-status="DELIVERED"]')).toHaveCount(0);

      // Transicao valida pela interface, com confirmacao explicita.
      await card.locator('[data-to-status="IN_PREPARATION"]').click();
      const [patchResponse] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/admin/orders/${orderId}/status`) && r.request().method() === 'PATCH', { timeout: 15000 }),
        card.getByRole('button', { name: 'Confirmar' }).click(),
      ]);
      expect(patchResponse.status(), `PATCH respondeu ${patchResponse.status()}: ${await patchResponse.text()}`).toBe(200);
      const patchHeaders = await patchResponse.request().allHeaders();
      expect(patchHeaders['x-rustika-request']).toBe('1');
      expect(patchHeaders.origin).toBe(baseURL);
      expect(JSON.parse(patchResponse.request().postData() ?? '{}')).toEqual({ expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' });
      await expect(card.locator('.admin-order-status')).toHaveText('Em preparo', { timeout: 15000 });

      // Conflito (expectedStatus desatualizado) e transicao proibida: rejeitados, nada e gravado.
      const patchUrl = patchResponse.request().url();
      const send = (data: object) => page.request.patch(patchUrl, {
        headers: { 'content-type': 'application/json', 'x-rustika-request': '1', origin: String(baseURL) }, data,
      });
      const stale = await send({ expectedStatus: 'RECEIVED', toStatus: 'IN_PREPARATION' });
      expect(stale.status()).toBe(409);
      expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('STATUS_CONFLICT');
      const forbidden = await send({ expectedStatus: 'IN_PREPARATION', toStatus: 'DELIVERED' });
      expect(forbidden.status()).toBe(422);
      expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe('INVALID_TRANSITION');
      // A persistencia e o historico (RECEIVED inicial + 1 transicao do admin) sao conferidos pelo globalTeardown,
      // somente leitura, antes da limpeza cirurgica (residuo zero).
    }

    // 3D.4.2 (PREPARADO, NAO EXECUTADO): disponibilidade de produtos pelo painel. So roda com
    // RUSTIKA_E2E_PRODUCT_AVAILABILITY=enabled (passo proprio e opt-in do CI). Produtos 100% sinteticos desta execucao:
    // "unknown" (nasce UNKNOWN -> o admin torna DISPONIVEL e o cliente pede) e "priceChange" (nasce DISPONIVEL ->
    // o cliente o coloca no carrinho, o admin o torna INDISPONIVEL e o envio e rejeitado). O globalTeardown confere em
    // somente leitura: 2 pedidos, estados finais, nenhum pedido com o produto bloqueado; depois remove tudo (residuo zero).
    async function productAvailabilityStep() {
      const unknownName = fixture('RUSTIKA_E2E_UNKNOWN_PRODUCT_NAME');
      const blockedName = fixture('RUSTIKA_E2E_BLOCKED_PRODUCT_NAME');
      const adminPage = await page.context().newPage(); // mesma sessao de navegador; o cliente continua na pagina original
      await adminPage.goto('/#admin');
      if (await adminPage.locator('input[type="email"]').isVisible().catch(() => false)) {
        await adminPage.fill('input[type="email"]', adminEmail);
        await adminPage.fill('input[type="password"]', adminPassword);
        await adminPage.click('button[type="submit"]');
      }
      const panel = adminPage.locator('.admin-products');
      await expect(panel).toBeVisible({ timeout: 25000 });

      const change = async (name: string, from: string, to: string, labelFrom: string, labelTo: string): Promise<string> => {
        await panel.locator('input[type="search"]').fill(name);
        const row = panel.locator('.admin-product', { hasText: name });
        await expect(row).toHaveCount(1);
        await expect(row.locator('[data-availability]')).toHaveText(labelFrom);
        await row.locator(`[data-to-state="${to}"]`).click();
        const [res] = await Promise.all([
          adminPage.waitForResponse((r) => /\/api\/admin\/products\/rustika-[^/]+\/availability$/.test(r.url()) && r.request().method() === 'PATCH', { timeout: 15000 }),
          row.getByRole('button', { name: 'Confirmar' }).click(),
        ]);
        expect(res.status(), `PATCH respondeu ${res.status()}: ${await res.text()}`).toBe(200);
        const requestHeaders = await res.request().allHeaders();
        expect(requestHeaders['x-rustika-request']).toBe('1');
        expect(requestHeaders.origin).toBe(baseURL);
        expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ expectedState: from, toState: to });
        await expect(row.locator('[data-availability]')).toHaveText(labelTo, { timeout: 15000 });
        return res.request().url();
      };
      const openCatalogFresh = async () => {
        await page.goto('/#catalog');
        await page.reload(); // o catalogo e lido de novo; a sessao da comanda (cookie) continua
        await expect(page.locator('#hero-title')).toContainText('Bem-vindo ao');
      };
      const addToCartAndReview = async (name: string) => {
        await page.click(`.product-card:has-text("${name}")`);
        await page.click('.product-add-form button:has-text("Adicionar ao carrinho")');
        await page.click('button:has-text("Ver meu carrinho")');
        await page.click('button:has-text("Revisar pedido")');
        await page.click('button:has-text("Prosseguir para envio")');
        await page.fill('input[id="checkout-name"]', 'E2E Customer');
      };
      const sendButton = page.getByRole('button', { name: 'Enviar pedido' });

      // A. O cliente ve o produto como "nao confirmado" antes da decisao do estabelecimento.
      await openCatalogFresh();
      await expect(page.locator(`.product-card:has-text("${unknownName}")`)).toContainText('Disponibilidade não confirmada');

      // B. Admin torna o produto disponivel pela interface (com confirmacao) e a API rejeita o que nao e permitido.
      const patchUrl = await change(unknownName, 'UNKNOWN', 'AVAILABLE', 'Não confirmado', 'Disponível');
      const send = (data: object) => adminPage.request.patch(patchUrl, {
        headers: { 'content-type': 'application/json', 'x-rustika-request': '1', origin: String(baseURL) }, data,
      });
      const stale = await send({ expectedState: 'UNKNOWN', toState: 'UNAVAILABLE' });
      expect(stale.status()).toBe(409);
      expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('AVAILABILITY_CONFLICT');
      const toUnknown = await send({ expectedState: 'AVAILABLE', toState: 'UNKNOWN' });
      expect(toUnknown.status()).toBe(422);
      expect(((await toUnknown.json()) as { error: { code: string } }).error.code).toBe('INVALID_TRANSITION');
      expect((await send({ expectedState: 'AVAILABLE', toState: 'UNAVAILABLE', price: 1 })).status()).toBe(400);

      // C. O cliente passa a ver o produto como disponivel, adiciona e conclui o pedido (segundo pedido da execucao).
      await openCatalogFresh();
      const unknownCard = page.locator(`.product-card:has-text("${unknownName}")`);
      await expect(unknownCard).not.toContainText('Disponibilidade não confirmada');
      await expect(unknownCard).not.toContainText('Indisponível');
      await addToCartAndReview(unknownName);
      await expect(sendButton).toBeEnabled();
      const [second] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST', { timeout: 15000 }),
        sendButton.click(),
      ]);
      expect(second.status(), `POST /api/orders respondeu ${second.status()}: ${await second.text()}`).toBe(201);
      await expect(page.locator('#checkout-title')).toContainText('Pedido recebido', { timeout: 15000 });

      // D. Outro produto: no carrinho do cliente, depois indisponibilizado pelo admin ANTES do envio.
      await openCatalogFresh();
      await addToCartAndReview(blockedName);
      await expect(sendButton).toBeEnabled();
      await change(blockedName, 'AVAILABLE', 'UNAVAILABLE', 'Disponível', 'Indisponível');

      // E. O envio e rejeitado pelo servidor (validacao dentro da transacao); nenhum pedido parcial; carrinho preservado.
      const [rejected] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST', { timeout: 15000 }),
        sendButton.click(),
      ]);
      expect(rejected.status()).toBe(409);
      expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe('PRODUCT_UNAVAILABLE');
      await expect(page.locator('dialog.order-review .admin-error')).toContainText('não está mais disponível');
      await expect(page.locator('#checkout-title')).toContainText('Enviar pedido'); // continua no envio: nao virou "Pedido recebido"

      // F. No catalogo, o produto aparece indisponivel e nao pode ser adicionado.
      await openCatalogFresh();
      await expect(page.locator(`.product-card:has-text("${blockedName}")`)).toContainText('Indisponível');
      await page.click(`.product-card:has-text("${blockedName}")`);
      await expect(page.getByText('Produto indisponível para adicionar.')).toBeVisible();
      await adminPage.close();
    }
  });
});
