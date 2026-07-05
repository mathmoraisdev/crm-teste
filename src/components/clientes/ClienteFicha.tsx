"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Receipt, ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { LeadForm } from "@/components/LeadForm";
import { LoadingBlock } from "@/components/ui/Spinner";
import { formatPhone } from "@/lib/phone";
import { formatCentsBRL } from "@/lib/money";
import { PAYMENT_LABEL, PAYMENT_TONE, type Payment } from "@/components/vendas/payment-labels";
import { AppointmentSection } from "@/components/clientes/AppointmentSection";
import type { ClienteHistory } from "@/server/services/cliente.service";

// Datas chegam serializadas (string) do fetch, embora o tipo declare Date — o
// construtor aceita ambos.
function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ClienteFicha({ clienteId }: { clienteId: string }) {
  const [data, setData] = useState<ClienteHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, { cache: "no-store" });
      if (res.ok) setData((await res.json()) as ClienteHistory);
    } catch {
      /* mantém estado anterior */
    } finally {
      setLoading(false);
    }
  }, [clienteId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !data) {
    return (
      <Card>
        <LoadingBlock label="Carregando ficha…" />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="px-6 py-10">
        <p className="text-center text-sm text-slate-400">Não foi possível carregar a ficha.</p>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader
        title={data.lead.name}
        subtitle={formatPhone(data.lead.phone)}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={14} /> Editar
            </Button>
            <Link href={`/caixa?leadId=${data.lead.id}`}>
              <Button size="sm">
                <Plus size={14} /> Nova comanda
              </Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-4 px-4 py-4">
        {/* Resumo */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line-default bg-card px-3 py-2.5">
            <p className="text-xs text-slate-500">Total gasto</p>
            <p className="text-lg font-bold text-ink">{formatCentsBRL(data.totalSpentCents)}</p>
          </div>
          <div className="rounded-lg border border-line-default bg-card px-3 py-2.5">
            <p className="text-xs text-slate-500">Comandas fechadas</p>
            <p className="text-lg font-bold text-ink">{data.orderCount}</p>
          </div>
        </div>

        {/* Agendamentos (próximos + histórico de status) */}
        <AppointmentSection leadId={data.lead.id} />

        {/* Histórico de serviços */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Receipt size={15} className="text-slate-400" />
            <h3 className="text-sm font-bold text-ink">Histórico de serviços</h3>
          </div>

          {data.orders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-default px-3 py-6 text-center text-sm text-slate-400">
              Nenhuma comanda ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.orders.map((o) => (
                <li key={o.id} className="rounded-lg border border-line-default bg-card px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {formatDate(o.closedAt ?? o.createdAt)}
                    </span>
                    <div className="flex items-center gap-2">
                      {o.status === "ABERTA" ? (
                        <Badge tone="amber">Aberta</Badge>
                      ) : o.payment ? (
                        <Badge tone={PAYMENT_TONE[o.payment as Payment]}>
                          {PAYMENT_LABEL[o.payment as Payment]}
                        </Badge>
                      ) : null}
                      <span className="text-sm font-bold text-ink">{formatCentsBRL(o.totalCents)}</span>
                    </div>
                  </div>
                  {o.items.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {o.items.map((it) => (
                        <li key={it.id} className="flex justify-between text-xs text-slate-600">
                          <span className="min-w-0 truncate">
                            {it.quantity > 1 && <span className="text-slate-400">{it.quantity}× </span>}
                            {it.nameSnapshot}
                          </span>
                          <span className="flex-none text-slate-400">
                            {formatCentsBRL(it.unitPriceCents * it.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.note && <p className="mt-1 text-xs italic text-slate-400">{o.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link
          href={`/leads/${data.lead.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:underline"
        >
          Abrir conversa / CRM <ExternalLink size={12} />
        </Link>
      </div>
    </Card>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Editar — ${data.lead.name}`}
      >
        <LeadForm
          lead={{
            id: data.lead.id,
            name: data.lead.name,
            phone: data.lead.phone,
            email: data.lead.email,
            status: data.lead.status,
            optOut: data.lead.optOut,
          }}
          onSaved={() => {
            setEditOpen(false);
            load(); // nome/telefone/e-mail podem ter mudado — recarrega a ficha
          }}
        />
      </Modal>
    </>
  );
}
