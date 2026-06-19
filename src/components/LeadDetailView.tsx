"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { LeadForm } from "@/components/LeadForm";
import { ConversationView } from "@/components/ConversationView";
import { QualificationPanel } from "@/components/QualificationPanel";
import { formatPhone } from "@/lib/phone";
import type { LeadDetail } from "@/server/services/lead.service";

export function LeadDetailView({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
          <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">
            {lead.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatPhone(lead.phone)}
            {lead.email && <> · {lead.email}</>}
            {lead.campaign && <> · {lead.campaign.name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LeadStatusBadge status={lead.status} />
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil size={14} /> Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-red-600 hover:bg-red-50"
          >
            <Trash2 size={14} /> Apagar
          </Button>
        </div>
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

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Editar — ${lead.name}`}>
        <LeadForm
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            status: lead.status,
            optOut: lead.optOut,
          }}
          onSaved={() => {
            load();
            setEditOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Apagar lead"
        confirmLabel="Apagar"
        message={
          <>
            Apagar <strong>{lead.name}</strong>? Toda a conversa, qualificação e
            agendamento desse lead serão removidos. Esta ação não pode ser
            desfeita.
          </>
        }
        onConfirm={async () => {
          const res = await fetch(`/api/leads/${lead.id}`, { method: "DELETE" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Falha ao apagar lead");
          }
          router.push("/leads");
        }}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
