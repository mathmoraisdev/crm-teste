"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/app/StatCard";
import { formatCentsBRL } from "@/lib/money";
import { OrderBoard } from "./OrderBoard";

// Caixa é o PDV puro: comandas + o pulso do dia. Catálogo, Estoque, Despesas e
// Relatórios agora são rotas próprias (grupos "Catálogo & Estoque"/"Financeiro"
// no menu) — não são mais abas aqui.
export function VendasWorkspace({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="space-y-5">
      {/* Faixa de KPIs de hoje — dá o pulso do caixa sem entrar em Relatórios */}
      <CashHeaderStats canEdit={canEdit} />
      <OrderBoard />
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
