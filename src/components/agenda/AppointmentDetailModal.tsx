"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCheck, X as XIcon, MessageCircle, Clock, User, Briefcase, StickyNote, Link2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatSlot } from "@/lib/utils";
import {
  APPT_STATUS_LABEL,
  APPT_STATUS_TONE,
  apptDisplayName,
  type AppointmentDTO,
} from "@/components/agenda/appointment-labels";

const TERMINAL = new Set(["REALIZADO", "FALTOU", "CANCELADO"]);
const DEFAULT_DURATION = 60; // sem duração gravada, assume 1h (igual ao calendário)

/** Fim (HH:MM) a partir do início + duração (fallback 1h). */
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const actionBtn =
  "inline-flex items-center gap-1 rounded-md border border-line-default px-3 py-1.5 text-sm font-medium text-slate-600 disabled:opacity-50";

/**
 * Resumo de um agendamento clicado (calendário ou Lista) com ações rápidas de
 * status. Reaproveita `/api/appointments/[id]` (PATCH status / DELETE cancela) —
 * a MESMA API da ficha do cliente — e dá esse controle também ao walk-in, que
 * antes não tinha onde mudar de status fora da ficha do lead.
 */
export function AppointmentDetailModal({
  appt,
  onClose,
  onChanged,
}: {
  appt: AppointmentDTO | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
    if (!appt) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appt.id}`, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Erro.");
      }
      await onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro.");
    } finally {
      setBusy(false);
    }
  }

  if (!appt) return null;

  const service = appt.serviceName ?? appt.catalogItem?.name ?? "Atendimento";
  const start = new Date(appt.scheduledAt);
  const dur = appt.durationMinutes ?? DEFAULT_DURATION;
  const end = new Date(start.getTime() + dur * 60_000);
  const phone = appt.lead?.phone ?? appt.customerPhone ?? null;
  const phoneDigits = phone?.replace(/\D/g, "") ?? "";
  const terminal = TERMINAL.has(appt.status);

  return (
    <Modal open={!!appt} onClose={onClose} title="Resumo do agendamento">
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          {appt.lead ? (
            <Link
              href={`/leads/${appt.lead.id}`}
              className="text-lg font-bold text-ink hover:text-brand-600 hover:underline"
            >
              {appt.lead.name}
            </Link>
          ) : (
            <span className="text-lg font-bold text-ink">{apptDisplayName(appt)}</span>
          )}
          <div className="flex shrink-0 items-center gap-2">
            {appt.source === "ONLINE" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-surface px-2 py-0.5 text-xs font-semibold text-info">
                <Link2 size={11} /> Online
              </span>
            )}
            <Badge tone={APPT_STATUS_TONE[appt.status]}>{APPT_STATUS_LABEL[appt.status]}</Badge>
          </div>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex items-start gap-2">
            <Briefcase size={15} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="text-ink">
              {service}
              {appt.durationMinutes != null ? ` · ${appt.durationMinutes} min` : ""}
            </span>
          </div>
          {appt.professional && (
            <div className="flex items-start gap-2">
              <User size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <span className="text-ink">{appt.professional.name}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Clock size={15} className="mt-0.5 shrink-0 text-slate-400" />
            <span className="text-ink">
              {formatSlot(appt.scheduledAt)} – {hhmm(end)}
            </span>
          </div>
          {appt.note && (
            <div className="flex items-start gap-2">
              <StickyNote size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <span className="italic text-slate-500">{appt.note}</span>
            </div>
          )}
        </dl>

        {phoneDigits && (
          <a
            href={`https://wa.me/${phoneDigits}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-default px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            <MessageCircle size={14} /> {phone} · abrir conversa
          </a>
        )}

        {!terminal && (
          <div className="flex flex-wrap gap-2 border-t border-line-default pt-3">
            {appt.status === "AGENDADO" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act("PATCH", { status: "CONFIRMADO" })}
                className={`${actionBtn} hover:border-brand-300 hover:text-brand-600`}
              >
                <Check size={14} /> Confirmar
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => act("PATCH", { status: "REALIZADO" })}
              className={`${actionBtn} hover:border-brand-300 hover:text-brand-600`}
            >
              <CheckCheck size={14} /> Realizado
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("PATCH", { status: "FALTOU" })}
              className={`${actionBtn} hover:border-warning hover:text-warning`}
            >
              Faltou
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act("DELETE")}
              className={`${actionBtn} hover:border-danger hover:text-danger`}
            >
              <XIcon size={14} /> Cancelar
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
