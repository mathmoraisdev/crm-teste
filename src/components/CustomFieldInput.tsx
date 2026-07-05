"use client";

import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

const cfInputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Render/edição de UM campo customizado, dirigido pelo `type` da def. Compartilhado
 * por LeadForm (escopo LEAD) e OrderCustomFields (escopo ORDER/ORDER_ITEM) — DRY.
 * Devolve o conteúdo interno; o chamador envolve num `<div key={def.id}>`.
 */
export function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDefItem;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (def.type === "BOOLEAN") {
    return (
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/40"
        />
        {def.label}
      </label>
    );
  }
  return (
    <>
      <label className="mb-1 block text-xs font-medium text-slate-600">{def.label}</label>
      {def.type === "SELECT" ? (
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className={cfInputClass}
        >
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : "text"}
          value={
            def.type === "DATE" && typeof value === "string"
              ? value.slice(0, 10)
              : (value as string | number) ?? ""
          }
          onChange={(e) => onChange(e.target.value)}
          className={cfInputClass}
        />
      )}
    </>
  );
}
