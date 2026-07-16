"use client";

import { useState } from "react";
import { Phone, PhoneMissed, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

// ── Tipos ────────────────────────────────────────────────────────────────────

type CallOutcome = "ANSWERED" | "NO_ANSWER" | "CALLBACK";

interface OutcomeMeta {
  id: CallOutcome;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  activeColor: string;
  activeBorder: string;
}

const OUTCOMES: OutcomeMeta[] = [
  {
    id: "ANSWERED",
    label: "Atendeu",
    description: "O lead atendeu e a conversa aconteceu",
    icon: <Phone size={20} />,
    color: "text-brand-600",
    activeColor: "bg-brand-50 text-brand-700",
    activeBorder: "border-brand-400 ring-2 ring-brand-500/20",
  },
  {
    id: "NO_ANSWER",
    label: "Não atendeu",
    description: "Ninguém atendeu ou caiu na caixa postal",
    icon: <PhoneMissed size={20} />,
    color: "text-slate-500",
    activeColor: "bg-slate-100 text-slate-700",
    activeBorder: "border-slate-400 ring-2 ring-slate-500/15",
  },
  {
    id: "CALLBACK",
    label: "Agendar retorno",
    description: "Não atendeu — defina quando ligar de volta",
    icon: <CalendarClock size={20} />,
    color: "text-warning",
    activeColor: "bg-warning-surface text-warning",
    activeBorder: "border-warning ring-2 ring-warning/20",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formata datetime-local (sem fuso) em pt-BR curto. */
function formatLocalDt(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO 8601 com offset BR (-03:00) a partir de um datetime-local string. */
function toISOWithBROffset(local: string): string {
  if (!local) return "";
  // datetime-local: "2025-08-01T14:30"
  return `${local}:00-03:00`;
}

/** Mínimo do input datetime-local: agora (sem segundos). */
function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  // toISOString é UTC; ajusta pro local sem fuso no input
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CallResultModalProps {
  open: boolean;
  leadId: string;
  leadName: string;
  /** Chamado ao fechar sem salvar. */
  onClose: () => void;
  /** Chamado após salvar com sucesso — permite atualizar o card na lista. */
  onSaved: () => void;
}

export function CallResultModal({
  open,
  leadId,
  leadName,
  onClose,
  onSaved,
}: CallResultModalProps) {
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setOutcome(null);
    setNote("");
    setCallbackAt("");
    setError(null);
    setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function save() {
    if (!outcome) return;
    if (outcome === "CALLBACK" && !callbackAt) {
      setError("Informe a data e hora do retorno.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/leads/${leadId}/call-log`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome,
          note: note.trim() || undefined,
          callbackAt: outcome === "CALLBACK" ? toISOWithBROffset(callbackAt) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Erro ao salvar");
      }

      setDone(true);
      // Fecha o modal automaticamente após 1.4s para o vendedor ver o feedback.
      setTimeout(() => {
        onSaved();
        reset();
      }, 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  // ── Tela de sucesso ──────────────────────────────────────────────────────
  if (done) {
    return (
      <Modal open={open} onClose={handleClose} title="Ligação registrada">
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 size={28} className="text-brand-500" />
          </div>
          <p className="font-semibold text-ink">Resultado salvo!</p>
          <p className="text-sm text-slate-400">
            {outcome === "CALLBACK" && callbackAt
              ? `Retorno agendado para ${formatLocalDt(callbackAt)}`
              : outcome === "ANSWERED"
                ? "A ligação foi registrada como atendida."
                : "Registrado como não atendeu."}
          </p>
        </div>
      </Modal>
    );
  }

  // ── Formulário ────────────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={handleClose} title={`Resultado da ligação — ${leadName}`}>
      <div className="space-y-5">
        {/* Subtítulo */}
        <p className="text-sm text-slate-500">
          O que aconteceu na ligação? Isso fica registrado como nota interna e
          atualiza o status do lead quando necessário.
        </p>

        {/* Seleção de outcome */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {OUTCOMES.map((o) => {
            const active = outcome === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setOutcome(o.id);
                  setError(null);
                }}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all",
                  active
                    ? cn(o.activeColor, o.activeBorder)
                    : "border-line-default bg-card hover:border-slate-300 hover:bg-inset",
                )}
              >
                <span className={cn("transition-colors", active ? "" : o.color)}>
                  {o.icon}
                </span>
                <div>
                  <p className="text-sm font-bold">{o.label}</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-slate-500">
                    {o.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Data/hora de retorno — só aparece quando CALLBACK */}
        {outcome === "CALLBACK" && (
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-ink">
              Quando ligar de volta?{" "}
              <span className="font-normal text-danger">*</span>
            </label>
            <input
              type="datetime-local"
              min={nowLocal()}
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              className={cn(
                "w-full rounded-xl border border-line-default bg-inset px-3 py-2.5 text-sm text-ink",
                "focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
                !callbackAt && error ? "border-danger ring-2 ring-danger/20" : "",
              )}
            />
            {callbackAt && (
              <p className="text-xs text-slate-400">
                {formatLocalDt(callbackAt)}
              </p>
            )}
          </div>
        )}

        {/* Nota livre — visível quando qualquer outcome selecionado */}
        {outcome && (
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-ink">
              {outcome === "ANSWERED"
                ? "O que foi combinado?"
                : outcome === "CALLBACK"
                  ? "Observações (opcional)"
                  : "Motivo / observação (opcional)"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                outcome === "ANSWERED"
                  ? "Ex.: Lead tem interesse no plano premium. Vai decidir até sexta."
                  : outcome === "CALLBACK"
                    ? "Ex.: Estava em reunião, pediu para ligar após as 17h."
                    : "Ex.: Caixa postal. Tentativa 2."
              }
              rows={3}
              maxLength={1000}
              className={cn(
                "w-full resize-none rounded-xl border border-line-default bg-inset px-3 py-2.5",
                "text-sm text-ink placeholder:text-slate-400",
                "focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20",
              )}
            />
            <p className="text-right text-[11px] text-slate-400">
              {note.length}/1000
            </p>
          </div>
        )}

        {/* Erro */}
        {error && (
          <p className="rounded-xl bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {/* Ações */}
        <div className="flex items-center justify-end gap-2.5 border-t border-line pt-4">
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!outcome || saving}
            loading={saving}
          >
            {saving ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Salvando…
              </>
            ) : (
              "Salvar resultado"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
