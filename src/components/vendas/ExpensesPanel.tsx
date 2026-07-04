"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, Check, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";
import { CATEGORY_LABEL, CATEGORY_OPTIONS } from "./expense-labels";
import type { ExpenseCategory } from "@prisma/client";

interface Expense {
  id: string;
  description: string;
  amountCents: number;
  category: ExpenseCategory;
  status: "PENDENTE" | "PAGA";
  dueDate: string; // ISO
  paidAt: string | null;
  note: string | null;
  recurringId: string | null;
}

interface Recurring {
  id: string;
  description: string;
  amountCents: number;
  category: ExpenseCategory;
  dayOfMonth: number;
  active: boolean;
}

/** ISO → "DD/MM" no dia-calendário (dueDate fixado ao meio-dia local, estável). */
function formatDayMonth(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** "YYYY-MM-DD" local de hoje (compara datas-calendário como string). */
function todayLocalYMD(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ExpensesPanel() {
  const [payable, setPayable] = useState<Expense[] | null>(null);
  const [paid, setPaid] = useState<Expense[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);

  const [showPaid, setShowPaid] = useState(false);

  const load = useCallback(async () => {
    try {
      const [exp, rec] = await Promise.all([
        fetch("/api/vendas/expenses", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/vendas/expenses/recurring", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setPayable((exp.payable as Expense[]) ?? []);
      setPaid((exp.paid as Expense[]) ?? []);
      setRecurring((rec.recurring as Recurring[]) ?? []);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayLocalYMD();
  const payableTotal = (payable ?? []).reduce((s, e) => s + e.amountCents, 0);

  return (
    <div className="space-y-4">
      {/* ── A pagar ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="A pagar" subtitle="Contas pendentes, ordenadas por vencimento." />
        <div className="space-y-3 px-5 py-4">
          {payable === null ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" /> Carregando…
            </div>
          ) : payable.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma conta pendente.</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {payable.map((e) => {
                  const overdue = e.dueDate.slice(0, 10) < today;
                  return (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-default bg-card px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {e.description}{" "}
                          <span className="text-slate-500">• {formatCentsBRL(e.amountCents)}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {CATEGORY_LABEL[e.category]} · vence{" "}
                          <span className={overdue ? "font-semibold text-red-600" : ""}>
                            {formatDayMonth(e.dueDate)}
                            {overdue ? " (vencida)" : ""}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <PayButton id={e.id} onDone={load} />
                        <DeleteButton onDelete={() => fetch(`/api/vendas/expenses/${e.id}`, { method: "DELETE" }).then(load)} label="Excluir conta" />
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-right text-sm font-semibold text-ink">
                Total a pagar: {formatCentsBRL(payableTotal)}
              </p>
            </>
          )}
        </div>
      </Card>

      {/* ── Nova despesa ─────────────────────────────────────────── */}
      <NewExpenseForm onCreated={load} />

      {/* ── Pagas (recolhível) ───────────────────────────────────── */}
      <Card>
        <button
          type="button"
          onClick={() => setShowPaid((v) => !v)}
          className="flex w-full items-center gap-1.5 px-5 py-3 text-left text-sm font-semibold text-ink hover:bg-inset"
        >
          {showPaid ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Pagas ({paid.length})
        </button>
        {showPaid && (
          <div className="px-5 pb-4">
            {paid.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhuma despesa paga ainda.</p>
            ) : (
              <ul className="space-y-1.5">
                {paid.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-ink">
                      {e.description}
                      <span className="text-slate-400"> · {CATEGORY_LABEL[e.category]}</span>
                    </span>
                    <span className="whitespace-nowrap text-slate-600">{formatCentsBRL(e.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {/* ── Despesas fixas ───────────────────────────────────────── */}
      <RecurringManager recurring={recurring} onChange={load} />
    </div>
  );
}

function PayButton({ id, onDone }: { id: string; onDone: () => void | Promise<void> }) {
  const [loading, setLoading] = useState(false);
  async function pay() {
    setLoading(true);
    try {
      await fetch(`/api/vendas/expenses/${id}/pay`, { method: "POST" });
      await onDone();
    } finally {
      setLoading(false);
    }
  }
  return (
    <Button size="sm" onClick={pay} loading={loading}>
      <Check size={14} /> Marcar paga
    </Button>
  );
}

function DeleteButton({ onDelete, label }: { onDelete: () => void | Promise<void>; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onDelete()}
      className="text-slate-400 hover:text-danger"
      aria-label={label}
    >
      <Trash2 size={15} />
    </button>
  );
}

function NewExpenseForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("OUTRO");
  const [dueDate, setDueDate] = useState(todayLocalYMD());
  const [paidNow, setPaidNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amountCents = parseBRLToCents(amount);
    if (!description.trim()) return setError("Informe a descrição.");
    if (amountCents == null) return setError("Valor inválido.");
    if (!dueDate) return setError("Informe o vencimento.");
    setSaving(true);
    try {
      const res = await fetch("/api/vendas/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), amountCents, category, dueDate, paidNow }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Erro ao salvar.");
      setDescription("");
      setAmount("");
      setCategory("OUTRO");
      setDueDate(todayLocalYMD());
      setPaidNow(false);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Nova despesa" subtitle="Um gasto avulso ou uma conta a pagar." />
      <div className="space-y-2 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição (ex.: Conta de luz)"
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Valor (R$)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-44"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={paidNow}
              onChange={(e) => setPaidNow(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
            />
            Já paguei
          </label>
          <Button onClick={submit} loading={saving} disabled={!description.trim() || !amount.trim()}>
            Adicionar
          </Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Card>
  );
}

function RecurringManager({ recurring, onChange }: { recurring: Recurring[]; onChange: () => void | Promise<void> }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("OUTRO");
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    const amountCents = parseBRLToCents(amount);
    const day = Number(dayOfMonth);
    if (!description.trim()) return setError("Informe a descrição.");
    if (amountCents == null) return setError("Valor inválido.");
    if (!Number.isInteger(day) || day < 1 || day > 31) return setError("Dia inválido (1 a 31).");
    setSaving(true);
    try {
      const res = await fetch("/api/vendas/expenses/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), amountCents, category, dayOfMonth: day }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Erro ao salvar.");
      setDescription("");
      setAmount("");
      setCategory("OUTRO");
      setDayOfMonth("5");
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(r: Recurring) {
    await fetch(`/api/vendas/expenses/recurring/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !r.active }),
    });
    await onChange();
  }

  async function remove(r: Recurring) {
    await fetch(`/api/vendas/expenses/recurring/${r.id}`, { method: "DELETE" });
    await onChange();
  }

  return (
    <Card>
      <CardHeader
        title="Despesas fixas"
        subtitle="Geramos a conta todo mês automaticamente; marque como paga quando pagar."
      />
      <div className="space-y-4 px-5 py-4">
        {recurring.length > 0 && (
          <ul className="space-y-1.5">
            {recurring.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-default bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {r.description}{" "}
                    <span className="text-slate-500">• {formatCentsBRL(r.amountCents)}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {CATEGORY_LABEL[r.category]} · todo dia {r.dayOfMonth}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={r.active}
                      onChange={() => toggle(r)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                    />
                    Ativa
                  </label>
                  <DeleteButton onDelete={() => remove(r)} label="Remover despesa fixa" />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold text-slate-600">Nova despesa fixa</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição (ex.: Aluguel)"
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Valor (R$)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-32"
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className="w-full flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              placeholder="Dia"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-24"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button onClick={add} loading={saving} disabled={!description.trim() || !amount.trim()}>
              Adicionar fixa
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
