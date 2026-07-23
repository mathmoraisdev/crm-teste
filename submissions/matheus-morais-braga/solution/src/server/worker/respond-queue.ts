import { respondToLead } from "@/server/services/conversation.service";

/**
 * Fila de resposta com debounce POR LEAD (só faz sentido no worker, processo
 * longo). Cada inbound reseta o timer do lead; quando a janela fecha sem nova
 * mensagem, `respondToLead` roda UMA vez e lê toda a conversa acumulada — assim
 * mensagens picadas ("oi" / "tudo bem?" / "queria saber X") viram uma resposta
 * só, e a IA não dispara instantaneamente.
 *
 * Os timers são em memória: se o worker reiniciar, pendências se perdem — o
 * próximo inbound do lead re-agenda. `respondToLead` recarrega o estado fresco,
 * então um timer que dispara após o operador assumir (aiPaused) fica em silêncio.
 *
 * Concorrência: `respondToLead` NUNCA roda em paralelo para o mesmo lead (gera
 * resposta dupla). Se uma mensagem chega enquanto um run está em andamento, um
 * único re-run é enfileirado e executado ao final — cobre o caso delay=0 e o de
 * IA lenta (resposta demora mais que a janela).
 */
const timers = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const rerun = new Set<string>();

function fire(leadId: string): void {
  // Já há um run em andamento p/ este lead → enfileira um único re-run.
  if (running.has(leadId)) {
    rerun.add(leadId);
    return;
  }
  running.add(leadId);
  void respondToLead(leadId)
    .catch((err) => {
      console.error(`[worker] respondToLead falhou (lead=${leadId}):`, err);
    })
    .finally(() => {
      running.delete(leadId);
      // Mensagem chegou durante o run → processa o que ficou pendente, uma vez.
      if (rerun.delete(leadId)) fire(leadId);
    });
}

/** Agenda (ou re-agenda) a resposta do lead. delayMs<=0 responde imediatamente. */
export function scheduleResponse(leadId: string, delayMs: number): void {
  const existing = timers.get(leadId);
  if (existing) clearTimeout(existing);

  if (delayMs <= 0) {
    timers.delete(leadId);
    fire(leadId);
    return;
  }

  const t = setTimeout(() => {
    timers.delete(leadId);
    fire(leadId);
  }, delayMs);
  t.unref?.(); // não segura o processo no shutdown
  timers.set(leadId, t);
}

/** Cancela uma resposta pendente (ex.: humano assumiu a conversa). */
export function cancelResponse(leadId: string): void {
  const t = timers.get(leadId);
  if (t) {
    clearTimeout(t);
    timers.delete(leadId);
  }
  rerun.delete(leadId); // não deixa um re-run enfileirado disparar após o handoff
}
