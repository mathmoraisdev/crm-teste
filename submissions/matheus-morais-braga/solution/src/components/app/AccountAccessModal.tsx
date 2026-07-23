// src/components/app/AccountAccessModal.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { parseBRLToCents } from "@/lib/money";

type PaymentMethod = "PIX" | "CARTAO" | "BOLETO" | "TRANSFERENCIA";
type Plan = "INICIAL" | "PROFISSIONAL" | "ESCALA";

type Action =
  | { kind: "trial"; days: number }
  | { kind: "extend"; days: number }
  | { kind: "forceActive" }
  | { kind: "forceSuspend" }
  | { kind: "auto" }
  | { kind: "clearPayment" }
  | {
      kind: "setInfo";
      paymentMethod: PaymentMethod | null;
      paymentDueDate: string | null;
      amountCents: number | null;
    }
  | { kind: "setPlan"; plan: Plan | null };

const METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
};

const PLAN_LABELS: Record<Plan, string> = {
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  ESCALA: "Escala",
};

/** ISO string | null -> "YYYY-MM-DD" para o <input type="date"> (ou ""). */
function toDateInput(d: string | null): string {
  return d ? d.slice(0, 10) : "";
}

export function AccountAccessModal({
  accountId,
  name,
  active,
  isAdmin,
  daysLeft,
  paymentMethod,
  paymentDueDate,
  plan,
}: {
  accountId: string;
  name: string;
  active: boolean;
  isAdmin: boolean;
  daysLeft: number | null;
  paymentMethod: PaymentMethod | null;
  paymentDueDate: string | null; // ISO string (serializado do server) ou null
  plan: Plan | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Estado local do formulário de anotação (forma de pgto + vencimento).
  const [method, setMethod] = useState<PaymentMethod | "">(paymentMethod ?? "");
  const [due, setDue] = useState<string>(toDateInput(paymentDueDate));
  const [amount, setAmount] = useState<string>("");
  const [planValue, setPlanValue] = useState<Plan | "">(plan ?? "");
  // Zona de perigo: exige digitar o nome da conta p/ liberar a exclusão.
  const [confirmName, setConfirmName] = useState("");

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao excluir.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

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

          {/* Plano comercial (rótulo). Não altera acesso/limites — só registro. */}
          <div className="space-y-2 border-b border-slate-100 pb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Plano
            </p>
            <div className="flex gap-2">
              <select
                value={planValue}
                onChange={(e) => setPlanValue(e.target.value as Plan | "")}
                className="flex-1 rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink"
              >
                <option value="">— não definido —</option>
                {(Object.keys(PLAN_LABELS) as Plan[]).map((p) => (
                  <option key={p} value={p}>{PLAN_LABELS[p]}</option>
                ))}
              </select>
              <button
                disabled={busy}
                onClick={() => send({ kind: "setPlan", plan: planValue || null })}
                className="rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Apenas organização/cobrança. Não altera acesso nem limites da conta.
            </p>
          </div>

          {/* Liberar teste (trial): define o acesso em N dias A PARTIR DE HOJE
              (hard reset, não soma sobre o prazo vigente) e limpa a marcação de pagamento. */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Liberar teste
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => send({ kind: "trial", days: 3 })}
                className="rounded-lg bg-success-surface px-3 py-2 text-xs font-bold text-success hover:bg-success/15 disabled:opacity-40">
                Trial 3 dias
              </button>
              <button disabled={busy} onClick={() => send({ kind: "trial", days: 7 })}
                className="rounded-lg bg-success-surface px-3 py-2 text-xs font-bold text-success hover:bg-success/15 disabled:opacity-40">
                Trial 7 dias
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Define o acesso em N dias a partir de hoje e zera a marcação de pagamento.
            </p>
          </div>

          {/* Controle manual (override). */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Controle manual
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => send({ kind: "forceActive" })}
                className="rounded-lg bg-info-surface px-3 py-2 text-xs font-bold text-info hover:bg-info/15 disabled:opacity-40">
                Forçar ativo
              </button>
              <button disabled={busy || isAdmin} onClick={() => send({ kind: "forceSuspend" })}
                title={isAdmin ? "Conta admin não pode ser suspensa" : undefined}
                className="rounded-lg bg-danger-surface px-3 py-2 text-xs font-bold text-danger hover:bg-danger/15 disabled:opacity-40">
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
                className="mt-1 w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink"
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
                className="mt-1 w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink"
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
                className="mt-1 w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink"
              />
            </label>
            <button disabled={busy} onClick={saveInfo}
              className="w-full rounded-lg bg-forest px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
              Lançar pagamento
            </button>
            {(paymentMethod || paymentDueDate) && (
              <button disabled={busy} onClick={() => send({ kind: "clearPayment" })}
                className="w-full rounded-lg bg-danger-surface px-3 py-2 text-xs font-bold text-danger hover:bg-danger/15 disabled:opacity-40">
                Remover pagamento
              </button>
            )}
            <p className="text-[11px] text-slate-400">
              Remover recalcula o acesso pelos pagamentos já lançados (sem nenhum, a conta
              fica sem prazo — suspensa).
            </p>
          </div>

          {/* Zona de perigo: exclusão permanente da conta (dono + operadores + dados).
              Confirmação por digitação do nome. Conta admin é bloqueada no server. */}
          {!isAdmin && (
            <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-surface/40 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-danger">
                Zona de perigo
              </p>
              <p className="text-[11px] text-slate-500">
                Exclui a conta em definitivo: dono, operadores, contatos, campanhas,
                mensagens e números. Não tem como desfazer. Digite{" "}
                <span className="font-bold text-ink">{name}</span> para liberar.
              </p>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={name}
                className="w-full rounded-lg border border-line-default bg-inset px-3 py-2 text-sm text-ink"
              />
              <button
                disabled={busy || confirmName.trim() !== name.trim()}
                onClick={remove}
                className="w-full rounded-lg bg-danger px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                Excluir conta permanentemente
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
