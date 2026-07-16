"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Phone,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trophy,
  TrendingUp,
  Minus,
  ClipboardList,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { TagChip } from "@/components/TagChip";
import { CallResultModal } from "@/components/CallResultModal";
import { formatPhone } from "@/lib/phone";
import { scoreTone, resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import { cn, timeAgo } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

/** Ícone e rótulo do score por faixa. */
function ScoreTier({ score }: { score: number }) {
  if (score >= 70)
    return (
      <span className="flex items-center gap-1 text-brand-700">
        <Trophy size={13} className="shrink-0" />
        <span className="text-xs font-bold">Alta prioridade</span>
      </span>
    );
  if (score >= 40)
    return (
      <span className="flex items-center gap-1 text-warning">
        <TrendingUp size={13} className="shrink-0" />
        <span className="text-xs font-bold">Prioridade média</span>
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-slate-400">
      <Minus size={13} className="shrink-0" />
      <span className="text-xs font-bold">Prioridade baixa</span>
    </span>
  );
}

/** Barra de progresso visual do score (0–100). */
function ScoreBar({ score }: { score: number }) {
  const tone = scoreTone(score);
  const barColor =
    tone === "green"
      ? "bg-brand-500"
      : tone === "amber"
        ? "bg-warning"
        : "bg-slate-300";

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cn("h-full rounded-full transition-all duration-500", barColor)}
        style={{ width: `${Math.min(score, 100)}%` }}
      />
    </div>
  );
}

/** Número de posição no ranking (1º, 2º, 3º…). */
function RankBadge({ rank }: { rank: number }) {
  const isTop3 = rank <= 3;
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black",
        rank === 1
          ? "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(14,164,107,.6)]"
          : rank === 2
            ? "bg-slate-700 text-white"
            : rank === 3
              ? "bg-amber-500 text-white"
              : isTop3
                ? "bg-slate-100 text-slate-600"
                : "bg-slate-100 text-slate-400",
      )}
    >
      {rank}
    </span>
  );
}

interface LeadPriorityCardProps {
  lead: LeadListItem;
  rank: number;
  labels?: PipelineLabels | null;
}

