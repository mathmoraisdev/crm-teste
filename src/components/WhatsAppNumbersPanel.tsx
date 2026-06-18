"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface NumberItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
  qrDataUrl: string | null;
}

const TONE: Record<string, Tone> = {
  CONNECTED: "emerald",
  WARMING: "amber",
  CONNECTING: "blue",
  PAUSED: "slate",
  BANNED: "red",
  DISABLED: "slate",
};

const LABEL: Record<string, string> = {
  CONNECTED: "Conectado",
  WARMING: "Aquecendo",
  CONNECTING: "Conectando",
  PAUSED: "Pausado",
  BANNED: "Banido",
  DISABLED: "Desativado",
};

/**
 * Painel de saúde dos chips Baileys (multi-número) + pareamento por QR.
 * Só aparece no modo baileys. O QR é gerado pelo worker e lido daqui via polling.
 */
export function WhatsAppNumbersPanel() {
  const [numbers, setNumbers] = useState<NumberItem[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);

  // estado do modal de pareamento
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/numbers", { cache: "no-store" });
      const data = await res.json();
      setNumbers(data.numbers as NumberItem[]);
      setMode(data.mode as string);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
    // poll mais rápido enquanto o modal de pareamento está aberto (QR/Status)
    const t = setInterval(load, open ? 2000 : 5000);
    return () => clearInterval(t);
  }, [load, open]);

  const pairing = useMemo(
    () => (pairingId ? numbers?.find((n) => n.id === pairingId) ?? null : null),
    [numbers, pairingId],
  );

  function reset() {
    setOpen(false);
    setPairingId(null);
    setLabel("");
    setPhone("");
    setError(null);
    setSubmitting(false);
  }

  async function startPairing() {
    setError(null);
    if (!label.trim() || !phone.trim()) {
      setError("Preencha o apelido e o número.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/numbers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim(), phone: phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao iniciar pareamento");
      setPairingId(data.id as string);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar pareamento");
    } finally {
      setSubmitting(false);
    }
  }

  // Só faz sentido no modo baileys (multi-número). Em mock/cloud-api fica oculto.
  if (numbers === null || mode !== "baileys") return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">
            Números WhatsApp (Baileys)
          </h2>
          <span className="text-xs text-slate-400">
            {numbers.length} chip(s) · rotação por menos carregado
          </span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> Adicionar número
        </Button>
      </div>

      {numbers.length === 0 ? (
        <div className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          Nenhum chip conectado ainda. Clique em <strong>Adicionar número</strong> para
          parear por QR (precisa do worker rodando: <code className="rounded bg-slate-200 px-1 text-xs">npm run worker</code>).
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Chip</Th>
              <Th>Número</Th>
              <Th>Status</Th>
              <Th className="text-center">Enviados hoje</Th>
            </tr>
          </thead>
          <tbody>
            {numbers.map((n) => {
              const atCap = n.sentToday >= n.dailyCap;
              return (
                <tr key={n.id} className="hover:bg-slate-50">
                  <Td>
                    <span className="font-medium text-slate-800">{n.label}</span>
                  </Td>
                  <Td className="text-slate-500 tabular-nums">{n.phone}</Td>
                  <Td>
                    <Badge tone={TONE[n.status] ?? "slate"}>
                      {LABEL[n.status] ?? n.status}
                    </Badge>
                  </Td>
                  <Td className="text-center tabular-nums">
                    <span className={atCap ? "text-amber-700" : "text-slate-700"}>
                      {n.sentToday}/{n.dailyCap}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <Modal open={open} onClose={reset} title="Adicionar número (parear por QR)">
        {!pairingId ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Apelido do chip
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="chip-01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Número do chip (E.164)
              </label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+5511999998888"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
              O QR é gerado pelo <strong>worker</strong> — confirme que ele está rodando
              (<code>npm run worker</code>). Depois escaneie em <em>WhatsApp › Aparelhos
              conectados</em>.
            </p>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={startPairing} loading={submitting}>
                Gerar QR
              </Button>
            </div>
          </div>
        ) : pairing?.status === "CONNECTED" ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-2xl">✅</p>
            <p className="text-sm font-medium text-slate-800">
              {pairing.label} conectado!
            </p>
            <p className="text-xs text-slate-500">O chip já entra na rotação de envio.</p>
            <div className="flex justify-center">
              <Button onClick={reset}>Concluir</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2 text-center">
            {pairing?.qrDataUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pairing.qrDataUrl}
                  alt="QR de pareamento"
                  className="mx-auto rounded-lg border border-slate-200"
                  width={240}
                  height={240}
                />
                <p className="text-sm text-slate-700">
                  Escaneie em <em>WhatsApp › Aparelhos conectados › Conectar aparelho</em>.
                </p>
                <p className="text-xs text-slate-400">
                  O QR atualiza sozinho a cada poucos segundos.
                </p>
              </>
            ) : (
              <div className="py-8 text-sm text-slate-500">
                Aguardando o QR do worker…
                <p className="mt-2 text-xs text-slate-400">
                  Se não aparecer em ~15s, confirme que o worker está rodando
                  (<code>npm run worker</code>).
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
