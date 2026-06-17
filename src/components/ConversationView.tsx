"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, formatDateTime } from "@/lib/utils";
import type { LeadDetail } from "@/server/services/lead.service";

type Message = LeadDetail["messages"][number];

/**
 * Visão da conversa (bolhas) + caixa "responder como lead".
 *
 * No modo mock, o avaliador usa este input para simular a resposta do lead.
 * Ele chama /api/dev/simulate-reply, que injeta a mensagem no MESMO pipeline
 * do webhook (dedupe incluso) e dispara a orquestração de IA.
 */
export function ConversationView({
  leadId,
  messages,
  onReplied,
  canReply,
}: {
  leadId: string;
  messages: Message[];
  onReplied: () => void;
  canReply: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/simulate-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, text: content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar resposta");
      setText("");
      onReplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[60vh] flex-col">
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">
            Nenhuma mensagem ainda. Inicie a campanha para enviar a primeira
            mensagem.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 p-3">
        {!canReply ? (
          <p className="text-center text-xs text-slate-400">
            Este lead ainda não foi contatado — inicie a campanha para abrir a
            conversa.
          </p>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder="Responder como o lead… (demo local)"
                className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <Button onClick={send} loading={sending} disabled={!text.trim()}>
                <Send size={16} /> Enviar
              </Button>
            </div>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
            <p className="mt-1 text-xs text-slate-400">
              Simula a resposta do lead e dispara a qualificação por IA.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const inbound = message.direction === "INBOUND";
  return (
    <div className={cn("flex", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          inbound
            ? "rounded-bl-sm bg-white text-slate-800"
            : "rounded-br-sm bg-brand-500 text-white",
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        <p
          className={cn(
            "mt-0.5 text-[10px]",
            inbound ? "text-slate-400" : "text-brand-100",
          )}
        >
          {inbound ? "Lead" : "Você"} · {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
