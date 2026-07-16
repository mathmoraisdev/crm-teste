"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";
const numClass =
  "w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export interface BookingSettingsInitial {
  publicSlug: string | null;
  bookingEnabled: boolean;
  bookingLeadMinutes: number;
  bookingHorizonDays: number;
  bookingSlotStep: number;
  publicUrl: string | null;
}

export interface BookingReadinessInitial {
  hasProfessionalWithHours: boolean;
  hasBookableService: boolean;
  ready: boolean;
}

/**
 * Liga/desliga o auto-agendamento online da conta e ajusta a config (slug do link,
 * antecedência mínima, janela futura, granularidade). Salva em /api/booking-settings.
 * O link só "existe" (não dá 404) quando o booking está ligado e há um profissional
 * com expediente e um serviço com duração — o aviso inline orienta quando falta algo.
 */
export function BookingSettings({
  initial,
  readiness,
  canEdit = true,
}: {
  initial: BookingSettingsInitial;
  readiness: BookingReadinessInitial;
  canEdit?: boolean;
}) {
  const [enabled, setEnabled] = useState(initial.bookingEnabled);
  const [slug, setSlug] = useState(initial.publicSlug ?? "");
  const [lead, setLead] = useState(String(initial.bookingLeadMinutes));
  const [horizon, setHorizon] = useState(String(initial.bookingHorizonDays));
  const [step, setStep] = useState(String(initial.bookingSlotStep));
  const [publicUrl, setPublicUrl] = useState(initial.publicUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copyLink() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Não foi possível copiar. Copie o link manualmente.");
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const leadN = Number(lead.trim());
    const horizonN = Number(horizon.trim());
    const stepN = Number(step.trim());
    if (!Number.isInteger(leadN) || leadN < 0) {
      setError("Antecedência inválida (minutos, 0 ou mais).");
      setSaving(false);
      return;
    }
    if (!Number.isInteger(horizonN) || horizonN < 1 || horizonN > 180) {
      setError("Janela inválida (1 a 180 dias).");
      setSaving(false);
      return;
    }
    if (!Number.isInteger(stepN) || stepN < 5 || stepN > 120) {
      setError("Granularidade inválida (5 a 120 minutos).");
      setSaving(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        bookingEnabled: enabled,
        bookingLeadMinutes: leadN,
        bookingHorizonDays: horizonN,
        bookingSlotStep: stepN,
      };
      // Só manda o slug se o operador digitou algo — vazio deixa o ensureSlug agir.
      if (slug.trim()) body.publicSlug = slug.trim();
      const res = await fetch("/api/booking-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setSlug(data.publicSlug ?? "");
      setPublicUrl(data.publicUrl ?? null);
      setEnabled(Boolean(data.bookingEnabled));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Agendamento online"
        subtitle="Um link público onde o próprio cliente escolhe serviço, profissional e horário livre — sem login. A marcação cai na sua Agenda e o lembrete sai como sempre."
      />
      <div className="space-y-5 px-4 py-3">
        {!readiness.ready && (
          <p className="rounded-md bg-warning-surface px-3 py-2 text-sm text-warning">
            {!readiness.hasProfessionalWithHours && !readiness.hasBookableService
              ? "Cadastre um profissional com horário e um serviço com duração para liberar o link."
              : !readiness.hasProfessionalWithHours
                ? "Cadastre um profissional ativo com expediente para liberar o link."
                : "Cadastre um serviço com duração para liberar o link."}
          </p>
        )}

        {/* Liga/desliga */}
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Ativar agendamento online</span>
            <span className="block text-xs text-slate-500">
              Enquanto desligado, o link responde como inexistente (404).
            </span>
          </span>
        </label>

        {/* Slug + link */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Endereço do link</label>
          <input
            value={slug}
            disabled={!canEdit}
            onChange={(e) => {
              setSlug(e.target.value);
              setSaved(false);
            }}
            placeholder="ex.: salao-da-ana"
            className={inputClass}
          />
          {publicUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-sm text-brand-600 underline underline-offset-2"
              >
                {publicUrl}
              </a>
              <Button size="sm" variant="secondary" onClick={copyLink}>
                {copied ? "Copiado ✓" : "Copiar"}
              </Button>
            </div>
          )}
        </div>

        {/* Config de grade */}
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Antecedência mínima (min)</label>
            <input
              type="number"
              min={0}
              value={lead}
              disabled={!canEdit}
              onChange={(e) => {
                setLead(e.target.value);
                setSaved(false);
              }}
              className={numClass}
            />
            <span className="mt-1 block max-w-[16rem] text-xs text-slate-500">
              Folga entre agora e o 1º horário livre. Ex.: 120 = nada nas próximas 2h.
            </span>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Janela futura (dias)</label>
            <input
              type="number"
              min={1}
              max={180}
              value={horizon}
              disabled={!canEdit}
              onChange={(e) => {
                setHorizon(e.target.value);
                setSaved(false);
              }}
              className={numClass}
            />
            <span className="mt-1 block max-w-[16rem] text-xs text-slate-500">
              Até quantos dias à frente o cliente pode marcar.
            </span>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Granularidade (min)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={step}
              disabled={!canEdit}
              onChange={(e) => {
                setStep(e.target.value);
                setSaved(false);
              }}
              className={numClass}
            />
            <span className="mt-1 block max-w-[16rem] text-xs text-slate-500">
              De quantos em quantos minutos os horários aparecem (não é a duração do serviço).
            </span>
          </div>
        </div>

        {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
            <Button size="sm" onClick={save} loading={saving}>
              Salvar agendamento
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
