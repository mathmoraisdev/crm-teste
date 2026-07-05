"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  RefreshCw,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  ExternalLink,
  Search,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LoadingBlock } from "@/components/ui/Spinner";
import { cn, formatSlot } from "@/lib/utils";
import type { AgendaItem } from "@/server/services/meeting.service";
import {
  APPT_STATUS_LABEL,
  APPT_STATUS_TONE,
  type AppointmentDTO,
} from "@/components/agenda/appointment-labels";

const STATUS_TONE = {
  CONFIRMED: "green",
  PROPOSED: "amber",
  CANCELLED: "red",
} as const;

const STATUS_LABEL = {
  CONFIRMED: "Confirmada",
  PROPOSED: "Proposta",
  CANCELLED: "Cancelada",
} as const;

type Status = keyof typeof STATUS_LABEL;
const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as Status[];

const STATUS_ICON: Record<Status, React.ReactNode> = {
  CONFIRMED: <CalendarCheck size={18} className="text-emerald-500" />,
  PROPOSED: <CalendarClock size={18} className="text-amber-500" />,
  CANCELLED: <CalendarX size={18} className="text-red-400" />,
};

/** Rótulo relativo (Hoje / Amanhã) p/ a data agendada, comparando por dia local. */
function relativeDayLabel(iso: string): "Hoje" | "Amanhã" | null {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(new Date(iso)) - startOfDay(new Date())) / 86_400_000,
  );
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  return null;
}

type Tab = "meetings" | "appointments";

