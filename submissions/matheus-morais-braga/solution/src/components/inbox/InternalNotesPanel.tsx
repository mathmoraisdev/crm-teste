"use client";

import { useCallback, useEffect, useState } from "react";
import { StickyNote, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";

interface NoteDTO {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

/**
 * Notas internas da conversa — nota de operador que a EQUIPE vê, mas o cliente
 * NUNCA recebe. Estilo âmbar distinto p/ deixar claro que não é mensagem.
 * Carrega/adiciona via /api/inbox/[id]/notes (fluxo separado do envio ao lead).
 */
export function InternalNotesPanel({ leadId }: { leadId: string }) {
  const [notes, setNotes] = useState<NoteDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inbox/${leadId}/notes`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setNotes((data.notes as NoteDTO[]) ?? []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${leadId}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar nota");
      setDraft("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar nota");
    } finally {
      setSaving(false);
    }
  }

  const count = notes.length;

  return (
    <div className="border-b border-warning/25 bg-warning-surface/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
          <StickyNote size={14} />
          Notas internas {count > 0 && <span className="font-normal">({count})</span>}
          <span className="font-normal text-warning/70">· só a equipe vê</span>
        </span>
        <span className="text-[11px] text-warning/90">{open ? "ocultar" : "mostrar"}</span>
      </button>

      {open && (
        <div className="space-y-2 px-4 pb-3">
          {loading && notes.length === 0 && (
            <p className="text-xs text-slate-500">Carregando…</p>
          )}
          {!loading && notes.length === 0 && (
            <p className="text-xs text-slate-500">Nenhuma nota ainda.</p>
          )}
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-warning/25 bg-warning-surface px-3 py-2">
              <p className="whitespace-pre-wrap text-sm text-ink">{n.body}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {n.author.name} · {formatDateTime(n.createdAt)}
              </p>
            </div>
          ))}

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  add();
                }
              }}
              rows={2}
              placeholder="Anotar algo sobre este cliente (não vai para o WhatsApp)…"
              className="w-full flex-1 resize-none rounded-lg border border-warning/40 bg-card px-3 py-2 text-sm text-ink focus:border-warning focus:outline-none focus:ring-2 focus:ring-warning/20"
            />
            <Button size="sm" onClick={add} loading={saving} disabled={!draft.trim()}>
              <Plus size={14} /> Nota
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
