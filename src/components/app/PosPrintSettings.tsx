"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { isQzAvailable, qzListPrinters } from "@/lib/receipt/qz-client";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

interface PosSettings {
  printMode: "browser" | "escpos";
  printerName: string | null;
  openDrawer: boolean;
}

/**
 * Config de impressão do cupom (Fase N2, opt-in). O modo "navegador" (N1) funciona
 * em qualquer impressora e é o default. O modo "térmica" usa o QZ Tray (app local)
 * p/ corte de papel, gaveta e impressão silenciosa — depende do QZ instalado no PC
 * do caixa. Salva em /api/caixa/pos-settings.
 */
export function PosPrintSettings({ initial }: { initial: PosSettings }) {
  const [printMode, setPrintMode] = useState<PosSettings["printMode"]>(initial.printMode);
  const [printerName, setPrinterName] = useState(initial.printerName ?? "");
  const [openDrawer, setOpenDrawer] = useState(initial.openDrawer);
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function detect() {
    setError(null);
    if (!isQzAvailable()) {
      setError("QZ Tray não detectado neste computador. Instale e abra o QZ Tray no PC do caixa.");
      return;
    }
    setDetecting(true);
    try {
      const list = await qzListPrinters();
      setPrinters(list);
      if (list.length && !printerName) setPrinterName(list[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao listar impressoras do QZ Tray.");
    } finally {
      setDetecting(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/caixa/pos-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          printMode,
          printerName: printMode === "escpos" ? printerName.trim() || null : null,
          openDrawer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao salvar");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Impressão de cupom"
        subtitle="Como o cupom da comanda é impresso ao fechar ou reimprimir no extrato."
      />
      <div className="space-y-5 px-4 py-3">
        {/* Modo */}
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-slate-300">
            <input
              type="radio"
              name="printMode"
              checked={printMode === "browser"}
              onChange={() => setPrintMode("browser")}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Navegador (qualquer impressora)</span>
              <span className="block text-xs text-slate-500">
                Abre o diálogo de impressão do sistema. Funciona com qualquer impressora — inclusive folha A4.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-slate-300">
            <input
              type="radio"
              name="printMode"
              checked={printMode === "escpos"}
              onChange={() => setPrintMode("escpos")}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-ink">Impressora térmica (ESC/POS via QZ Tray)</span>
              <span className="block text-xs text-slate-500">
                Corte de papel, gaveta e impressão silenciosa. Requer o app QZ Tray instalado no PC do caixa.
              </span>
            </span>
          </label>
        </div>

        {/* Config da térmica */}
        {printMode === "escpos" && (
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500">Impressora</p>
                <Button size="sm" variant="secondary" onClick={detect} loading={detecting}>
                  Detectar impressoras
                </Button>
              </div>
              {printers && printers.length > 0 ? (
                <select value={printerName} onChange={(e) => setPrinterName(e.target.value)} className={inputClass}>
                  {printers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={printerName}
                  onChange={(e) => setPrinterName(e.target.value)}
                  placeholder="Nome exato da impressora no QZ Tray"
                  className={inputClass}
                />
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={openDrawer} onChange={(e) => setOpenDrawer(e.target.checked)} />
              <span className="text-sm text-ink">Abrir a gaveta no pagamento em dinheiro</span>
            </label>
          </div>
        )}

        {error && <p className="rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-sm text-brand-600">Salvo ✓</span>}
          <Button size="sm" onClick={save} loading={saving}>
            Salvar impressão
          </Button>
        </div>
      </div>
    </Card>
  );
}
