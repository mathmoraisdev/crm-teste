"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, X, Users } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { LoadingBlock } from "@/components/ui/Spinner";
import { formatPhone } from "@/lib/phone";
import { formatCentsBRL } from "@/lib/money";
import { ClienteFicha } from "@/components/clientes/ClienteFicha";
import type { ClienteListItem } from "@/server/services/cliente.service";

/** Rótulo relativo p/ a última visita (Hoje / Amanhã improvável, mas Ontem / dd/mm). */
function formatLastVisit(iso: string | null): string {
  if (!iso) return "—";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} dias atrás`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function ClientesView() {
  const [clientes, setClientes] = useState<ClienteListItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/clientes?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setClientes(data.items as ClienteListItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  // Busca com debounce (nome OU telefone com máscara — a busca por dígitos casa).
  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [query, load]);

  const selected = clientes?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.025em] text-ink sm:text-[30px]">
          Clientes
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Ficha e histórico de serviços de cada cliente — quem comprou, quando e quanto gastou.
        </p>
      </div>

      {/* Busca */}
      <div className="relative min-w-[220px] max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="w-full rounded-lg border border-line-default bg-card py-2 pl-9 pr-8 text-sm text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Limpar busca"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Lista */}
        <Card>
          {clientes === null ? (
            <LoadingBlock label="Carregando clientes…" />
          ) : clientes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-slate-500">
              <Users size={26} className="text-slate-300" />
              {query
                ? "Nenhum cliente corresponde à busca."
                : "Nenhum cliente ainda. Quando você abrir uma comanda ligada a um contato, ele aparece aqui."}
            </div>
          ) : (
            <ul className="divide-y divide-line-default">
              {clientes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                      c.id === selectedId ? "bg-brand-50/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{c.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">{formatPhone(c.phone)}</p>
                    </div>
                    <div className="flex-none text-right">
                      <p className="text-sm font-bold text-ink">{formatCentsBRL(c.totalSpentCents)}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {c.orderCount > 0
                          ? `${formatLastVisit(c.lastOrderAt ? new Date(c.lastOrderAt).toISOString() : null)} · ${c.orderCount}×`
                          : "sem compras"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Ficha do cliente selecionado */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <ClienteFicha clienteId={selected.id} />
          ) : (
            <Card className="flex items-center justify-center px-6 py-16">
              <p className="text-sm text-slate-400">Selecione um cliente para ver a ficha.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
