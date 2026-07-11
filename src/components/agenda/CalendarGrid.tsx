"use client";

import { useMemo } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apptDisplayName, type AppointmentDTO } from "@/components/agenda/appointment-labels";

// ── Grade de calendário (dia/semana) para a Agenda ──────────────────────────
// MVP: eixo de horas 07:00–21:00, colunas = profissionais (dia) ou dias da
// semana (semana). Cada agendamento é posicionado por horário + duração.

const START_HOUR = 7;
const END_HOUR = 21; // exclusivo no eixo (última faixa é 20:00–21:00)
const HOUR_PX = 52; // altura de 1h em px
const SNAP_MIN = 30; // clique encaixa em blocos de 30 min
const DEFAULT_DURATION = 60; // duração assumida quando o agendamento não define

/** Faixas de hora renderizadas (07..20). */
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/**
 * Cor do profissional (chave gravada em Professional.color) → classes de token
 * para o bloco. Só design tokens (surfaces adaptam claro/escuro). Fallback slate.
 */
const BLOCK_TONE: Record<string, string> = {
  slate: "border-l-slate-400 bg-slate-100 text-slate-700",
  brand: "border-l-brand-500 bg-brand-50 text-brand-700",
  blue: "border-l-info bg-info-surface text-info",
  amber: "border-l-warning bg-warning-surface text-warning",
  red: "border-l-danger bg-danger-surface text-danger",
  violet: "border-l-accent bg-accent-surface text-accent",
  // Categóricas de profissional (equipes maiores) — tokens pro-* (theme-aware).
  teal: "border-l-pro-teal bg-pro-teal-surface text-pro-teal",
  pink: "border-l-pro-pink bg-pro-pink-surface text-pro-pink",
  indigo: "border-l-pro-indigo bg-pro-indigo-surface text-pro-indigo",
  orange: "border-l-pro-orange bg-pro-orange-surface text-pro-orange",
};

const DOT_TONE: Record<string, string> = {
  slate: "bg-slate-400",
  brand: "bg-brand-500",
  blue: "bg-info",
  amber: "bg-warning",
  red: "bg-danger",
  violet: "bg-accent",
  teal: "bg-pro-teal",
  pink: "bg-pro-pink",
  indigo: "bg-pro-indigo",
  orange: "bg-pro-orange",
};

