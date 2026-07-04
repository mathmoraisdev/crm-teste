"use client";

import { useState } from "react";
import { OrderBoard } from "./OrderBoard";
import { CatalogManager } from "./CatalogManager";
import { StockPanel } from "./StockPanel";
import { ExpensesPanel } from "./ExpensesPanel";
import { ReportsPanel } from "./ReportsPanel";

type Tab = "comandas" | "catalogo" | "estoque" | "despesas" | "relatorios";

export function VendasWorkspace({
  canEdit,
  accountBusinessId,
}: {
  canEdit: boolean;
  accountBusinessId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("comandas");

  // Estoque e Despesas são do dono (canEdit = canSettings) — operador nem vê as abas.
  const tabs: { value: Tab; label: string }[] = [
    { value: "comandas", label: "Comandas" },
    { value: "catalogo", label: "Catálogo" },
    ...(canEdit ? [{ value: "estoque" as const, label: "Estoque" }] : []),
    ...(canEdit ? [{ value: "despesas" as const, label: "Despesas" }] : []),
    { value: "relatorios", label: "Relatórios" },
  ];

  return (
    <div className="space-y-5">
      {/* Abas */}
      <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "comandas" && <OrderBoard />}
      {tab === "catalogo" && <CatalogManager canEdit={canEdit} accountBusinessId={accountBusinessId} />}
      {tab === "estoque" && canEdit && <StockPanel />}
      {tab === "despesas" && canEdit && <ExpensesPanel />}
      {tab === "relatorios" && <ReportsPanel />}
    </div>
  );
}
