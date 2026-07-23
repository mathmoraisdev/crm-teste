"use client";

import { memo } from "react";
import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Table, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { TagChip } from "@/components/TagChip";
import { formatPhone } from "@/lib/phone";
import { timeAgo } from "@/lib/utils";
import { resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import type { LeadListItem } from "@/server/services/lead.service";

// memo: digitar na busca muda só estados do pai (query) sem trocar a referência
// de `leads` → a tabela inteira não re-renderiza. onEdit/onDelete são setters
// estáveis de useState; `labels` é estado estável.
export const LeadsTable = memo(function LeadsTable({
  leads,
  onEdit,
  onDelete,
  labels,
}: {
  leads: LeadListItem[];
  onEdit: (lead: LeadListItem) => void;
  onDelete: (lead: LeadListItem) => void;
  labels?: PipelineLabels | null;
}) {
  const statusMeta = resolveStatusMeta(labels);
  if (leads.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Nenhum lead corresponde aos filtros.
      </div>
    );
  }

  return (
    <>
      {/* Mobile: cards */}
      <ul className="divide-y divide-slate-100 lg:hidden">
        {leads.map((l) => (
          <li key={l.id} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                <span className="block font-bold text-ink">{l.name}</span>
                <span className="block font-mono text-[11.5px] text-slate-400">
                  {formatPhone(l.phone)}
                </span>
              </Link>
              <ScoreBadge score={l.score} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <LeadStatusBadge status={l.status} label={statusMeta[l.status].label} />
              {l.optOut && <Badge tone="red">Opt-out</Badge>}
              {l.campaignName && (
                <span className="text-xs text-slate-500">· {l.campaignName}</span>
              )}
            </div>

            {l.lastMessage && (
              <p className="mt-2 line-clamp-2 text-xs text-slate-500">
                {l.lastMessage}
              </p>
            )}

            {l.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {l.tags.map((t) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            )}

            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-xs text-slate-400">{timeAgo(l.updatedAt)}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(l)}
                  aria-label="Editar lead"
                  title="Editar"
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(l)}
                  aria-label="Apagar lead"
                  title="Apagar"
                  className="text-danger hover:bg-danger-surface"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: tabela */}
      <div className="hidden lg:block">
        <Table>
      <thead>
        <tr>
          <Th>Lead</Th>
          <Th>Status</Th>
          <Th className="text-center">Score</Th>
          <Th>Última mensagem</Th>
          <Th>Campanha</Th>
          <Th className="text-right">Atividade</Th>
          <Th className="text-right">Ações</Th>
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr key={l.id} className="group hover:bg-slate-50">
            <Td>
              <Link href={`/leads/${l.id}`} className="block">
                <span className="font-bold text-ink group-hover:text-brand-600">
                  {l.name}
                </span>
                <span className="block font-mono text-[11.5px] text-slate-400">
                  {formatPhone(l.phone)}
                </span>
              </Link>
              {l.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {l.tags.map((t) => (
                    <TagChip key={t.id} name={t.name} color={t.color} />
                  ))}
                </div>
              )}
            </Td>
            <Td>
              <div className="flex flex-wrap items-center gap-1.5">
                <LeadStatusBadge status={l.status} label={statusMeta[l.status].label} />
                {l.optOut && <Badge tone="red">Opt-out</Badge>}
              </div>
            </Td>
            <Td className="text-center">
              <ScoreBadge score={l.score} />
            </Td>
            <Td className="max-w-xs">
              <span className="line-clamp-1 text-slate-600">
                {l.lastMessage ?? <span className="text-slate-300">—</span>}
              </span>
            </Td>
            <Td>
              <span className="text-xs text-slate-500">
                {l.campaignName ?? "—"}
              </span>
            </Td>
            <Td className="text-right text-xs text-slate-400">
              {timeAgo(l.updatedAt)}
            </Td>
            <Td className="text-right">
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(l)}
                  aria-label="Editar lead"
                  title="Editar"
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(l)}
                  aria-label="Apagar lead"
                  title="Apagar"
                  className="text-danger hover:bg-danger-surface"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
        </Table>
      </div>
    </>
  );
});
