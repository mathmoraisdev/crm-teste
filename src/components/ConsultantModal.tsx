"use client";

import { cloneElement, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Modal do funil "fale com nosso consultor". Coleta nome/WhatsApp (e-mail e
 * mensagem opcionais), grava via POST /api/consultant e SEMPRE redireciona o
 * prospect para o WhatsApp do time no caminho feliz.
 *
 * `trigger` é o elemento clicável que abre o modal (ex.: um <Button>); se ele
 * disparar onClick, o modal abre. `plan` propaga o plano de interesse.
 */
export function ConsultantModal({
  plan,
  trigger,
}: {
  plan?: string;
  trigger: React.ReactElement<{ onClick?: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Informe seu nome.");
      return;
    }
    if (!whatsapp.trim()) {
      setError("Informe seu WhatsApp.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/consultant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim() || undefined,
          message: message.trim() || undefined,
          plan: plan || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Não foi possível registrar seu contato.");
      // Caminho feliz: leva o prospect direto ao WhatsApp do time.
      window.location.href = data.whatsappUrl as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar. Tente novamente.");
      setLoading(false);
    }
  }

  // Clona o trigger injetando o onClick que abre o modal (preserva o original).
  const opener = cloneElement(trigger, {
    onClick: () => {
      trigger.props.onClick?.();
      setOpen(true);
    },
  });

  return (
    <>
      {opener}
      <Modal open={open} onClose={() => setOpen(false)} title="Fale com nosso consultor">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Deixe seus dados que continuamos a conversa no WhatsApp — sem
            compromisso.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">WhatsApp</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="(11) 98888-1111"
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              E-mail <span className="text-slate-400">(opcional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@empresa.com.br"
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Mensagem <span className="text-slate-400">(opcional)</span>
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Conte rapidamente o que você precisa…"
              className={inputClass}
            />
          </div>

          {plan && (
            <p className="text-xs text-slate-400">
              Plano de interesse: <strong className="text-slate-600">{plan}</strong>
            </p>
          )}

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex justify-end">
            <Button onClick={submit} loading={loading}>
              Continuar no WhatsApp
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