export function AgendaView() {
  const [tab, setTab] = useState<Tab>("meetings");
  const [meetings, setMeetings] = useState<AgendaItem[] | null>(null);
  const [appointments, setAppointments] = useState<AppointmentDTO[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const [mRes, aRes] = await Promise.all([
        fetch("/api/meetings", { cache: "no-store" }),
        fetch("/api/appointments", { cache: "no-store" }),
      ]);
      const mData = await mRes.json();
      const aData = await aRes.json();
      if (mRes.ok) setMeetings(mData.meetings as AgendaItem[]);
      if (aRes.ok) setAppointments(aData.items as AppointmentDTO[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const filtered = useMemo(() => {
    if (!meetings) return null;
    const q = query.trim();
    const lower = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    return meetings.filter((m) => {
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (!q) return true;
      return (
        m.lead.name.toLowerCase().includes(lower) ||
        (digits.length > 0 && m.lead.phone.replace(/\D/g, "").includes(digits))
      );
    });
  }, [meetings, statusFilter, query]);

  const confirmedCount = useMemo(
    () => meetings?.filter((m) => m.status === "CONFIRMED").length ?? 0,
    [meetings],
  );

  // Agenda mostra só o que ainda está de pé (AGENDADO/CONFIRMADO); realizados,
  // faltas e cancelamentos são histórico e ficam na ficha do cliente. Mesma busca
  // por nome/telefone das reuniões.
  const filteredAppts = useMemo(() => {
    if (!appointments) return null;
    const q = query.trim();
    const lower = q.toLowerCase();
    const digits = q.replace(/\D/g, "");
    return appointments.filter((a) => {
      if (a.status !== "AGENDADO" && a.status !== "CONFIRMADO") return false;
      if (!q) return true;
      return (
        a.lead.name.toLowerCase().includes(lower) ||
        (digits.length > 0 && a.lead.phone.replace(/\D/g, "").includes(digits))
      );
    });
  }, [appointments, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
            Agenda
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Compromissos marcados pela IA com os seus leads — lembretes em ordem
            de data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} /> Atualizar
          </Button>
        </div>
      </div>

      {/* Abas: reuniões (IA) x agendamentos de serviço */}
      <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
        {([
          { value: "meetings", label: "Reuniões" },
          { value: "appointments", label: "Agendamentos" },
        ] as { value: Tab; label: string }[]).map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.value
                ? "bg-brand-500 text-white dark:bg-brand-500/15 dark:text-brand-300 dark:ring-1 dark:ring-inset dark:ring-brand-500/40"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "meetings" ? (
        <>
      {/* Busca + filtro de status */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:flex-none">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 sm:w-[260px]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Limpar busca"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-auto"
        >
          <option value="ALL">Todos os status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {confirmedCount > 0 && (
          <span className="text-sm text-slate-500">
            <strong className="text-success">{confirmedCount}</strong>{" "}
            confirmada{confirmedCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {filtered === null ? (
        <Card>
          <LoadingBlock label="Carregando agenda…" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            {meetings && meetings.length === 0
              ? "Nenhum compromisso ainda. Quando a IA agendar uma reunião, ela aparece aqui."
              : "Nenhum compromisso corresponde ao filtro."}
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {filtered.map((m) => (
              <AgendaRow key={m.id} item={m} />
            ))}
          </ul>
        </Card>
      )}
        </>
      ) : (
        <>
          {/* Busca (nome/telefone) para agendamentos */}
          <div className="relative min-w-[220px] max-w-[300px]">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone…"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-8 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {filteredAppts === null ? (
            <Card>
              <LoadingBlock label="Carregando agendamentos…" />
            </Card>
          ) : filteredAppts.length === 0 ? (
            <Card>
              <div className="py-10 text-center text-sm text-slate-500">
                {query.trim()
                  ? "Nenhum agendamento corresponde à busca."
                  : "Nenhum agendamento em aberto. Agende um serviço na ficha do cliente."}
              </div>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-slate-100">
                {filteredAppts.map((a) => (
                  <AppointmentRow key={a.id} item={a} />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AppointmentRow({ item }: { item: AppointmentDTO }) {
  const relDay = relativeDayLabel(item.scheduledAt);
  const service = item.serviceName ?? item.catalogItem?.name ?? "Atendimento";
  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1 py-3.5 pr-1 sm:flex-nowrap",
        relDay ? "-mx-1 rounded-lg border-l-2 border-brand-400 bg-brand-50/40 pl-3" : "px-1",
      )}
    >
      <span className="mt-0.5">
        <CalendarClock size={18} className="text-brand-500" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/leads/${item.lead.id}`}
            className="font-bold text-ink hover:text-brand-600 hover:underline"
          >
            {item.lead.name}
          </Link>
          <Badge tone={APPT_STATUS_TONE[item.status]}>{APPT_STATUS_LABEL[item.status]}</Badge>
          {relDay && (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">
              {relDay}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-slate-600">
          {service} · {formatSlot(item.scheduledAt)}
        </p>
        <p className="mt-0.5 font-mono text-xs text-slate-400">{item.lead.phone}</p>
      </div>
    </li>
  );
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const status = item.status as Status;
  const relDay =
    status === "CONFIRMED" && item.scheduledAt
      ? relativeDayLabel(item.scheduledAt)
      : null;
  const when =
    item.scheduledAt != null
      ? formatSlot(item.scheduledAt)
      : item.proposedSlots.length > 0
        ? `${item.proposedSlots.length} horário(s) proposto(s)`
        : "—";

  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 py-3.5 pr-1 sm:flex-nowrap",
        relDay ? "-mx-1 rounded-lg border-l-2 border-brand-400 bg-brand-50/40 pl-3" : "px-1",
      )}
    >
      <span className="mt-0.5">{STATUS_ICON[status]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/leads/${item.lead.id}`}
            className="font-bold text-ink hover:text-brand-600 hover:underline"
          >
            {item.lead.name}
          </Link>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
          {relDay && (
            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">
              {relDay}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-slate-600">{when}</p>
        {status === "PROPOSED" && item.proposedSlots.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {item.proposedSlots.map((s) => (
              <li key={s}>{formatSlot(s)}</li>
            ))}
          </ul>
        )}
        <p className="mt-0.5 font-mono text-xs text-slate-400">
          {item.lead.phone}
        </p>
      </div>
      {item.meetingLink && (
        <a
          href={item.meetingLink}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-9 inline-flex w-full flex-none items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50 sm:ml-0 sm:mt-0.5 sm:w-auto sm:justify-start sm:py-1.5"
        >
          <Video size={13} /> Entrar <ExternalLink size={11} />
        </a>
      )}
    </li>
  );
}
