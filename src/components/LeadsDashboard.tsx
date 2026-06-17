"use client";

import { useCallback, useEffect, useState } from "react";
import { LayoutGrid, List, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { LoadingBlock } from "@/components/ui/Spinner";
import { LeadsTable } from "@/components/LeadsTable";
import { PipelineBoard } from "@/components/PipelineBoard";
import { CsvUpload } from "@/components/CsvUpload";
import { cn } from "@/lib/utils";
import type { LeadListItem } from "@/server/services/lead.service";

type View = "table" | "board";

export function LeadsDashboard() {
  const [leads, setLeads] = useState<LeadListItem[] | null>(null);
  const [view, setView] = useState<View>("table");
  const [importOpen, setImportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leads", { cache: "no-store" });
      const data = await res.json();
      setLeads(data.leads as LeadListItem[]);
    } catch {
      // mantém o estado anterior em caso de falha de rede transiente
    }
  }, []);

  // Carga inicial + polling leve a cada 4s para refletir mudanças do pipeline.
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  async function manualRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-slate-500">
            {leads?.length ?? "—"} leads no funil · atualização automática
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
            <button
              onClick={() => setView("table")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium",
                view === "table"
                  ? "bg-brand-500 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <List size={14} /> Tabela
            </button>
            <button
              onClick={() => setView("board")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium",
                view === "board"
                  ? "bg-brand-500 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
          </div>
          <Button variant="secondary" size="sm" onClick={manualRefresh} loading={refreshing}>
            <RefreshCw size={14} /> Atualizar
          </Button>
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Importar CSV
          </Button>
        </div>
      </div>

      {leads === null ? (
        <Card>
          <LoadingBlock label="Carregando leads…" />
        </Card>
      ) : view === "table" ? (
        <Card>
          <LeadsTable leads={leads} />
        </Card>
      ) : (
        <PipelineBoard leads={leads} />
      )}

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar leads (CSV)"
      >
        <CsvUpload
          onImported={() => {
            load();
            setTimeout(() => setImportOpen(false), 1500);
          }}
        />
      </Modal>
    </div>
  );
}
