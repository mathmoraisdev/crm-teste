"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Trash2, Upload } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";

interface MediaAssetItem {
  id: string;
  label: string;
  mediaType: "image" | "document";
  mediaMime: string;
  fileName: string | null;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/**
 * Biblioteca de mídia da conta (usada em /configuracoes). O operador sobe fotos e
 * PDFs (cardápio, tabela de preços) que a IA com ações pode ENVIAR pelo chat via
 * a tool `enviar_midia`. Escopado por conta.
 */
export function MediaLibrarySettings({ canEdit = true }: { canEdit?: boolean }) {
  const [items, setItems] = useState<MediaAssetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/media-assets", { cache: "no-store" });
      const data = await res.json();
      setItems((data.assets as MediaAssetItem[]) ?? []);
    } catch {
      // ignora
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Escolha um arquivo (imagem ou PDF).");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (label.trim()) form.set("label", label.trim());
      const res = await fetch("/api/media-assets", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Falha ao subir a mídia");
        return;
      }
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/media-assets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao remover a mídia");
    }
    await load();
  }

  return (
    <Card>
      <CardHeader
        title="Biblioteca de mídia (IA com ações)"
        subtitle="Fotos e PDFs (cardápio, tabela de preços) que a IA pode enviar ao cliente pelo chat. Requer o modo “IA com ações” ligado no número."
      />
      <div className="space-y-3 px-4 py-3">
        {error && (
          <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {canEdit && (
          <div className="space-y-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Rótulo (como a IA reconhece)</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: cardápio, tabela de preços"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Arquivo (imagem ou PDF, até 16MB)</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-600"
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={upload} disabled={uploading}>
                <Upload size={14} /> {uploading ? "Enviando…" : "Adicionar mídia"}
              </Button>
            </div>
          </div>
        )}

        {loading && items.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">Carregando…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">Nenhuma mídia na biblioteca ainda.</p>
        )}
        {items.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-slate-50"
          >
            <div className="flex min-w-0 items-center gap-2">
              {a.mediaType === "image" ? (
                <ImageIcon size={16} className="shrink-0 text-slate-400" />
              ) : (
                <FileText size={16} className="shrink-0 text-slate-400" />
              )}
              <div className="min-w-0">
                <span className="text-sm font-semibold text-ink">{a.label}</span>
                {a.fileName && <p className="truncate text-xs text-slate-500">{a.fileName}</p>}
              </div>
            </div>
            {canEdit && (
              <ConfirmDeleteButton
                onConfirm={() => remove(a.id)}
                label="Remover mídia"
                title="Remover mídia"
                message={
                  <>
                    Remover a mídia <strong>{a.label}</strong>? A IA deixará de poder enviá-la.
                  </>
                }
                trigger={(open) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={open}
                    aria-label="Remover mídia"
                    className="shrink-0 text-danger hover:bg-danger-surface"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
