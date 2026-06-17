"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Table, Th, Td } from "@/components/ui/Table";
import { LoadingBlock } from "@/components/ui/Spinner";
import { CampaignForm } from "@/components/CampaignForm";
import type { CampaignListItem } from "@/server/services/campaign.service";

const STATUS_TONE = {
  DRAFT: "slate",
  RUNNING: "amber",
  COMPLETED: "green",
} as const;

const STATUS_LABEL = {
  DRAFT: "Rascunho",
  RUNNING: "Disparando",
  COMPLETED: "Concluída",
} as const;

export function CampaignsView() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/campaigns", { cache: "no-store" });
      const data = await res.json();
      setCampaigns(data.campaigns as CampaignListItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function start(id: string) {
    setStartingId(id);
    setFlash(null);
    try {
      const res = await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao iniciar");
      setFlash(`Campanha iniciada: ${data.sent} mensagens enviadas.`);
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "Erro ao iniciar campanha");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campanhas</h1>
          <p className="text-sm text-slate-500">
            Crie uma campanha, associe os leads novos e dispare a mensagem
            inicial.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw size={14} /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> Nova campanha
          </Button>
        </div>
      </div>

      {flash && (
        <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-700">
          {flash}
        </div>
      )}

      {campaigns === null ? (
        <Card>
          <LoadingBlock label="Carregando campanhas…" />
        </Card>
      ) : campaigns.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-slate-500">
            Nenhuma campanha ainda. Crie a primeira para disparar mensagens.
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Campanha</Th>
                <Th>Status</Th>
                <Th className="text-center">Leads</Th>
                <Th className="text-center">Pendentes</Th>
                <Th className="text-right">Ação</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium text-slate-800">{c.name}</span>
                    <span className="block max-w-md truncate text-xs text-slate-400">
                      {c.messageTemplate}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE]}>
                      {STATUS_LABEL[c.status as keyof typeof STATUS_LABEL] ??
                        c.status}
                    </Badge>
                  </Td>
                  <Td className="text-center tabular-nums">{c.leadCount}</Td>
                  <Td className="text-center tabular-nums">{c.pendingCount}</Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      onClick={() => start(c.id)}
                      loading={startingId === c.id}
                      disabled={c.pendingCount === 0}
                    >
                      <Play size={13} />
                      {c.pendingCount === 0 ? "Disparada" : "Iniciar"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Nova campanha"
      >
        <CampaignForm
          onCreated={() => {
            load();
            setFormOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}
