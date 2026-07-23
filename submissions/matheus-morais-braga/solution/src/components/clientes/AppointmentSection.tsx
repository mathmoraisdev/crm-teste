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

const TERMINAL = new Set(["REALIZADO", "FALTOU", "CANCELADO"]);

export function AppointmentSection({ leadId }: { leadId: string }) {
  const [appts, setAppts] = useState<AppointmentDTO[] | null>(null);
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
              <p className="mt-0.5 text-xs text-slate-500">
                {formatSlot(a.scheduledAt)}
                {a.durationMinutes != null && ` · ${a.durationMinutes} min`}
              </p>
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
        onDone={async () => {
          setModalOpen(false);
          await load();
        }}
      />
    </div>
  );
}

// ── Modal de agendamento (avulso ou série/pacote) ───────────────────────────
// Autossuficiente e reutilizável: busca o próprio catálogo/profissionais ao abrir.
// Usado tanto pela ficha do cliente (leadId) quanto pela Agenda (walk-in, sem lead).

interface ScheduleCatalogItem { id: string; name: string; durationMinutes: number | null; }
interface ScheduleProfessional { id: string; name: string; color: string; }

/** Converte ISO/data qualquer p/ o valor de um input datetime-local (hora local, sem segundos). */
function toLocalInputValue(s?: string): string {
  if (!s) return "";
  // Já em formato datetime-local (sem fuso) → usa direto.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) return s.slice(0, 16);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

type Override = { allowOverlap?: boolean; force?: boolean };

export function ScheduleModal({
  open,
  onClose,
  leadId,
  defaults,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  leadId?: string;
  defaults?: { scheduledAt?: string; professionalId?: string };
  onDone: () => Promise<void>;
}) {
  const isWalkIn = !leadId;

  const [catalog, setCatalog] = useState<ScheduleCatalogItem[]>([]);
  const [professionals, setProfessionals] = useState<ScheduleProfessional[]>([]);

  const [scheduledAt, setScheduledAt] = useState("");
  const [professionalId, setProfessionalId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [durationOverride, setDurationOverride] = useState("");
  const [note, setNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [everyDays, setEveryDays] = useState(7);
  const [count, setCount] = useState(4);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 409 do servidor: conflito de slot (CONFLICT) ou fora do expediente (OUTSIDE_HOURS).
  // Guarda o kind + os overrides já enviados p/ acumular allowOverlap/force nas retentativas.
  const [conflict, setConflict] = useState<{ error: string; kind?: string; override: Override } | null>(null);

  // Ao abrir: prefill dos defaults + busca dados próprios. Ao fechar: reset.
  useEffect(() => {
    if (!open) return;
    setScheduledAt(toLocalInputValue(defaults?.scheduledAt));
    setProfessionalId(defaults?.professionalId ?? "");
    setCatalogItemId("");
    setDurationOverride("");
    setNote("");
    setCustomerName("");
    setCustomerPhone("");
    setRepeat(false);
    setEveryDays(7);
    setCount(4);
    setError(null);
    setConflict(null);

    let alive = true;
    fetch("/api/vendas/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const items = ((d.items as Array<ScheduleCatalogItem & { active?: boolean }>) ?? []).filter(
          (i) => i.active !== false,
        );
        setCatalog(items);
      })
      .catch(() => {});
    fetch("/api/professionals?activeOnly=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setProfessionals((d.professionals as ScheduleProfessional[]) ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, defaults?.scheduledAt, defaults?.professionalId]);

  async function submit(override: Override = {}) {
    setError(null);
    setConflict(null);
    if (!scheduledAt) return setError("Escolha a data e a hora.");
    if (isWalkIn && !customerName.trim()) return setError("Informe o nome do cliente.");
    setSaving(true);
    try {
      // datetime-local é hora local → ISO (UTC) p/ o servidor.
      const iso = new Date(scheduledAt).toISOString();
      const dur = durationOverride.trim() ? Number(durationOverride) : undefined;
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(leadId ? { leadId } : {}),
          scheduledAt: iso,
          catalogItemId: catalogItemId || undefined,
          professionalId: professionalId || undefined,
          ...(dur != null && Number.isFinite(dur) ? { durationMinutes: dur } : {}),
          ...(isWalkIn ? { customerName: customerName.trim(), customerPhone: customerPhone.trim() || undefined } : {}),
          note: note.trim() || undefined,
          ...(repeat ? { series: { everyDays, count } } : {}),
          ...override,
        }),
      });
      if (res.status === 409) {
        // Conflito/fora-de-expediente: oferece "Agendar mesmo assim" com o override do kind.
        const d = await res.json().catch(() => ({}));
        setConflict({ error: d?.error || "Conflito de horário.", kind: d?.kind, override });
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || "Erro ao agendar.");
      }
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao agendar.");
    } finally {
      setSaving(false);
    }
  }

  // Reenvia acumulando o flag correspondente ao kind do conflito atual.
  function overrideAgain() {
    if (!conflict) return;
    const next: Override = { ...conflict.override };
    if (conflict.kind === "CONFLICT") next.allowOverlap = true;
    if (conflict.kind === "OUTSIDE_HOURS") next.force = true;
    void submit(next);
  }

  const selectedItem = catalog.find((c) => c.id === catalogItemId);

  return (
    <Modal open={open} onClose={onClose} title="Novo agendamento">
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        {conflict && (
          <div className="rounded-lg border border-warning bg-warning-surface px-3 py-2.5">
            <p className="inline-flex items-center gap-1 text-sm font-semibold text-warning">
              <AlertTriangle size={14} /> {conflict.error}
            </p>
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="secondary" onClick={overrideAgain} loading={saving}>
                Agendar mesmo assim
              </Button>
            </div>
          </div>
        )}

        {isWalkIn && (
          <div className="rounded-lg border border-line-default bg-card px-3 py-2.5">
            <p className="mb-2 text-xs font-semibold text-slate-600">Cliente sem cadastro</p>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Nome</span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nome do cliente"
                className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Telefone (opcional)</span>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="(00) 00000-0000"
                className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </label>
          </div>
        )}

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
          <span className="mb-1 block text-xs font-semibold text-slate-600">Profissional (opcional)</span>
          <select
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="">— Sem profissional —</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
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
                {c.durationMinutes != null ? ` · ${c.durationMinutes} min` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">
            Duração (min, opcional)
          </span>
          <input
            type="number"
            min={1}
            value={durationOverride}
            onChange={(e) => setDurationOverride(e.target.value)}
            placeholder={selectedItem?.durationMinutes != null ? String(selectedItem.durationMinutes) : "Padrão"}
            className="w-full rounded-lg border border-line-default bg-card px-3 py-2 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
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
          <Button size="sm" onClick={() => submit()} loading={saving}>
            {repeat ? `Agendar ${count} sessões` : "Agendar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
