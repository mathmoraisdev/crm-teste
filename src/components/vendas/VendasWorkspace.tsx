"use client";

import { useState } from "react";
import { OrderBoard } from "./OrderBoard";
import { CatalogManager } from "./CatalogManager";
import { ReportsPanel } from "./ReportsPanel";

type Tab = "comandas" | "catalogo" | "relatorios";

const TABS: { value: Tab; label: string }[] = [
  { value: "comandas", label: "Comandas" },
  { value: "catalogo", label: "Catálogo" },
  { value: "relatorios", label: "Relatórios" },
];

export function VendasWorkspace({
  canEdit,
  accountBusinessId,
}: {
  canEdit: boolean;
  accountBusinessId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("comandas");

  return (
    <div className="space-y-5">
      {/* Abas */}
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((t) => (
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
      {tab === "relatorios" && <ReportsPanel />}
    </div>
  );
}
