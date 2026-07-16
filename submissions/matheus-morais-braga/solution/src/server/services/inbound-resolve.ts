/**
 * Decisão PURA: criar um contato novo a partir de um inbound?
 * Sim quando nenhum lead casou E temos a empresa (whatsAppNumberId) + telefone.
 * Sem o número da empresa (cloud-api sem mapa) não criamos contato solto.
 */
export function shouldCreateContact(input: {
  matched: boolean;
  whatsAppNumberId?: string;
  phone?: string;
}): boolean {
  return !input.matched && !!input.whatsAppNumberId && !!input.phone;
}
