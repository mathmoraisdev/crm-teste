"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { Table, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { formatPhone } from "@/lib/phone";
import { timeAgo } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

export function LeadsTable({
  leads,
  onEdit,
  onDelete,
}: {
  leads: LeadListItem[];
  onEdit: (lead: LeadListItem) => void;
  onDelete: (lead: LeadListItem) => void;
}) {
  if (leads.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Nenhum lead corresponde aos filtros.
      </div>
    );
  }

  return (
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
            </Td>
            <Td>
              <div className="flex flex-wrap items-center gap-1.5">
                <LeadStatusBadge status={l.status} />
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
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
