"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Liga/desliga a landing de marketing na raiz "/". Desligada (padrão), a raiz
 * vai direto pro login; ligada, mostra a landing. A landing fica sempre visível
 * em /landing para preview. Persiste em AppSetting via /api/admin/settings.
 */
export function LandingToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ landingEnabled: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao salvar.");
        return;
      }
      setEnabled(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">Página inicial</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {enabled
            ? "A raiz mostra a landing de marketing."
            : "A raiz vai direto pro login. A landing fica em /landing."}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Mostrar landing na página inicial"
        disabled={busy}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-brand-500" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