export function LeadPriorityCard({ lead, rank, labels, onCallLogged }: LeadPriorityCardProps & { onCallLogged?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  // callState controla o fluxo de "Ligar agora":
  //  idle      → estado normal, botão disponível
  //  calling   → link tel: foi acionado, aguardando o vendedor terminar
  //  logging   → modal de registro aberto
  const [callState, setCallState] = useState<"idle" | "calling" | "logging">("idle");
  const statusMeta = resolveStatusMeta(labels);

  // Justificativa: dividida em resumo (1ª frase) e detalhe (restante).
  // A IA geralmente escreve em 1–3 frases — separamos na 1ª. para o accordeon.
  const justification = lead.scoreJustification ?? "";
  const firstDot = justification.search(/\.\s/);
  const summary =
    firstDot > 0 && firstDot < justification.length - 2
      ? justification.slice(0, firstDot + 1)
      : justification;
  const detail =
    firstDot > 0 && firstDot < justification.length - 2
      ? justification.slice(firstDot + 2).trim()
      : "";
  const hasDetail = detail.length > 0;

  // Link tel: para discagem direta.
  const telHref = `tel:${lead.phone}`;

  function handleCallClick() {
    // Abre o discador nativo e imediatamente muda o estado para "calling".
    // O botão "Registrar resultado" fica visível enquanto a ligação acontece.
    setCallState("calling");
  }

  function handleLogResult() {
    setCallState("logging");
  }

  function handleModalClose() {
    setCallState("idle");
  }

  function handleSaved() {
    setCallState("idle");
    onCallLogged?.();
  }

  return (
    <article
      className={cn(
        "group rounded-2xl border bg-card transition-shadow",
        "shadow-[0_1px_2px_rgba(10,20,16,.04),0_4px_16px_-8px_rgba(10,20,16,.08)]",
        "hover:shadow-[0_2px_4px_rgba(10,20,16,.06),0_8px_24px_-8px_rgba(10,20,16,.14)]",
        rank === 1
          ? "border-brand-300 ring-1 ring-brand-200"
          : "border-line",
      )}
    >
      <div className="p-4 sm:p-5">
        {/* ── Linha superior: rank + nome + score ── */}
        <div className="flex items-start gap-3">
          <RankBadge rank={rank} />

          <div className="min-w-0 flex-1">
            {/* Nome e telefone */}
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/leads/${lead.id}`}
                className="font-display text-base font-bold text-ink hover:text-brand-600 hover:underline"
              >
                {lead.name}
              </Link>
              <span className="font-mono text-xs text-slate-400">
                {formatPhone(lead.phone)}
              </span>
            </div>

            {/* Badges de status + tags */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <LeadStatusBadge
                status={lead.status}
                label={statusMeta[lead.status].label}
              />
              {lead.optOut && <Badge tone="red">Opt-out</Badge>}
              {lead.tags.map((t) => (
                <TagChip key={t.id} name={t.name} color={t.color} />
              ))}
            </div>
          </div>

          {/* Score: número grande + tier */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "font-display text-3xl font-black tabular-nums leading-none",
                lead.score >= 70
                  ? "text-brand-600"
                  : lead.score >= 40
                    ? "text-warning"
                    : "text-slate-400",
              )}
            >
              {lead.score}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              /100
            </span>
          </div>
        </div>

        {/* ── Barra de score ── */}
        <div className="mt-3">
          <ScoreBar score={lead.score} />
          <div className="mt-1.5">
            <ScoreTier score={lead.score} />
          </div>
        </div>

        {/* ── Justificativa da IA ── */}
        {justification ? (
          <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-slate-800/40">
            <div className="flex items-start gap-2">
              <Sparkles
                size={13}
                className="mt-0.5 shrink-0 text-brand-500"
              />
              <div className="min-w-0 flex-1">
                {/* Resumo — sempre visível */}
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {summary}
                </p>

                {/* Detalhe — collapsível */}
                {hasDetail && (
                  <>
                    {expanded && (
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                        {detail}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
                    >
                      {expanded ? (
                        <>
                          <ChevronUp size={12} /> Menos detalhes
                        </>
                      ) : (
                        <>
                          <ChevronDown size={12} /> Ver mais detalhes
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-slate-800/40">
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Sparkles size={12} className="shrink-0" />
              Aguardando qualificação pela IA…
            </p>
          </div>
        )}

        {/* ── Última mensagem (contexto rápido) ── */}
        {lead.lastMessage && (
          <p className="mt-3 line-clamp-1 text-xs text-slate-400">
            <span className="font-semibold text-slate-500">Última msg:</span>{" "}
            {lead.lastMessage}
          </p>
        )}

        {/* ── Rodapé: atividade + ações ── */}
        <div className="mt-4 space-y-2.5">
          {/* Barra de ações principal */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              Atualizado {timeAgo(lead.updatedAt)}
            </span>

            <div className="flex items-center gap-2">
              {/* Ver conversa */}
              <Link
                href={`/leads/${lead.id}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl border border-line-default bg-card",
                  "px-3 py-1.5 text-xs font-semibold text-slate-600",
                  "transition-colors hover:border-brand-400 hover:bg-inset hover:text-ink",
                )}
              >
                <MessageSquare size={13} /> Ver conversa
              </Link>

              {/* Ligar agora — abre o discador nativo e entra no estado "calling" */}
              {callState === "idle" && (
                <a
                  href={telHref}
                  onClick={handleCallClick}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold",
                    "bg-brand-500 text-white shadow-[0_4px_12px_-4px_rgba(14,164,107,.5)]",
                    "transition-colors hover:bg-brand-600",
                  )}
                >
                  <Phone size={13} /> Ligar agora
                </a>
              )}

              {/* Estado pós-discagem: aguardando o vendedor registrar o resultado */}
              {callState === "calling" && (
                <button
                  type="button"
                  onClick={handleLogResult}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold",
                    "bg-warning text-white shadow-[0_4px_12px_-4px_rgba(245,158,11,.45)]",
                    "animate-pulse transition-colors hover:animate-none hover:bg-amber-600",
                  )}
                >
                  <ClipboardList size={13} /> Registrar resultado
                </button>
              )}
            </div>
          </div>

          {/* Dica contextual enquanto a ligação está em andamento */}
          {callState === "calling" && (
            <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-surface px-3 py-2">
              <Phone size={12} className="shrink-0 text-warning" />
              <p className="text-xs text-warning">
                Ligação iniciada. Ao terminar, clique em{" "}
                <strong>Registrar resultado</strong> para anotar o que foi combinado.
              </p>
              <button
                type="button"
                onClick={() => setCallState("idle")}
                className="ml-auto shrink-0 text-[11px] font-semibold text-warning hover:underline"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal de registro — montado fora do fluxo do card para não ter z-index issues */}
      <CallResultModal
        open={callState === "logging"}
        leadId={lead.id}
        leadName={lead.name}
        onClose={handleModalClose}
        onSaved={handleSaved}
      />
    </article>
  );
}
