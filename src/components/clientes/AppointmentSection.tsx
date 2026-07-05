"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, CalendarClock, Check, CheckCheck, X as XIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { cn, formatSlot } from "@/lib/utils";
import {
  APPT_STATUS_LABEL,
  APPT_STATUS_TONE,
  type AppointmentDTO,
} from "@/components/agenda/appointment-labels";

interface CatalogItem { id: string; name: string; priceCents: number; active: boolean; kind: "SERVICO" | "PRODUTO"; }

const TERMINAL = new Set(["REALIZADO", "FALTOU", "CANCELADO"]);

export function AppointmentSection({ leadId }: { leadId: string }) {
  const [appts, setAppts] = useState<AppointmentDTO[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments?leadId=${leadId}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setAppts(data.items as AppointmentDTO[]);
    } catch {
      /* mantém estado anterior */
    }
  }, [leadId]);

  useEffect(() => {
    load();
    fetch("/api/vendas/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCatalog(((d.items as CatalogItem[]) ?? []).filter((i) => i.active)))
      .catch(() => {});
  }, [load]);

  async function act(id: string, method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Erro.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro.");
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock size={15} className="text-slate-400" />
          <h3 className="text-sm font-bold text-ink">Agendamentos</h3>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setModalOpen(true)}>
          <CalendarPlus size={14} /> Agendar
        </Button>
      </div>

      {error && <p className="mb-2 rounded-lg bg-danger-surface px-3 py-2 text-xs text-danger">{error}</p>}

      {appts === null ? (
        <p className="py-4 text-center text-xs text-slate-400">Carregando…</p>
      ) : appts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-default px-3 py-6 text-center text-sm text-slate-400">
          Nenhum agendamento. Clique em “Agendar” para marcar um serviço futuro.
        </p>
      ) : (
        <ul className="space-y-2">
          {appts.map((a) => (
            <li
              key={a.id}
              className={cn(
                "rounded-lg border bg-card px-3 py-2.5",
                a.needsReview ? "border-warning bg-warning-surface" : "border-line-default",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink">
                  {a.serviceName ?? a.catalogItem?.name ?? "Atendimento"}
                </span>
                <Badge tone={APPT_STATUS_TONE[a.status]}>{APPT_STATUS_LABEL[a.status]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{formatSlot(a.scheduledAt)}</p>
              {a.needsReview && a.reviewReason && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                  <AlertTriangle size={12} /> {a.reviewReason}
                </p>
              )}
              {a.note && <p className="mt-0.5 text-xs italic text-slate-400">{a.note}</p>}
              {!TERMINAL.has(a.status) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.status === "AGENDADO" && (
                    <button
                      type="button"
                      onClick={() => act(a.id, "PATCH", { status: "CONFIRMADO" })}
                      className="inline-flex items-center gap-1 rounded-md border border-line-default px-2 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                    >
                      <Check size={12} /> Confirmar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => act(a.id, "PATCH", { status: "REALIZADO" })}
                    className="inline-flex items-center gap-1 rounded-md border border-line-default px-2 py-1 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-600"
                  >
                    <CheckCheck size={12} /> Realizado
                  </button>
                  <button
                    type="button"
                    onClick={() => act(a.id, "PATCH", { status: "FALTOU" })}
                    className="inline-flex items-center gap-1 rounded-md border border-line-default px-2 py-1 text-xs font-medium text-slate-600 hover:border-warning hover:text-warning"
                  >
                    Faltou
                  </button>
                  <button
                    type="button"
                    onClick={() => act(a.id, "DELETE")}
                    className="inline-flex items-center gap-1 rounded-md border border-line-default px-2 py-1 text-xs font-medium text-slate-600 hover:border-danger hover:text-danger"
                  >
                    <XIcon size={12} /> Cancelar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ScheduleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        leadId={leadId}
        catalog={catalog}
        onDone={async () => {
          setModalOpen(false);
          await load();
        }}
      />
    </div>
  );
}

// ── Modal de agendamento (avulso ou série/pacote) ───────────────────────────
function ScheduleModal({
  open,
  onClose,
  leadId,
  catalog,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  leadId: string;
  catalog: CatalogItem[];
  onDone: () => Promise<void>;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [everyDays, setEveryDays] = useState(7);
  const [count, setCount] = useState(4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!scheduledAt) return setError("Escolha a data e a hora.");
    setSaving(true);
    try {
      // datetime-local é hora local → ISO (UTC) p/ o servidor.
      const iso = new Date(scheduledAt).toISOString();
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          scheduledAt: iso,
          catalogItemId: catalogItemId || undefined,
          note: note.trim() || undefined,
          ...(repeat ? { series: { everyDays, count } } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Erro ao agendar.");
      }
      // reset
      setScheduledAt("");
      setCatalogItemId("");
      setNote("");
      setRepeat(false);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao agendar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Novo agendamento">
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Data e hora</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Serviço (opcional)</span>
          <select
            value={catalogItemId}
            onChange={(e) => setCatalogItemId(e.target.value)}
            className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">— Sem serviço específico —</option>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Observação (opcional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex.: trazer exames"
            className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>

        {/* Pacote de sessões */}
        <div className="rounded-lg border border-line-default bg-card px-3 py-2.5">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="h-4 w-4 rounded border-line-default"
            />
            Repetir (pacote de sessões)
          </label>
          {repeat && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>A cada</span>
              <input
                type="number"
                min={1}
                value={everyDays}
                onChange={(e) => setEveryDays(Math.max(1, Number(e.target.value)))}
                className="w-16 rounded-lg border border-line-default bg-card px-2 py-1 text-sm text-ink focus:border-brand-400 focus:outline-none"
              />
              <span>dias, total de</span>
              <input
                type="number"
                min={1}
                max={52}
                value={count}
                onChange={(e) => setCount(Math.min(52, Math.max(1, Number(e.target.value))))}
                className="w-16 rounded-lg border border-line-default bg-card px-2 py-1 text-sm text-ink focus:border-brand-400 focus:outline-none"
              />
              <span>sessões</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={submit} loading={saving}>
            {repeat ? `Agendar ${count} sessões` : "Agendar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
