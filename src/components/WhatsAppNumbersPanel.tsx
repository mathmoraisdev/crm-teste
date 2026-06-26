"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone, Plus, Pause, Play, Pencil, Trash2, Settings2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AI_MODELS_BY_PROVIDER, type AiProviderName } from "@/lib/ai-models";

interface NumberItem {
  id: string;
  label: string;
  phone: string;
  status: string;
  dailyCap: number;
  sentToday: number;
  qrDataUrl: string | null;
  displayName: string | null;
  aiModel: string | null;
  systemPromptOverride: string | null;
  persona: string | null;
  knowledgeBase: string | null;
  businessHours: string | null;
  customInstructions: string | null;
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
  replyDelaySeconds: number;
  firstReplyDelaySeconds: number;
  autoPauseOnHumanReply: boolean;
  inactivityResumeMinutes: number;
  contextResetMinutes: number;
}

interface ServiceConfig {
  displayName: string;
  aiModel: string;
  systemPromptOverride: string;
  persona: string;
  businessHours: string;
  knowledgeBase: string;
  customInstructions: string;
  autoReplyEnabled: boolean;
  qualifyEnabled: boolean;
  scheduleEnabled: boolean;
  replyDelaySeconds: number;
  firstReplyDelaySeconds: number;
  autoPauseOnHumanReply: boolean;
  inactivityResumeMinutes: number;
  contextResetMinutes: number;
}

const TONE: Record<string, Tone> = {
  CONNECTED: "emerald",
  WARMING: "amber",
  CONNECTING: "blue",
  PAUSED: "slate",
  LOGGED_OUT: "amber",
  BANNED: "red",
  DISABLED: "slate",
};

const LABEL: Record<string, string> = {
  CONNECTED: "Conectado",
  WARMING: "Aquecendo",
  CONNECTING: "Conectando",
  PAUSED: "Pausado",
  LOGGED_OUT: "Desconectado",
  BANNED: "Banido",
  DISABLED: "Desativado",
};

// Status offline a partir dos quais o operador pode forçar um re-pareamento.
const RECONNECTABLE = new Set(["BANNED", "LOGGED_OUT", "DISABLED"]);

const STATUS_OPTIONS = Object.keys(LABEL);

/**
 * Painel de saúde dos chips Baileys (multi-número) + pareamento por QR.
 * Só aparece no modo baileys. O QR é gerado pelo worker e lido daqui via polling.
 */
