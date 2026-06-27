"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccountBillingToggle({
  accountId,
  active,
  disabled,
}: {
  accountId: string;
  active: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Falha ao atualizar.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || disabled}
      className={
        "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 " +
        (active
          ? "bg-red-50 text-red-600 hover:bg-red-100"
          : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")
      }
      title={disabled ? "Conta admin — não pode ser suspensa" : undefined}
    >
      {active ? "Suspender" : "Ativar"}
    </button>
  );
}
