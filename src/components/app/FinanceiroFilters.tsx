// src/components/app/FinanceiroFilters.tsx
"use client";

import { useRouter } from "next/navigation";

/** Filtros do painel financeiro: mês + status. Empurram a querystring (server recarrega). */
export function FinanceiroFilters({ month, status }: { month: string; status: string }) {
  const router = useRouter();

  function push(next: { month?: string; status?: string }) {
    const m = next.month ?? month;
    const s = next.status ?? status;
    router.push(`/financeiro?month=${m}&status=${s}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
      <label className="block">
        <span className="text-xs text-slate-500">Mês</span>
        <input
          type="month"
          value={month}
          onChange={(e) => e.target.value && push({ month: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-500">Status da conta</span>
        <select
          value={status}
          onChange={(e) => push({ status: e.target.value })}
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
        >
          <option value="todos">Todos</option>
          <option value="ativo">Ativas</option>
          <option value="suspenso">Suspensas</option>
        </select>
      </label>
    </div>
  );
}
