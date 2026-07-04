"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { TagChip } from "@/components/TagChip";
import type { LeadTag } from "@/server/services/lead.service";
import type { TagListItem } from "@/server/services/tag.service";

const TONES: Tone[] = ["slate", "blue", "amber", "green", "red", "violet", "emerald"];

function toTone(color: string): Tone {
  return (TONES as string[]).includes(color) ? (color as Tone) : "slate";
}

/**
 * Multi-select de tags de um lead, com criação inline. Persiste cada mudança em
 * `PUT /api/leads/[id]/tags` e avisa o pai via `onChange`.
 */
export function TagPicker({
  leadId,
  value,
  onChange,
}: {
  leadId: string;
  value: LeadTag[];
  onChange?: (tags: LeadTag[]) => void;
}) {
  const [catalog, setCatalog] = useState<TagListItem[]>([]);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<Tone>("slate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const selectedIds = new Set(value.map((t) => t.id));

  async function loadCatalog() {
    try {
      const res = await fetch("/api/tags", { cache: "no-store" });
      const data = await res.json();
      setCatalog((data.tags as TagListItem[]) ?? []);
    } catch {
      // mantém o estado anterior
    }
  }

  useEffect(() => {
    if (open) loadCatalog();
  }, [open]);

  // Fecha ao clicar fora.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function persist(nextIds: string[]) {
    setError(null);
    const res = await fetch(`/api/leads/${leadId}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagIds: nextIds }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Falha ao salvar tags");
      return false;
    }
    return true;
  }

  async function toggle(tag: TagListItem) {
    const nextIds = selectedIds.has(tag.id)
      ? value.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...value.map((t) => t.id), tag.id];
    setBusy(true);
    const ok = await persist(nextIds);
    setBusy(false);
    if (!ok) return;
    const next = selectedIds.has(tag.id)
      ? value.filter((t) => t.id !== tag.id)
      : [...value, { id: tag.id, name: tag.name, color: tag.color }];
    onChange?.(next);
  }

  async function removeChip(tagId: string) {
    const nextIds = value.filter((t) => t.id !== tagId).map((t) => t.id);
    setBusy(true);
    const ok = await persist(nextIds);
    setBusy(false);
    if (ok) onChange?.(value.filter((t) => t.id !== tagId));
  }

  async function createAndAdd() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
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
      const created = data.tag as { id: string; name: string; color: string };
      const nextIds = [...value.map((t) => t.id), created.id];
      const ok = await persist(nextIds);
      if (ok) {
        onChange?.([...value, { id: created.id, name: created.name, color: created.color }]);
        setNewName("");
        await loadCatalog();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => removeChip(t.id)} />
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600"
        >
          <TagIcon size={11} /> Tags
        </button>
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-64 rounded-xl border border-line bg-raised p-3 shadow-xl">
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {catalog.length === 0 && (
              <p className="px-1 py-2 text-xs text-slate-400">Nenhuma tag ainda.</p>
            )}
            {catalog.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(t)}
                className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 hover:bg-slate-50 disabled:opacity-60"
              >
                <Badge tone={toTone(t.color)}>{t.name}</Badge>
                {selectedIds.has(t.id) && (
                  <span className="text-xs font-bold text-brand-600">✓</span>
                )}
              </button>
            ))}
          </div>

          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="flex items-center gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createAndAdd()}
                placeholder="Nova tag…"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-brand-400 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !newName.trim()}
                onClick={createAndAdd}
                className="rounded-lg bg-brand-500 p-1.5 text-white hover:bg-brand-600 disabled:opacity-50"
                aria-label="Criar tag"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {TONES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`h-5 w-5 rounded-full ring-2 ${
                    newColor === c ? "ring-brand-500" : "ring-transparent"
                  }`}
                  aria-label={`Cor ${c}`}
                >
                  <Badge tone={c} className="h-5 w-5 justify-center p-0">
                    {" "}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
