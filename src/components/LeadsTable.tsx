"use client";

import Link from "next/link";
import { Table, Th, Td } from "@/components/ui/Table";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { ScoreBadge } from "@/components/ScoreBadge";
import { formatPhone } from "@/lib/phone";
import { timeAgo } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

export function LeadsTable({ leads }: { leads: LeadListItem[] }) {
  if (leads.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Nenhum lead ainda. Importe um CSV para começar.
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
        </tr>
      </thead>
      <tbody>
        {leads.map((l) => (
          <tr key={l.id} className="group hover:bg-slate-50">
            <Td>
              <Link href={`/leads/${l.id}`} className="block">
                <span className="font-medium text-slate-800 group-hover:text-brand-600">
                  {l.name}
                </span>
                <span className="block text-xs text-slate-400">
                  {formatPhone(l.phone)}
                </span>
              </Link>
            </Td>
            <Td>
              <LeadStatusBadge status={l.status} />
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
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
