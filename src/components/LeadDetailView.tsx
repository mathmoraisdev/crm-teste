"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { ConversationView } from "@/components/ConversationView";
import { QualificationPanel } from "@/components/QualificationPanel";
import { formatPhone } from "@/lib/phone";
import type { LeadDetail } from "@/server/services/lead.service";

export function LeadDetailView({ leadId }: { leadId: string }) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}`, { cache: "no-store" });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setLead(data.lead as LeadDetail);
    } catch {
      // ignora falha transiente; mantém estado
    }
  }, [leadId]);

  // Polling para ver a IA respondendo / mudança de status em near-real-time.
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  if (notFound) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Lead não encontrado.{" "}
        <Link href="/leads" className="text-brand-600 hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  if (!lead) {
    return (
      <Card>
        <LoadingBlock label="Carregando lead…" />
      </Card>
    );
  }

  const canReply = lead.status !== "NOVO";

  return (
    <div className="space-y-4">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={15} /> Voltar para leads
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{lead.name}</h1>
          <p className="text-sm text-slate-500">
            {formatPhone(lead.phone)}
            {lead.campaign && <> · {lead.campaign.name}</>}
          </p>
        </div>
        <LeadStatusBadge status={lead.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Conversa" subtitle="WhatsApp (mock)" />
            <ConversationView
              leadId={lead.id}
              messages={lead.messages}
              onReplied={load}
              canReply={canReply}
            />
          </Card>
        </div>
        <div>
          <QualificationPanel
            qualification={lead.qualification}
            meeting={lead.meeting}
          />
        </div>
      </div>
    </div>
  );
}
