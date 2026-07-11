"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

export type AuditRow = {
  id: string;
  createdAt: string; // ISO
  actorName: string;
  action: string;
  entityType: string;
  summary: string;
};

// Rótulos pt-BR das ações (a coluna "Ação" mostra o rótulo; o resumo carrega o detalhe).
const ACTION_LABEL: Record<string, string> = {
  ORDER_VOID: "Estorno de comanda",
  EXPENSE_DELETE: "Excluiu despesa",
  LEAD_DELETE: "Excluiu cliente",
  LEAD_REASSIGN: "Reatribuiu cliente",
  LEAD_UPDATE: "Editou cliente",
  OPERATOR_PERMS_UPDATE: "Permissões de operador",
  ORDER_DISCOUNT: "Ajuste de comanda",
  CATALOG_PRICE_UPDATE: "Alterou preço",
};

const ENTITY_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Tudo" },
  { value: "Order", label: "Comandas" },
  { value: "Lead", label: "Clientes" },
  { value: "Expense", label: "Despesas" },
  { value: "CatalogItem", label: "Catálogo" },
  { value: "User", label: "Operadores" },
];

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function AuditTable({
  initialItems,
  initialCursor,
}: {
  initialItems: AuditRow[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<AuditRow[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [entityType, setEntityType] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(reset: boolean, nextEntityType = entityType) {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (nextEntityType) sp.set("entityType", nextEntityType);
      if (!reset && cursor) sp.set("cursor", cursor);
      const res = await fetch(`/api/audit?${sp.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { items: AuditRow[]; nextCursor: string | null };
      setItems((prev) => (reset ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  function onFilter(v: string) {
    setEntityType(v);
    void load(true, v);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ENTITY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onFilter(f.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              entityType === f.value
                ? "bg-forest text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-semibold">Quando</th>
                <th className="px-4 py-3 font-semibold">Quem</th>
                <th className="px-4 py-3 font-semibold">Ação</th>
                <th className="px-4 py-3 font-semibold">Resumo</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-slate-500">
                    Nenhuma ação registrada ainda.
                  </td>
                </tr>
              ) : (
                items.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmtWhen(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{r.actorName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {ACTION_LABEL[r.action] ?? r.action}
                    </td>
                    <td className="px-4 py-3 text-ink">{r.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loading}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-ink hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