export function WhatsAppNumbersPanel() {
  const [numbers, setNumbers] = useState<NumberItem[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProviderName>("OPENAI");

  // estado do modal de pareamento
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // filtro + gestão
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NumberItem | null>(null);

  // modal de edição (apelido + cap)
  const [editing, setEditing] = useState<NumberItem | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editCap, setEditCap] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // modal de atendimento (persona/base/toggles)
  const [serviceFor, setServiceFor] = useState<NumberItem | null>(null);
  const [service, setService] = useState<ServiceConfig | null>(null);
  const [serviceSubmitting, setServiceSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/numbers", { cache: "no-store" });
      const data = await res.json();
      setNumbers(data.numbers as NumberItem[]);
      setMode(data.mode as string);
      if (data.provider === "OPENAI" || data.provider === "ANTHROPIC") {
        setProvider(data.provider);
      }
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

  const filtered = useMemo(() => {
    if (!numbers) return [];
    return statusFilter === "ALL"
      ? numbers
      : numbers.filter((n) => n.status === statusFilter);
  }, [numbers, statusFilter]);

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

  async function patchNumber(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/numbers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao atualizar número");
    }
    await load();
  }

  async function toggleStatus(n: NumberItem) {
    const next = n.status === "PAUSED" ? "CONNECTED" : "PAUSED";
    setBusyId(n.id);
    try {
      await patchNumber(n.id, { status: next });
    } catch {
      /* erro silencioso aqui; o status reflete no próximo poll */
    } finally {
      setBusyId(null);
    }
  }

  // Reconecta um chip offline (banido/deslogado/desativado): apaga as creds
  // mortas no servidor, volta p/ CONNECTING e abre o modal de QR apontando p/
  // este número. As configs (system prompt, modelo…) são preservadas.
  async function reconnectNumber(n: NumberItem) {
    setBusyId(n.id);
    try {
      const res = await fetch(`/api/numbers/${n.id}/reconnect`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Falha ao reconectar");
      }
      await load();
      setPairingId(n.id); // mostra o QR novo no modal de pareamento
      setOpen(true);
    } catch {
      /* status reflete no próximo poll */
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(n: NumberItem) {
    setEditing(n);
    setEditLabel(n.label);
    setEditCap(String(n.dailyCap));
    setEditError(null);
  }

  async function submitEdit() {
    if (!editing) return;
    setEditError(null);
    if (!editLabel.trim()) {
      setEditError("Informe um apelido.");
      return;
    }
    const cap = Number(editCap);
    if (!Number.isInteger(cap) || cap <= 0) {
      setEditError("Cap diário deve ser um inteiro positivo.");
      return;
    }
    setEditSubmitting(true);
    try {
      await patchNumber(editing.id, { label: editLabel.trim(), dailyCap: cap });
      setEditing(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setEditSubmitting(false);
    }
  }

  function openService(n: NumberItem) {
    setServiceFor(n);
    setService({
      displayName: n.displayName ?? "",
      aiModel: n.aiModel ?? "",
      systemPromptOverride: n.systemPromptOverride ?? "",
      persona: n.persona ?? "",
      businessHours: n.businessHours ?? "",
      knowledgeBase: n.knowledgeBase ?? "",
      customInstructions: n.customInstructions ?? "",
      autoReplyEnabled: n.autoReplyEnabled,
      qualifyEnabled: n.qualifyEnabled,
      scheduleEnabled: n.scheduleEnabled,
      replyDelaySeconds: n.replyDelaySeconds,
      firstReplyDelaySeconds: n.firstReplyDelaySeconds,
      autoPauseOnHumanReply: n.autoPauseOnHumanReply,
      inactivityResumeMinutes: n.inactivityResumeMinutes,
      contextResetMinutes: n.contextResetMinutes,
    });
    setServiceError(null);
  }

  async function submitService() {
    if (!serviceFor || !service) return;
    setServiceError(null);
    setServiceSubmitting(true);
    try {
      // strings vazias → null (limpa o campo no banco)
      await patchNumber(serviceFor.id, {
        displayName: service.displayName.trim() || null,
        aiModel: service.aiModel || null,
        systemPromptOverride: service.systemPromptOverride.trim() || null,
        persona: service.persona.trim() || null,
        businessHours: service.businessHours.trim() || null,
        knowledgeBase: service.knowledgeBase.trim() || null,
        customInstructions: service.customInstructions.trim() || null,
        autoReplyEnabled: service.autoReplyEnabled,
        qualifyEnabled: service.qualifyEnabled,
        scheduleEnabled: service.scheduleEnabled,
        replyDelaySeconds: service.replyDelaySeconds,
        firstReplyDelaySeconds: service.firstReplyDelaySeconds,
        autoPauseOnHumanReply: service.autoPauseOnHumanReply,
        inactivityResumeMinutes: service.inactivityResumeMinutes,
        contextResetMinutes: service.contextResetMinutes,
      });
      setServiceFor(null);
      setService(null);
    } catch (e) {
      setServiceError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setServiceSubmitting(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/numbers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "Falha ao remover número");
    }
    await load();
  }

  // Só faz sentido no modo baileys (multi-número). Em mock/cloud-api fica oculto.
  if (numbers === null || mode !== "baileys") return null;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">
            Números WhatsApp (Baileys)
          </h2>
          <span className="text-xs text-slate-400">
            {numbers.length} chip(s) · rotação por menos carregado
          </span>
        </div>
        <div className="flex items-center gap-2">
          {numbers.length > 0 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">Todos os status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} /> Adicionar número
          </Button>
        </div>
      </div>

      {numbers.length === 0 ? (
        <div className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          Nenhum chip conectado ainda. Clique em <strong>Adicionar número</strong> para
          parear por QR (precisa do worker rodando: <code className="rounded bg-slate-200 px-1 text-xs">npm run worker</code>).
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          Nenhum chip com esse status.
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Chip</Th>
              <Th>Número</Th>
              <Th>Status</Th>
              <Th className="text-center">Enviados hoje</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((n) => {
              const atCap = n.sentToday >= n.dailyCap;
              const canPause = n.status === "CONNECTED" || n.status === "WARMING";
              const canResume = n.status === "PAUSED";
              const canReconnect = RECONNECTABLE.has(n.status);
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
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canReconnect && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reconnectNumber(n)}
                          loading={busyId === n.id}
                          title="Reconectar (reescanear QR, mantém as configs)"
                          aria-label="Reconectar chip"
                          className="text-brand-600 hover:bg-brand-50"
                        >
                          <RefreshCw size={14} />
                        </Button>
                      )}
                      {(canPause || canResume) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleStatus(n)}
                          loading={busyId === n.id}
                          title={canResume ? "Reativar" : "Pausar"}
                          aria-label={canResume ? "Reativar chip" : "Pausar chip"}
                        >
                          {canResume ? <Play size={14} /> : <Pause size={14} />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openService(n)}
                        title="Atendimento"
                        aria-label="Configurar atendimento"
                      >
                        <Settings2 size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(n)}
                        title="Editar"
                        aria-label="Editar chip"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(n)}
                        title="Remover"
                        aria-label="Remover chip"
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Editar — ${editing.label}` : "Editar chip"}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Apelido
            </label>
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Cap diário
            </label>
            <input
              type="number"
              min={1}
              value={editCap}
              onChange={(e) => setEditCap(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {editError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p>
          )}
          <div className="flex justify-end">
            <Button onClick={submitEdit} loading={editSubmitting}>
              Salvar alterações
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!serviceFor}
        onClose={() => {
          setServiceFor(null);
          setService(null);
        }}
        title={
          serviceFor ? `Atendimento — ${serviceFor.label}` : "Atendimento"
        }
      >
        {service && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Nome de exibição
              </label>
              <input
                value={service.displayName}
                onChange={(e) =>
                  setService({ ...service, displayName: e.target.value })
                }
                placeholder="Ex.: Clínica Sorriso"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Modelo de IA
              </label>
              <select
                value={service.aiModel}
                onChange={(e) =>
                  setService({ ...service, aiModel: e.target.value })
                }
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="">Padrão da conta</option>
                {AI_MODELS_BY_PROVIDER[provider].map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Modelo que gera as respostas deste número.{" "}
                {provider === "ANTHROPIC" ? "Provider: Anthropic." : "Provider: OpenAI."}{" "}
                &quot;Padrão da conta&quot; usa o modelo configurado globalmente.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                System prompt (avançado)
              </label>
              <textarea
                value={service.systemPromptOverride}
                onChange={(e) =>
                  setService({ ...service, systemPromptOverride: e.target.value })
                }
                rows={8}
                placeholder="Prompt mestre completo do atendente. Quando preenchido, SUBSTITUI o comportamento padrão. Deixe vazio para usar Persona + Base de conhecimento abaixo."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1 text-xs text-slate-400">
                {service.systemPromptOverride.length.toLocaleString("pt-BR")}/20.000 caracteres ·
                quando preenchido, os campos abaixo (persona, base, horário) são ignorados pela IA.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Persona da IA
              </label>
              <input
                value={service.persona}
                onChange={(e) =>
                  setService({ ...service, persona: e.target.value })
                }
                placeholder="Ex.: atendente cordial e objetiva"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Horário de atendimento
              </label>
              <input
                value={service.businessHours}
                onChange={(e) =>
                  setService({ ...service, businessHours: e.target.value })
                }
                placeholder="Ex.: Seg–Sex 9h às 18h"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Base de conhecimento
              </label>
              <textarea
                value={service.knowledgeBase}
                onChange={(e) =>
                  setService({ ...service, knowledgeBase: e.target.value })
                }
                rows={5}
                placeholder="Produtos, serviços, preços, FAQ… a IA usa isto pra responder."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Instruções adicionais
              </label>
              <textarea
                value={service.customInstructions}
                onChange={(e) =>
                  setService({ ...service, customInstructions: e.target.value })
                }
                rows={3}
                placeholder="Regras específicas de tom, o que evitar, etc."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs font-semibold text-slate-600">
                Tempo de resposta &amp; handoff
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Espera p/ responder (s)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={service.replyDelaySeconds}
                    onChange={(e) =>
                      setService({
                        ...service,
                        replyDelaySeconds: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Espera da 1ª resposta (s)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={600}
                    value={service.firstReplyDelaySeconds}
                    onChange={(e) =>
                      setService({
                        ...service,
                        firstReplyDelaySeconds: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400">
                A IA aguarda esse tempo antes de responder e junta mensagens picadas numa
                resposta só. 0 = responde na hora.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Reativar IA após inatividade (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={service.inactivityResumeMinutes}
                  onChange={(e) =>
                    setService({
                      ...service,
                      inactivityResumeMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Depois que um humano assume, se a conversa ficar parada por esse tempo a IA
                  volta a responder sozinha. 0 = nunca reativa automaticamente.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Zerar contexto após inatividade (min)
                </label>
                <input
                  type="number"
                  min={0}
                  max={10080}
                  value={service.contextResetMinutes}
                  onChange={(e) =>
                    setService({
                      ...service,
                      contextResetMinutes: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Se o cliente voltar a falar após esse tempo de silêncio, a IA recomeça o
                  atendimento do zero (ignora a conversa anterior já resolvida). Padrão: 180
                  (3h). 0 = nunca zera (sempre usa o histórico recente).
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={service.autoPauseOnHumanReply}
                  onChange={(e) =>
                    setService({ ...service, autoPauseOnHumanReply: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                />
                Pausar a IA quando eu responder manualmente pelo WhatsApp
              </label>
            </div>
            <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={service.autoReplyEnabled}
                  onChange={(e) =>
                    setService({ ...service, autoReplyEnabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                />
                Responder automaticamente
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={service.qualifyEnabled}
                  onChange={(e) =>
                    setService({ ...service, qualifyEnabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                />
                Qualificar leads
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={service.scheduleEnabled}
                  onChange={(e) =>
                    setService({ ...service, scheduleEnabled: e.target.checked })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/20"
                />
                Agendar compromissos
              </label>
            </div>
            {serviceError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {serviceError}
              </p>
            )}
            <div className="flex justify-end">
              <Button onClick={submitService} loading={serviceSubmitting}>
                Salvar atendimento
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Remover número"
        confirmLabel="Remover"
        message={
          deleting ? (
            <>
              Remover o chip <strong>{deleting.label}</strong> ({deleting.phone}) do
              CRM? Ele sai da rotação de envio. O histórico de mensagens é
              preservado, mas desvinculado deste número.
            </>
          ) : null
        }
        onConfirm={async () => {
          if (deleting) await remove(deleting.id);
        }}
        onClose={() => setDeleting(null)}
      />
    </Card>
  );
}
