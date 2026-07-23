"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import type { QuickReplyDTO } from "@/server/services/quick-reply.service";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/** CRUD das respostas rápidas da conta (usado em /configuracoes). */
export function QuickRepliesSettings({ canEdit = true }: { canEdit?: boolean }) {
  const [items, setItems] = useState<QuickReplyDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shortcut, setShortcut] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      const data = await res.json();
      setItems((data.quickReplies as QuickReplyDTO[]) ?? []);
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
    setTitle("");
    setBody("");
    setShortcut("");
    setError(null);
  }

  function startNew() {
    reset();
    setEditId("new");
  }

  function startEdit(q: QuickReplyDTO) {
    setEditId(q.id);
    setTitle(q.title);
    setBody(q.body);
    setShortcut(q.shortcut ?? "");
    setError(null);
  }

  async function save() {
    if (!title.trim()) {
      setError("Informe o título.");
      return;
    }
    if (!body.trim()) {
      setError("Informe o texto da resposta.");
      return;
    }
    const payload = { title: title.trim(), body: body.trim(), shortcut: shortcut.trim() || null };
    const isNew = editId === "new";
    const res = await fetch(isNew ? "/api/quick-replies" : `/api/quick-replies/${editId}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Falha ao salvar resposta rápida");
      return;
    }
    reset();
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao apagar resposta rápida");
    }
    await load();
  }

  return (
    <Card>
      <CardHeader
        title="Respostas rápidas"
        subtitle="Textos prontos que a equipe insere na conversa digitando “/”. Use {{nome}} para o nome do cliente."
        action={
          canEdit &&
          editId === null && (
            <Button size="sm" onClick={startNew}>
              <Plus size={14} /> Nova resposta
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
                <label className="mb-1 block text-xs font-medium text-slate-600">Título</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex.: Saudação"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Atalho (opcional)
                </label>
                <input
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                  placeholder="Ex.: oi"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Texto</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Olá {{nome}}, tudo bem? Como posso ajudar?"
                rows={3}
                className={inputClass}
              />
            </div>
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

        {loading && items.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
        )}
        {!loading && items.length === 0 && editId === null && (
          <p className="py-4 text-center text-sm text-slate-400">
            Nenhuma resposta rápida ainda.
          </p>
        )}
        {items.map((q) => (
          <div
            key={q.id}
            className="flex items-start justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">{q.title}</span>
                {q.shortcut && <Badge tone="slate">/{q.shortcut}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{q.body}</p>
            </div>
            {canEdit && (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button size="sm" variant="ghost" onClick={() => startEdit(q)} aria-label="Editar resposta">
                  <Pencil size={14} />
                </Button>
                <ConfirmDeleteButton
                  onConfirm={() => remove(q.id)}
                  label="Apagar resposta"
                  title="Apagar resposta rápida"
                  message={
                    <>
                      Apagar a resposta <strong>{q.title}</strong>? Esta ação não pode ser
                      desfeita.
                    </>
                  }
                  trigger={(open) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={open}
                      aria-label="Apagar resposta"
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
