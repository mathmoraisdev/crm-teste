"use client";

import { HelpHint } from "@/components/ui/HelpHint";

// Legenda das cores da lista do inbox. Swatches com os mesmos tokens semânticos
// usados no ConversationListItem, p/ o operador saber o que cada destaque significa.
const ITEMS = [
  { dot: "bg-brand-500", label: "Não lida", desc: "mensagem nova, não vista" },
  { dot: "bg-danger", label: "SLA estourado", desc: "esperando demais p/ 1ª resposta" },
  { dot: "bg-warning", label: "Não respondida", desc: "lida, mas sem resposta" },
  { dot: "bg-brand-400", label: "Selecionada", desc: "conversa aberta agora" },
] as const;

export function ConversationLegend() {
  return (
    <HelpHint label="Legenda das cores" align="right">
      <p className="mb-1.5 font-bold text-ink">Cores da lista</p>
      <ul className="space-y-1.5">
        {ITEMS.map((it) => (
          <li key={it.label} className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${it.dot}`} />
            <span className="font-semibold text-ink">{it.label}</span>
            <span className="text-slate-400">— {it.desc}</span>
          </li>
        ))}
      </ul>
    </HelpHint>
  );
}
