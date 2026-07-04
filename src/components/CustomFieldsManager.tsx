"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import type { CustomFieldType } from "@prisma/client";
import type { CustomFieldDefItem } from "@/server/services/custom-field.service";

const TYPE_LABEL: Record<CustomFieldType, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  SELECT: "Seleção",
  BOOLEAN: "Sim/Não",
};

const TYPES = Object.keys(TYPE_LABEL) as CustomFieldType[];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/** CRUD dos campos customizados da conta (usado em /configuracoes). */
export function CustomFieldsManager({ canEdit = true }: { canEdit?: boolean }) {
  const [defs, setDefs] = useState<CustomFieldDefItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("TEXT");
  const [optionsText, setOptionsText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/custom-fields", { cache: "no-store" });
      const data = await res.json();
      setDefs((data.defs as CustomFieldDefItem[]) ?? []);
    } catch {
      // ignora
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setEditId(null);
    setLabel("");
    setType("TEXT");
    setOptionsText("");
    setError(null);
  }

  function startNew() {
    reset();
    setEditId("new");
  }

  function startEdit(d: CustomFieldDefItem) {
    setEditId(d.id);
    setLabel(d.label);
    setType(d.type);
    setOptionsText((d.options ?? []).join(", "));
    setError(null);
  }

  async function save() {
    if (!label.trim()) {
      setError("Informe o rótulo do campo.");
      return;
    }
    const options =
      type === "SELECT"
        ? optionsText.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const body = { label: label.trim(), type, options };
    const isNew = editId === "new";
    const res = await fetch(isNew ? "/api/custom-fields" : `/api/custom-fields/${editId}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao salvar campo");
      return;
    }
    reset();
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao apagar campo");
    }
    await load();
  }

  return (
    <Card>
      <CardHeader
        title="Campos customizados"
        subtitle="Campos extras exibidos no cadastro e no detalhe de cada lead."
        action={
          canEdit &&
          editId === null && (
            <Button size="sm" onClick={startNew}>
              <Plus size={14} /> Novo campo
            </Button>
          )
        }
      />
      <div className="space-y-2 px-4 py-3">
        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {editId !== null && (
          <div className="space-y-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Rótulo</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex.: Cidade"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Tipo</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as CustomFieldType)}
                  className={inputClass}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {type === "SELECT" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Opções (separadas por vírgula)
                </label>
                <input
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Opção A, Opção B, Opção C"
                  className={inputClass}
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={reset}>
                Cancelar
              </Button>
              <Button size="sm" onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        )}

        {loading && defs.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
        )}
        {!loading && defs.length === 0 && editId === null && (
          <p className="py-4 text-center text-sm text-slate-400">
            Nenhum campo customizado ainda.
          </p>
        )}
        {defs.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded-lg px-1 py-1.5 hover:bg-slate-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink">{d.label}</span>
              <Badge tone="slate">{TYPE_LABEL[d.type]}</Badge>
              {d.type === "SELECT" && d.options && (
                <span className="text-xs text-slate-400">{d.options.join(" · ")}</span>
              )}
            </div>
            {canEdit && (
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" onClick={() => startEdit(d)} aria-label="Editar campo">
                  <Pencil size={14} />
                </Button>
                <ConfirmDeleteButton
                  onConfirm={() => remove(d.id)}
                  label="Apagar campo"
                  title="Apagar campo customizado"
                  message={
                    <>
                      Apagar o campo <strong>{d.label}</strong>? Os valores já preenchidos
                      nos leads serão perdidos. Esta ação não pode ser desfeita.
                    </>
                  }
                  trigger={(open) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={open}
                      aria-label="Apagar campo"
                      className="text-danger hover:bg-danger-surface"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
