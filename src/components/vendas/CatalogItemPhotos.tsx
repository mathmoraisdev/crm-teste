"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2, Upload, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Photo {
  id: string;
  order: number;
}

export default function CatalogItemPhotos({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch(`/api/vendas/catalog/${itemId}/photos`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setPhotos(data.photos ?? []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/vendas/catalog/${itemId}/photos`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Falha ao subir a foto");
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/vendas/catalog/${itemId}/photos/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-ink">
        <ImageIcon size={14} /> Fotos do anúncio
      </div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative h-20 w-20 overflow-hidden rounded-lg border border-line-default">
            {/* bucket privado → URL assinada sob demanda pelo endpoint */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/catalog-photo/${p.id}`} alt="" className="h-full w-full object-cover" />
            {canEdit && (
              <button
                type="button"
                onClick={() => void remove(p.id)}
                className="absolute right-0 top-0 bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
                aria-label="Remover foto"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
        {photos.length === 0 && <span className="text-sm text-slate-400">Nenhuma foto ainda.</span>}
      </div>
      {canEdit && (
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="text-sm text-slate-600" />
          <Button size="sm" onClick={() => void upload()} loading={uploading}>
            <Upload size={12} /> {uploading ? "Enviando…" : "Adicionar"}
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
