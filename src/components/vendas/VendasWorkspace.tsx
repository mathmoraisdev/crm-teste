"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/app/StatCard";
import { formatCentsBRL } from "@/lib/money";
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
      {/* Faixa de KPIs de hoje — dá o pulso do caixa sem entrar em Relatórios */}
      <CashHeaderStats canEdit={canEdit} />

      {/* Abas */}
      <div className="inline-flex rounded-xl border border-line-default bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-brand-500 text-white dark:bg-brand-500/15 dark:text-brand-300 dark:ring-1 dark:ring-inset dark:ring-brand-500/40"
                : "text-slate-600 hover:bg-slate-100"
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
      {tab === "relatorios" && <ReportsPanel canEdit={canEdit} />}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Faixa de KPIs do dia. Reaproveita o endpoint do Resumo (period=hoje). Poll
// leve p/ refletir comandas fechadas sem recarregar a página. Dono/gerente
// (canEdit) vê Saldo (fatura − despesas); operador vê Comandas no lugar.
// ───────────────────────────────────────────────────────────────────────
interface TodaySummary {
  summary: { totalCents: number; orderCount: number; avgTicketCents: number };
  balanceCents?: number;
}

function CashHeaderStats({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<TodaySummary | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/vendas/reports?period=hoje", { cache: "no-store" });
        const d = await res.json();
        if (active && res.ok) setData(d as TodaySummary);
      } catch {
        /* mantém estado anterior */
      }
    }
    load();
    const t = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const s = data?.summary;
  const balance = data?.balanceCents;

  return (
    <div className={`grid grid-cols-2 gap-4 ${canEdit ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      <StatCard
        label="Faturamento hoje"
        value={s ? formatCentsBRL(s.totalCents) : "—"}
        hint="vendas do dia"
        accent
      />
      {/* Saldo só p/ dono/gerente (depende de despesas, que o operador não vê). */}
      {canEdit && (
        <StatCard
          label="Saldo hoje"
          value={
            balance === undefined ? (
              "—"
            ) : (
              <span className={balance < 0 ? "text-danger" : undefined}>{formatCentsBRL(balance)}</span>
            )
          }
          hint="faturamento − despesas"
        />
      )}
      <StatCard label="Ticket médio" value={s ? formatCentsBRL(s.avgTicketCents) : "—"} hint="por comanda" />
      <StatCard label="Comandas hoje" value={s ? s.orderCount : "—"} hint="fechadas no dia" />
    </div>
  );
}
