"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { THEME_PRESETS } from "@/lib/theme/presets";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

/** Cor CSS a partir de "R G B". */
function rgb(channels: string): string {
  return `rgb(${channels.replaceAll(" ", ",")})`;
}

/**
 * Identidade visual da conta: escolher um preset de cor, subir logo e definir o
 * nome exibido. Salva via POST multipart em /api/branding; após salvar, o
 * router.refresh() re-injeta o tema pelo layout (SSR).
 */
export function BrandingSettings({
  initial,
}: {
  initial: { presetId: string | null; appName: string; logoUrl: string | null };
}) {
  const router = useRouter();
  const [presetId, setPresetId] = useState<string | null>(initial.presetId);
  const [appName, setAppName] = useState(initial.appName);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial.logoUrl);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setLogoFile(f);
    if (f) setLogoPreview(URL.createObjectURL(f));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const form = new FormData();
      if (presetId) form.set("presetId", presetId);
      form.set("appName", appName.trim());
      if (logoFile) form.set("logo", logoFile);
      const res = await fetch("/api/branding", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setSaved(true);
      setLogoFile(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Identidade da conta"
        subtitle="Escolha as cores do seu ramo, envie seu logo e defina o nome exibido no app."
      />
      <div className="space-y-5 px-4 py-3">
        {/* Presets de cor */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">Cor da marca</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEME_PRESETS.map((p) => {
              const active = presetId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors " +
                    (active
                      ? "border-brand-500 ring-2 ring-brand-500/20"
                      : "border-slate-200 hover:border-slate-300")
                  }
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-black/5"
                    style={{ background: rgb(p.palette["500"]) }}
                  />
                  <span className="min-w-0 truncate font-medium text-ink">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Logo */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">Logo (PNG, JPG ou WEBP, até 512KB)</p>
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="prévia do logo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-slate-400">sem logo</span>
              )}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onPickLogo}
              className="hidden"
            />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
              {logoPreview ? "Trocar logo" : "Enviar logo"}
            </Button>
          </div>
        </div>

        {/* Nome do app */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">Nome exibido</p>
          <input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="Disparador.ai"
            className={inputClass}
          />
        </div>

        {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
          <Button size="sm" onClick={save} loading={saving}>
            Salvar identidade
          </Button>
        </div>
      </div>
    </Card>
  );
}
