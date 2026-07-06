"use client";

import { useState, useCallback } from "react";

export interface WidgetService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}
export interface WidgetProfessional {
  id: string;
  name: string;
  color: string;
}
export interface DateOption {
  value: string; // YYYY-MM-DD (fuso da agenda)
  label: string;
}
interface Slot {
  startISO: string;
  professionalId: string;
  professionalName: string;
}

const cardClass = "rounded-xl border border-slate-200 bg-card p-4";
const labelClass = "mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5 text-sm text-ink focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

function money(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Widget público de agendamento (sem login). Fluxo: serviço → profissional
 * (com "Sem preferência") → dia → horário (busca slots reais) → dados → confirmar.
 * Toda marcação passa pelo POST público, que revalida e cria pelo mesmo serviço
 * interno. Mobile-first, só tokens/CSS vars.
 */
export function BookingWidget({
  slug,
  services,
  professionals,
  dateOptions,
  tz,
}: {
  slug: string;
  services: WidgetService[];
  professionals: WidgetProfessional[];
  dateOptions: DateOption[];
  tz: string;
}) {
  const [serviceId, setServiceId] = useState<string>("");
  const [professionalId, setProfessionalId] = useState<string>("any"); // "any" = sem preferência
  const [date, setDate] = useState<string>("");
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ whenLabel: string } | null>(null);

  const service = services.find((s) => s.id === serviceId) ?? null;

  const fmtTime = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso)),
    [tz],
  );

  const fmtWhen = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat("pt-BR", {
        timeZone: tz,
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso)),
    [tz],
  );

  const loadSlots = useCallback(
    async (svc: string, pro: string, d: string) => {
      setLoadingSlots(true);
      setSlotsError(null);
      setSlots(null);
      setSlot(null);
      try {
        const qs = new URLSearchParams({ catalogItemId: svc, date: d });
        if (pro !== "any") qs.set("professionalId", pro);
        const res = await fetch(`/api/agendar/${slug}/slots?${qs.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Não foi possível carregar os horários.");
        setSlots(data.slots ?? []);
      } catch (e) {
        setSlotsError(e instanceof Error ? e.message : "Erro ao carregar horários.");
      } finally {
        setLoadingSlots(false);
      }
    },
    [slug],
  );

  function pickService(id: string) {
    setServiceId(id);
    setSlots(null);
    setSlot(null);
    if (id && date) loadSlots(id, professionalId, date);
  }
  function pickProfessional(id: string) {
    setProfessionalId(id);
    setSlots(null);
    setSlot(null);
    if (serviceId && date) loadSlots(serviceId, id, date);
  }
  function pickDate(d: string) {
    setDate(d);
    if (serviceId && d) loadSlots(serviceId, professionalId, d);
  }

  async function confirm() {
    if (!slot || !service) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/agendar/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId: service.id,
          professionalId: slot.professionalId,
          startISO: slot.startISO,
          customerName: name.trim(),
          customerPhone: phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error("Muitas tentativas. Tente em instantes.");
      if (res.status === 409) {
        // Alguém acabou de pegar esse horário — recarrega o dia.
        setSubmitError("Esse horário acabou de ser preenchido. Escolha outro.");
        if (serviceId && date) await loadSlots(serviceId, professionalId, date);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Não foi possível confirmar.");
      setDone({ whenLabel: fmtWhen(slot.startISO) });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Erro ao confirmar.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={`${cardClass} text-center`}>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-surface text-2xl">
          ✓
        </div>
        <h2 className="font-display text-lg font-bold text-ink">Tudo certo, {name.trim()}!</h2>
        <p className="mt-1 text-sm text-slate-600">
          Seu horário está marcado para <strong>{done.whenLabel}</strong>.
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {service?.name}
          {slot ? ` · ${slot.professionalName}` : ""}
        </p>
      </div>
    );
  }

  const canConfirm = slot && name.trim().length > 0 && phone.trim().length >= 8;

  return (
    <div className="space-y-4">
      {/* Serviço */}
      <div className={cardClass}>
        <label className={labelClass}>Serviço</label>
        <select value={serviceId} onChange={(e) => pickService(e.target.value)} className={inputClass}>
          <option value="">Escolha um serviço…</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.durationMinutes}min · {money(s.priceCents)}
            </option>
          ))}
        </select>
      </div>

      {/* Profissional */}
      {serviceId && (
        <div className={cardClass}>
          <label className={labelClass}>Profissional</label>
          <select
            value={professionalId}
            onChange={(e) => pickProfessional(e.target.value)}
            className={inputClass}
          >
            <option value="any">Sem preferência</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Dia */}
      {serviceId && (
        <div className={cardClass}>
          <label className={labelClass}>Dia</label>
          <select value={date} onChange={(e) => pickDate(e.target.value)} className={inputClass}>
            <option value="">Escolha um dia…</option>
            {dateOptions.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Horário */}
      {serviceId && date && (
        <div className={cardClass}>
          <label className={labelClass}>Horário</label>
          {loadingSlots && <p className="text-sm text-slate-400">Carregando horários…</p>}
          {slotsError && <p className="text-sm text-danger">{slotsError}</p>}
          {!loadingSlots && !slotsError && slots && slots.length === 0 && (
            <p className="text-sm text-slate-400">Nenhum horário livre nesse dia. Tente outro.</p>
          )}
          {!loadingSlots && slots && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const active = slot?.startISO === s.startISO;
                return (
                  <button
                    key={s.startISO}
                    type="button"
                    onClick={() => setSlot(s)}
                    className={`rounded-lg border px-2 py-2 text-sm transition ${
                      active
                        ? "border-brand-500 bg-brand-500 text-white"
                        : "border-slate-300 bg-surface text-ink hover:border-brand-400"
                    }`}
                  >
                    {fmtTime(s.startISO)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dados + confirmar */}
      {slot && (
        <div className={cardClass}>
          <label className={labelClass}>Seus dados</label>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Seu nome"
              className={inputClass}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Seu WhatsApp (com DDD)"
              inputMode="tel"
              className={inputClass}
            />
            {professionals.length > 1 && professionalId === "any" && (
              <p className="text-xs text-slate-400">
                Com <strong>{slot.professionalName}</strong> às {fmtTime(slot.startISO)}.
              </p>
            )}
            {submitError && (
              <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{submitError}</p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={!canConfirm || submitting}
              className="w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Confirmando…" : "Confirmar agendamento"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
