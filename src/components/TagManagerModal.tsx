"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge, type Tone } from "@/components/ui/Badge";
import type { TagListItem } from "@/server/services/tag.service";

const TONES: Tone[] = ["slate", "blue", "amber", "green", "red", "violet", "emerald"];

function toTone(color: string): Tone {
  return (TONES as string[]).includes(color) ? (color as Tone) : "slate";
}

function ColorRow({
  value,
  onChange,
}: {
  value: Tone;
  onChange: (c: Tone) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {TONES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-full ring-2 ${value === c ? "ring-brand-500" : "ring-transparent"}`}
          aria-label={`Cor ${c}`}
        >
          <Badge tone={c} className="h-5 w-5 justify-center p-0">
            {" "}
          </Badge>
        </button>
      ))}
    </div>
  );
}

/** CRUD do catálogo de tags da conta. Avisa o pai (`onChanged`) ao alterar. */
export function TagManagerModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tags, setTags] = useState<TagListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // criação
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<Tone>("slate");

  // edição inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<Tone>("slate");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags", { cache: "no-store" });
      const data = await res.json();
      setTags((data.tags as TagListItem[]) ?? []);
    } catch {
      // ignora
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, color: newColor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao criar tag");
      return;
    }
    setNewName("");
    setNewColor("slate");
    await load();
    onChanged?.();
  }

  function startEdit(t: TagListItem) {
    setEditId(t.id);
    setEditName(t.name);
    setEditColor(toTone(t.color));
    setError(null);
  }

  async function saveEdit() {
    if (!editId) return;
    const name = editName.trim();
    if (!name) return;
    setError(null);
    const res = await fetch(`/api/tags/${editId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, color: editColor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao salvar tag");
      return;
    }
    setEditId(null);
    await load();
    onChanged?.();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Falha ao apagar tag");
      return;
    }
    await load();
    onChanged?.();
  }

  return (
    <Modal open={open} onClose={onClose} title="Gerenciar tags">
      <div className="space-y-4">
        {/* criar */}
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold text-slate-600">Nova tag</p>
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Nome da tag"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            <Button size="sm" onClick={create} disabled={!newName.trim()}>
              <Plus size={14} /> Criar
            </Button>
          </div>
          <div className="mt-2">
            <ColorRow value={newColor} onChange={setNewColor} />
          </div>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {/* lista */}
        <div className="space-y-1.5">
          {loading && tags.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
          )}
          {!loading && tags.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma tag criada ainda.</p>
          )}
          {tags.map((t) =>
            editId === t.id ? (
              <div key={t.id} className="space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2">
                <div className="flex items-center gap-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <Button size="sm" variant="ghost" onClick={saveEdit} aria-label="Salvar">
                    <Check size={15} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)} aria-label="Cancelar">
                    <X size={15} />
                  </Button>
                </div>
                <ColorRow value={editColor} onChange={setEditColor} />
              </div>
            ) : (
              <div key={t.id} className="flex items-center justify-between rounded-lg px-1 py-1 hover:bg-slate-50">
                <div className="flex items-center gap-2">
                  <Badge tone={toTone(t.color)}>{t.name}</Badge>
                  <span className="text-xs text-slate-400">{t.leadCount} lead(s)</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(t)} aria-label="Editar tag">
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(t.id)}
                    aria-label="Apagar tag"
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </Modal>
  );
}
