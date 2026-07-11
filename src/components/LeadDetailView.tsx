"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Headset, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadStatusBadge } from "@/components/LeadStatusBadge";
import { LeadForm } from "@/components/LeadForm";
import { ConversationView } from "@/components/ConversationView";
import { QualificationPanel } from "@/components/QualificationPanel";
import { TagPicker } from "@/components/TagPicker";
import { formatPhone } from "@/lib/phone";
import { formatCentsBRL } from "@/lib/money";
import { resolveStatusMeta, type PipelineLabels } from "@/lib/leadStatus";
import type { LeadDetail } from "@/server/services/lead.service";

const SALE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  PAID: "Pago",
  EXPIRED: "Expirado",
  CANCELED: "Cancelado",
};

export function LeadDetailView({
  leadId,
  canSimulate = false,
}: {
  leadId: string;
  /** Modo mock (dev/avaliador): libera a caixa que simula o lead respondendo. */
  canSimulate?: boolean;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [pipelineLabels, setPipelineLabels] = useState<PipelineLabels>({});

  useEffect(() => {
    fetch("/api/account/pipeline-labels", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPipelineLabels((d.labels as PipelineLabels) ?? {}))
      .catch(() => {});
  }, []);

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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink sm:text-[28px]">
            {lead.name}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatPhone(lead.phone)}
            {lead.email && <> · {lead.email}</>}
            {lead.campaign && <> · {lead.campaign.name}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadStatusBadge
            status={lead.status}
            label={resolveStatusMeta(pipelineLabels)[lead.status].label}
          />
          <Link
            href={`/inbox?c=${lead.id}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line-default bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:border-brand-400 hover:bg-inset"
          >
            <Headset size={14} /> Atendimento
          </Link>
          {(lead.status === "DESCARTADO" || lead.optOut) && (
            <Button variant="secondary" size="sm" onClick={() => setReactivateOpen(true)}>
              <RotateCcw size={14} /> Reativar
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil size={14} /> Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="text-danger hover:bg-danger-surface"
          >
            <Trash2 size={14} /> Apagar
          </Button>
        </div>
      </div>

      <TagPicker
        leadId={lead.id}
        value={lead.tags}
        onChange={(tags) => setLead((prev) => (prev ? { ...prev, tags } : prev))}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Conversa" subtitle="WhatsApp (mock)" />
            <ConversationView
              leadId={lead.id}
              leadName={lead.name}
              messages={lead.messages}
              onReplied={load}
              canReply={canReply}
              aiPaused={lead.aiPaused}
              canSimulate={canSimulate}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <QualificationPanel
            qualification={lead.qualification}
            meeting={lead.meeting}
            customFields={lead.customFields}
          />
          {lead.sales.length > 0 && <SalePanel sale={lead.sales[0]} />}
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
          labels={pipelineLabels}
          onSaved={() => {
            load();
            setEditOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={reactivateOpen}
        title="Reativar lead"
        confirmLabel="Reativar"
        danger={false}
        message={
          <>
            <strong>{lead.name}</strong> foi descartado/opt-out (pediu para não ser
            abordado). Reativar volta o status para <strong>Em conversa</strong> e
            remove o opt-out, liberando a IA e as campanhas para este contato.
          </>
        }
        onConfirm={async () => {
          const res = await fetch(`/api/leads/${lead.id}/reactivate`, { method: "POST" });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Falha ao reativar lead");
          }
          load();
        }}
        onClose={() => setReactivateOpen(false)}
      />

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

/** Painel da venda mais recente do lead (oferta, valor, status, Pix). */
function SalePanel({ sale }: { sale: LeadDetail["sales"][number] }) {
  const tone =
    sale.status === "PAID"
      ? "text-brand-700"
      : sale.status === "PENDING"
        ? "text-warning"
        : "text-slate-500";
  return (
    <Card>
      <CardHeader title="Venda" subtitle="Cobrança gerada pela IA (Pix)." />
      <div className="space-y-2 px-5 py-4 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Oferta</span>
          <span className="font-medium text-ink">{sale.offer?.name ?? "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Valor</span>
          <span className="font-medium text-ink">{formatCentsBRL(sale.amountCents)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Status</span>
          <span className={`font-semibold ${tone}`}>
            {SALE_STATUS_LABEL[sale.status] ?? sale.status}
          </span>
        </div>
        {sale.status === "PENDING" && sale.pixCopiaECola && (
          <div className="pt-1">
            <p className="mb-1 text-xs font-medium text-slate-500">Pix copia e cola</p>
            <textarea
              readOnly
              value={sale.pixCopiaECola}
              rows={3}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
