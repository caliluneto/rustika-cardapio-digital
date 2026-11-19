/**
 * RF004 — texto de demonstração coerente com a capacidade REAL do ambiente.
 *
 * Antes desta entrega, três telas afirmavam em texto fixo que "esta demonstração não envia pedidos".
 * Com `VITE_ORDER_SUBMISSION=enabled` e uma comanda validada, o pedido É enviado e gravado no
 * PostgreSQL — o aviso passava a mentir para o cliente e para a banca.
 *
 * As funções abaixo são puras: recebem a capacidade já resolvida e devolvem a frase correta.
 * Nenhuma delas decide se o envio está ligado; isso continua sendo `orderSubmissionEnabled()`.
 */

export type CatalogMode = 'api' | 'demo';

/**
 * Aviso do rodapé do catálogo (App.tsx).
 * `submissionEnabled` reflete `VITE_ORDER_SUBMISSION=enabled` no build atual.
 */
export function catalogNotice(mode: CatalogMode, submissionEnabled: boolean): string {
  const source = mode === 'demo'
    ? 'Produtos e preços vêm de uma cópia local da seleção aprovada do cadastro Rústika.'
    : 'Produtos e preços são carregados da API do catálogo Rústika.';
  if (!submissionEnabled) {
    return `${source} O cardápio não recebe pedidos nem confirma estoque, disponibilidade ou preços em tempo real.`;
  }
  return `${source} O envio de pedidos está habilitado para comandas com convite válido emitido pelo estabelecimento. O servidor recalcula o total e confirma preço e disponibilidade no envio.`;
}

/** Nota do carrinho (CartDrawer.tsx), acima do formulário de comanda. */
export function cartNotice(submissionEnabled: boolean): string {
  if (!submissionEnabled) {
    return 'Valores de referência. Preço e estoque não são confirmados; esta demonstração não envia pedidos.';
  }
  return 'Valores de referência do catálogo. O servidor recalcula o total e confirma preço e disponibilidade ao enviar o pedido.';
}

/**
 * Situação da comanda no carrinho (CartDrawer.tsx).
 * Distingue número digitado localmente de sessão realmente validada pelo backend.
 */
export function comandaDisclaimer(comanda: string | null, sessionNumber: string | null): string {
  if (comanda === null) return 'O número não é validado pelo estabelecimento.';
  if (sessionNumber !== null && sessionNumber === comanda) return 'Comanda validada pelo estabelecimento.';
  return 'Comanda informada — ainda não validada pelo estabelecimento.';
}

/**
 * Nota da tela de revisão (OrderReview.tsx).
 * `canCheckout` = existe sessão de comanda válida e ela corresponde ao número informado.
 */
export function reviewNotice(canCheckout: boolean, submissionEnabled: boolean): string {
  if (canCheckout && submissionEnabled) {
    return 'Comanda validada pelo estabelecimento. Preços e disponibilidade são confirmados pelo servidor no envio.';
  }
  if (canCheckout) {
    return 'Comanda validada pelo estabelecimento, mas o envio de pedidos está desativado neste ambiente.';
  }
  if (submissionEnabled) {
    return 'Resgate o convite da comanda no carrinho para habilitar o envio. Sem uma comanda validada nenhum pedido é enviado.';
  }
  return 'Demonstração acadêmica: comanda, preços e estoque não são validados. Nenhum pedido será enviado.';
}
