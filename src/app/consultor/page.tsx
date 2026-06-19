"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Logo } from "@/components/app/Logo";

const inputClass =
  "w-full rounded-xl border border-[#E0E7E3] bg-white px-4 py-3.5 text-[15px] outline-none transition-shadow focus:border-brand-400 focus:ring-[3px] focus:ring-brand-500/12";

/**
 * Página pública standalone do funil "fale com nosso consultor" — para links
 * diretos (ex.: bio, anúncios). Mesmo formulário do modal; ao enviar grava o
 * lead e SEMPRE redireciona o prospect para o WhatsApp do time.
 */
export default function ConsultorPage() {
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !whatsapp.trim()) {
      setError("Informe seu nome e WhatsApp.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/consultant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          whatsapp: whatsapp.trim(),
          email: email.trim() || undefined,
          message: message.trim() || undefined,
          source: "consultor",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Não foi possível registrar seu contato.");
        setLoading(false);
        return;
      }
      // Caminho feliz: leva o prospect direto ao WhatsApp do time.
      window.location.href = data.whatsappUrl as string;
    } catch {
      setError("Erro de rede. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <form onSubmit={onSubmit} className="w-full max-w-[440px]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
            <MessageCircle size={13} /> Atendimento humano
          </span>
          <h1 className="mt-4 font-display text-[30px] font-bold tracking-[-0.02em] text-ink">
            Fale com nosso consultor
          </h1>
          <p className="mt-2 text-[15px] text-slate-500">
            Deixe seus dados que continuamos a conversa no WhatsApp — sem
            compromisso.
          </p>

          <div className="mt-7 flex flex-col gap-4">
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">Nome completo</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">WhatsApp</label>
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="(11) 98888-1111"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">
                E-mail <span className="font-medium text-slate-400">(opcional)</span>
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
              <label className="mb-2 block text-[13px] font-bold text-[#1A2A23]">
                Mensagem <span className="font-medium text-slate-400">(opcional)</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Conte rapidamente o que você precisa…"
                className={inputClass}
              />
            </div>

            {error && (
              <p className="rounded-xl bg-[#FDECEC] px-3.5 py-2.5 text-sm font-medium text-[#C0392B]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1.5 rounded-xl bg-brand-500 py-[15px] text-[15.5px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.6)] transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {loading ? "Abrindo o WhatsApp…" : "Continuar no WhatsApp →"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