function blockTone(color: string): string {
  return BLOCK_TONE[color] ?? BLOCK_TONE.slate;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

interface Professional {
  id: string;
  name: string;
  color: string;
}

/** Coluna da grade: profissional (modo dia) ou dia da semana (modo semana). */
interface Column {
  key: string;
  label: string;
  color: string;
  professionalId?: string; // definido só no modo dia (com profissional)
  date: Date; // dia da coluna (00:00 local)
  dot: boolean; // mostra bolinha de cor no cabeçalho (modo dia)
}

export function CalendarGrid({
  appointments,
  professionals,
  mode,
  date,
  onSlotClick,
  onEventClick,
}: {
  appointments: AppointmentDTO[];
  professionals: Professional[];
  mode: "day" | "week";
  date: Date;
  onSlotClick: (d: { scheduledAt: string; professionalId?: string }) => void;
  onEventClick?: (appt: AppointmentDTO) => void;
}) {
  // Início do dia/semana (00:00 local) para posicionar colunas e agendamentos.
  const dayStart = useMemo(() => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [date]);

  const columns = useMemo<Column[]>(() => {
    if (mode === "week") {
      // Semana iniciando no domingo que contém `date`.
      const weekStart = new Date(dayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return {
          key: `wd-${i}`,
          label: `${WEEKDAY_LABEL[i]} ${String(d.getDate()).padStart(2, "0")}`,
          color: "slate",
          date: d,
          dot: false,
        };
      });
    }
    // Modo dia: uma coluna por profissional ativo.
    const cols: Column[] = professionals.map((p) => ({
      key: p.id,
      label: p.name,
      color: p.color,
      professionalId: p.id,
      date: dayStart,
      dot: true,
    }));
    // Coluna "Sem profissional" quando há agendamentos sem profissional (ou
    // nenhum profissional cadastrado) — senão eles ficariam invisíveis.
    const known = new Set(professionals.map((p) => p.id));
    const hasUnassigned = appointments.some((a) => !a.professionalId || !known.has(a.professionalId));
    if (hasUnassigned || cols.length === 0) {
      cols.push({
        key: "__none__",
        label: "Sem profissional",
        color: "slate",
        date: dayStart,
        dot: false,
      });
    }
    return cols;
  }, [mode, dayStart, professionals, appointments]);

  const gridHeight = HOURS.length * HOUR_PX;
  const knownProfIds = useMemo(() => new Set(professionals.map((p) => p.id)), [professionals]);

  /** Agendamentos que pertencem a uma coluna, já posicionados (top/height). */
  function laidOut(col: Column) {
    return appointments
      .map((a) => {
        const at = new Date(a.scheduledAt);
        // Filtro por coluna.
        if (mode === "week") {
          if (
            at.getFullYear() !== col.date.getFullYear() ||
            at.getMonth() !== col.date.getMonth() ||
            at.getDate() !== col.date.getDate()
          )
            return null;
        } else if (col.professionalId) {
          if (a.professionalId !== col.professionalId) return null;
        } else {
          // Coluna "Sem profissional": pega os sem profissional (ou órfãos).
          if (a.professionalId && knownProfIds.has(a.professionalId)) return null;
        }
        const minutesFromStart = at.getHours() * 60 + at.getMinutes() - START_HOUR * 60;
        const dur = a.durationMinutes ?? DEFAULT_DURATION;
        const end = new Date(at.getTime() + dur * 60_000);
        const rawTop = (minutesFromStart / 60) * HOUR_PX;
        const height = Math.max((dur / 60) * HOUR_PX, 22);
        const top = clamp(rawTop, 0, gridHeight - height);
        return { appt: a, at, end, top, height };
      })
      .filter(
        (x): x is { appt: AppointmentDTO; at: Date; end: Date; top: number; height: number } =>
          x !== null,
      )
      .sort((a, b) => a.top - b.top);
  }

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, col: Column) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMin = (y / HOUR_PX) * 60;
    const snapped = clamp(
      Math.round(rawMin / SNAP_MIN) * SNAP_MIN,
      0,
      (END_HOUR - START_HOUR) * 60 - SNAP_MIN,
    );
    const start = new Date(col.date);
    start.setHours(START_HOUR, 0, 0, 0);
    start.setMinutes(start.getMinutes() + snapped);
    onSlotClick({ scheduledAt: start.toISOString(), professionalId: col.professionalId });
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line-default bg-card">
      <div className="min-w-[640px]">
        {/* Cabeçalho das colunas */}
        <div className="flex border-b border-line-default">
          <div className="w-14 shrink-0" />
          {columns.map((col) => (
            <div
              key={col.key}
              className="flex min-w-[120px] flex-1 items-center justify-center gap-1.5 px-2 py-2 text-center text-xs font-semibold text-ink"
            >
              {col.dot && (
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT_TONE[col.color] ?? DOT_TONE.slate)} />
              )}
              <span className="truncate">{col.label}</span>
            </div>
          ))}
        </div>

        {/* Corpo: eixo de horas + colunas */}
        <div className="flex">
          {/* Eixo de horas */}
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_PX }}>
                <span className="absolute right-1.5 top-0 -translate-y-1/2 text-[11px] tabular-nums text-slate-400">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            ))}
          </div>

          {/* Colunas */}
          {columns.map((col) => (
            <div
              key={col.key}
              onClick={(e) => handleColumnClick(e, col)}
              className="relative min-w-[120px] flex-1 cursor-pointer border-l border-line-default"
              style={{ height: gridHeight }}
            >
              {/* Linhas de hora (cheias) + meia-hora (tracejada, mais fraca) para
                  leitura de durações curtas sem depender de clicar. */}
              {HOURS.map((h, i) => (
                <div key={h} className="pointer-events-none">
                  <div
                    className="absolute inset-x-0 border-t border-line-default/60"
                    style={{ top: i * HOUR_PX }}
                  />
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-line-default/30"
                    style={{ top: i * HOUR_PX + HOUR_PX / 2 }}
                  />
                </div>
              ))}

              {/* Blocos de agendamento */}
              {laidOut(col).map(({ appt, at, end, top, height }) => {
                const service = appt.serviceName ?? appt.catalogItem?.name ?? "Atendimento";
                const color = appt.professional?.color ?? col.color;
                return (
                  <div
                    key={appt.id}
                    onClick={(e) => {
                      // Não deixa o clique "vazar" p/ a coluna (que abriria um novo
                      // agendamento) e abre o resumo deste agendamento.
                      e.stopPropagation();
                      onEventClick?.(appt);
                    }}
                    className={cn(
                      "absolute inset-x-1 cursor-pointer overflow-hidden rounded-md border-l-4 px-2 py-1 text-[11px] leading-tight shadow-sm transition-shadow hover:shadow-md",
                      blockTone(color),
                    )}
                    style={{ top, height }}
                    title={`${apptDisplayName(appt)} · ${service} · ${hhmm(at)}–${hhmm(end)}`}
                  >
                    <p className="flex items-center gap-1 truncate font-bold">
                      {appt.source === "ONLINE" && (
                        <Link2 size={10} className="shrink-0" aria-label="Agendamento online" />
                      )}
                      <span className="truncate">{apptDisplayName(appt)}</span>
                    </p>
                    <p className="truncate opacity-80">{service}</p>
                    <p className="tabular-nums opacity-70">
                      {hhmm(at)}–{hhmm(end)}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
