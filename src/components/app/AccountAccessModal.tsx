// src/components/app/AccountAccessModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { parseBRLToCents } from "@/lib/money";

type PaymentMethod = "PIX" | "CARTAO" | "BOLETO" | "TRANSFERENCIA";

type Action =
  | { kind: "extend"; days: number }
  | { kind: "forceActive" }
  | { kind: "forceSuspend" }
  | { kind: "auto" }
  | {
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: string | null;
      amountCents: number | null;
    };

const METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
};

/** ISO string | null -> "YYYY-MM-DD" para o <input type="date"> (ou ""). */
function toDateInput(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

export function AccountAccessModal({
  accountId,
  active,
  isAdmin,
  daysLeft,
  paymentMethod,
  paymentDueDate,
}: {
  accountId: string;
  active: boolean;
  isAdmin: boolean;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: string | null; // ISO string (serializado do server) ou null
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Estado local do formulário de anotação (forma de pgto + vencimento).
  const [method, setMethod] = useState<PaymentMethod | "">(paymentMethod ?? "");
  const [due, setDue] = useState<string>(toDateInput(paymentDueDate));
  const [amount, setAmount] = useState<string>("");

  async function send(action: Action) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao atualizar.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function saveInfo() {
    // "YYYY-MM-DD" -> ISO datetime (meio-dia UTC evita pular de dia por fuso).
    const dueIso = due ? new Date(`${due}T12:00:00.000Z`).toISOString() : null;
    const amountCents = amount.trim() ? parseBRLToCents(amount) : null;
    if (amount.trim() && amountCents == null) { alert("Valor inválido. Ex.: 129,90"); return; }
    return send({ kind: "setInfo", paymentMethod: method || null, paymentDueDate: dueIso, amountCents });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200"
      >
        Gerenciar
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Acesso da conta">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {active ? "Ativa" : "Suspensa"}
            {daysLeft != null && ` · ${daysLeft} dia(s) restante(s)`}
          </p>

          {/* Liberar teste (trial): define o acesso em N dias a partir de hoje. */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Liberar teste
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => send({ kind: "extend", days: 3 })}
                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                Trial 3 dias
              </button>
              <button disabled={busy} onClick={() => send({ kind: "extend", days: 7 })}
                className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                Trial 7 dias
              </button>
            </div>
          </div>

          {/* Controle manual (override). */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Controle manual
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => send({ kind: "forceActive" })}
                className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-40">
                Forçar ativo
              </button>
              <button disabled={busy || isAdmin} onClick={() => send({ kind: "forceSuspend" })}
                title={isAdmin ? "Conta admin não pode ser suspensa" : undefined}
                className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                Suspender
              </button>
              <button disabled={busy} onClick={() => send({ kind: "auto" })}
                className="col-span-2 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-40">
                Seguir prazo (auto)
              </button>
            </div>
          </div>

          {/* Lançar pagamento: forma + vencimento. O vencimento LIBERA o acesso até a data. */}
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Lançar pagamento
            </p>
            <p className="text-xs text-slate-500">
              O vencimento libera o acesso até a data. Sem vencimento, só registra a forma.
              Com valor preenchido, o pagamento entra no extrato/receita.
            </p>
            <label className="block">
              <span className="text-xs text-slate-500">Valor (opcional)</span>
              <input
                type="text" inputMode="decimal" placeholder="Ex.: 129,90"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Em branco = não registra receita (cortesia/ajuste). Com valor = entra no extrato.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Forma de pagamento</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">— não informado —</option>
                {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Vencimento da mensalidade</span>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <button disabled={busy} onClick={saveInfo}
              className="w-full rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
              Lançar pagamento
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
