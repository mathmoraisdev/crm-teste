"use client";

import { useCallback, useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";

interface NumberItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
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
 * Painel de saúde dos chips Baileys (multi-número). Renderiza nada quando não
 * há números cadastrados — ou seja, fica invisível nos modos mock/cloud-api.
 */
export function WhatsAppNumbersPanel() {
  const [numbers, setNumbers] = useState<NumberItem[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/numbers", { cache: "no-store" });
      const data = await res.json();
      setNumbers(data.numbers as NumberItem[]);
    } catch {
      /* mantém estado anterior */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (!numbers || numbers.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Smartphone size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-800">
          Números WhatsApp (Baileys)
        </h2>
        <span className="text-xs text-slate-400">
          {numbers.length} chip(s) · rotação por menos carregado
        </span>
      </div>
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
    </Card>
  );
}
