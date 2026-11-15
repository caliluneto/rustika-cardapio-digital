/**
 * Pré-condições da revisão do pedido no E2E. Lógica pura: devolve o PRIMEIRO bloqueio encontrado (mensagem segura,
 * sem dados sensíveis) ou null. Evita esperar 60 s por um botão que não pode existir naquele estado.
 */
export interface CartFacts { drawerOpen: boolean; itemShown: boolean; comandaTitle: string | null; editingHint: boolean; reviewButton: boolean }

export function reviewBlocker(facts: CartFacts, expectedComanda: string): string | null {
  if (!facts.drawerOpen) return 'o carrinho não está aberto';
  if (!facts.itemShown) return 'o produto esperado não está no carrinho';
  if (facts.comandaTitle === null) return 'nenhuma comanda é exibida no carrinho (sessão não restaurada na interface)';
  if (facts.comandaTitle.trim() !== `Comanda nº ${expectedComanda}`) return 'a comanda exibida diverge da comanda da execução';
  if (facts.editingHint) return 'o carrinho continua em edição da comanda';
  if (!facts.reviewButton) return 'o botão "Revisar pedido" não está disponível';
  return null;
}
