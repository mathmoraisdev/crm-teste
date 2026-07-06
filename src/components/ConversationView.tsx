"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Hand, Bot, Reply, X, Paperclip, Download, FileText, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, formatDateTime } from "@/lib/utils";
import { MEDIA_PLACEHOLDERS } from "@/server/whatsapp/baileys/media";
import type { LeadDetail } from "@/server/services/lead.service";
import type { QuickReplyDTO } from "@/server/services/quick-reply.service";
import { renderSnippet } from "@/lib/inbox/render-snippet";

type Message = LeadDetail["messages"][number];

// Sugestão de resposta da IA (rascunho editável) no handoff humano. Limites p/
// não desperdiçar cota na chave da plataforma: no máx. 3 por turno de resposta
// (o contador zera ao enviar ou trocar de conversa) + cooldown entre cliques.
const MAX_SUGGESTIONS = 3;
const SUGGEST_COOLDOWN_MS = 4000;

/**
 * Visão da conversa (bolhas) + caixa "responder como lead".
 *
 * No modo mock, o avaliador usa este input para simular a resposta do lead.
 * Ele chama /api/dev/simulate-reply, que injeta a mensagem no MESMO pipeline
 * do webhook (dedupe incluso) e dispara a orquestração de IA.
 *
 * Handoff humano: o operador pode "assumir" a conversa (toggle → pausa a IA).
 * Com a IA pausada, aparece uma caixa para responder manualmente ao lead pelo
 * mesmo chip (POST /reply), sem a IA responder por cima.
 */
export function ConversationView({
  leadId,
  leadName,
  messages,
  onReplied,
  canReply,
  aiPaused,
  hideHandoff = false,
}: {
  leadId: string;
  /** Nome do lead — usado p/ resolver {{nome}} nas respostas rápidas. */
  leadName?: string;
  messages: Message[];
  onReplied: () => void;
  canReply: boolean;
  aiPaused: boolean;
  /** Oculta o toggle de handoff embutido (o inbox tem ações próprias no header). */
  hideHandoff?: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resposta manual do operador (handoff humano).
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  // Anexo selecionado p/ enviar ao lead (imagem/documento/áudio).
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Mensagem citada (reply): o operador clicou "responder" numa bolha.
  const [quoting, setQuoting] = useState<Message | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  // Toggle "assumir conversa" — pausa/retoma a IA.
  const [togglingHandoff, setTogglingHandoff] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // Sugestão de resposta da IA (rascunho): estado + limite por turno + cooldown.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestCount, setSuggestCount] = useState(0);
  const [suggestCoolingDown, setSuggestCoolingDown] = useState(false);
  // Respostas rápidas (snippets): carregadas sob demanda na 1ª vez que o "/" abre
  // o seletor. Compartilhadas pela conta, então cacheia no estado do componente.
  const [quickReplies, setQuickReplies] = useState<QuickReplyDTO[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Trocar de conversa zera o limite de sugestões (novo turno, novo lead).
  useEffect(() => {
    setSuggestCount(0);
    setSuggestError(null);
    setSuggestCoolingDown(false);
  }, [leadId]);

  // Auto-cresce a caixa de resposta manual conforme o texto digitado (até um teto,
  // depois rola internamente). `resize-none` desliga o handle nativo, então sem
  // isto a caixa ficaria travada em uma linha.
  useEffect(() => {
    const el = replyInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [reply]);

  async function send() {
    const content = text.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/simulate-reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, text: content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar resposta");
      setText("");
      onReplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setSending(false);
    }
  }

  // Assume/devolve a conversa: pausa ou retoma a IA para este lead.
  async function toggleHandoff() {
    setTogglingHandoff(true);
    setHandoffError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/handoff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: !aiPaused }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao assumir conversa");
      onReplied();
    } catch (e) {
      setHandoffError(e instanceof Error ? e.message : "Erro ao assumir conversa");
    } finally {
      setTogglingHandoff(false);
    }
  }

  // Operador clicou "responder" numa bolha: marca a citação e foca o input.
  function startQuote(m: Message) {
    setQuoting(m);
    replyInputRef.current?.focus();
  }

  // Envio manual (texto ou anexo): se há arquivo selecionado, envia o anexo (com
  // o texto como legenda); senão envia só o texto. Fonte única do "Enviar".
  async function submitReply() {
    if (file) return sendFile();
    return sendReply();
  }

  // Resposta manual do operador, enviada ao lead pelo mesmo chip.
  async function sendReply() {
    const content = reply.trim();
    if (!content) return;
    setReplying(true);
    setReplyError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, replyToMessageId: quoting?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar resposta");
      setReply("");
      setQuoting(null);
      setSuggestCount(0); // enviou → novo turno, libera as sugestões de novo
      onReplied();
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setReplying(false);
    }
  }

  // Envia o anexo selecionado ao lead (multipart). O texto do input vira legenda.
  async function sendFile() {
    if (!file) return;
    setReplying(true);
    setReplyError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (reply.trim()) fd.append("caption", reply.trim());
      if (quoting?.id) fd.append("replyToMessageId", quoting.id);
      const res = await fetch(`/api/leads/${leadId}/send-file`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao enviar arquivo");
      setReply("");
      setFile(null);
      setQuoting(null);
      setSuggestCount(0); // enviou → novo turno, libera as sugestões de novo
      onReplied();
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Erro ao enviar");
    } finally {
      setReplying(false);
    }
  }

  // Sugestão de resposta da IA: pede um rascunho ao backend (reusa o motor de
  // atendimento) e joga na caixa p/ o operador editar. NÃO envia. Respeita o
  // limite por turno e o cooldown; cada chamada debita cota de IA no servidor.
  const suggestReached = suggestCount >= MAX_SUGGESTIONS;
  async function suggest() {
    if (suggesting || suggestCoolingDown || suggestReached) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/suggest-reply`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Falha ao sugerir resposta");
      setReply(data.suggestion ?? "");
      setQuoting(null);
      setSuggestCount((n) => n + 1);
      setSuggestCoolingDown(true);
      setTimeout(() => setSuggestCoolingDown(false), SUGGEST_COOLDOWN_MS);
      replyInputRef.current?.focus();
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Erro ao sugerir");
    } finally {
      setSuggesting(false);
    }
  }

  // Respostas rápidas: carrega uma vez (sob demanda) e cacheia no estado.
  async function loadQuickReplies() {
    if (quickReplies !== null) return;
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setQuickReplies((data.quickReplies as QuickReplyDTO[]) ?? []);
    } catch {
      setQuickReplies([]); // falha silenciosa: só não mostra o seletor
    }
  }

  // O seletor de "/" abre quando o operador começa a resposta com "/". O texto
  // após a barra filtra por título/atalho. Selecionar troca o texto pelo snippet
  // com {{nome}} resolvido (não envia — o operador revisa).
  const snippetOpen = aiPaused && reply.startsWith("/");
  const snippetQuery = snippetOpen ? reply.slice(1).trim().toLowerCase() : "";
  const filteredSnippets = (quickReplies ?? []).filter((q) => {
    if (!snippetQuery) return true;
    return (
      q.title.toLowerCase().includes(snippetQuery) ||
      (q.shortcut ?? "").toLowerCase().includes(snippetQuery)
    );
  });

  function insertSnippet(q: QuickReplyDTO) {
    setReply(renderSnippet(q.body, { nome: leadName }));
    replyInputRef.current?.focus();
  }

  return (
    <div className="flex h-[70vh] max-h-[600px] flex-col sm:h-[60vh]">
      <div className="scroll-thin flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">
            Nenhuma mensagem ainda. Inicie a campanha para enviar a primeira
            mensagem.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} onReply={aiPaused ? startQuote : undefined} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-100 p-3">
        {!canReply ? (
          <p className="text-center text-xs text-slate-400">
            Este lead ainda não foi contatado — inicie a campanha para abrir a
            conversa.
          </p>
        ) : (
          <>
            {/* Handoff humano: assumir conversa (pausar IA) / devolver à IA. */}
            {!hideHandoff && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium",
                  aiPaused ? "text-warning" : "text-slate-500",
                )}
              >
                {aiPaused ? <Hand size={14} /> : <Bot size={14} />}
                {aiPaused ? "Você assumiu — IA pausada" : "IA respondendo automaticamente"}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={toggleHandoff}
                loading={togglingHandoff}
              >
                {aiPaused ? (
                  <>
                    <Bot size={14} /> Devolver para a IA
                  </>
                ) : (
                  <>
                    <Hand size={14} /> Assumir conversa (pausar IA)
                  </>
                )}
              </Button>
            </div>
            )}
            {!hideHandoff && handoffError && (
              <p className="mb-2 text-xs text-danger">{handoffError}</p>
            )}

            {aiPaused ? (
              /* Caixa de resposta manual do operador (envia ao lead pelo chip). */
              <>
                {quoting && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand-400 bg-slate-50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-brand-600">
                        Respondendo {quoting.direction === "INBOUND" ? "ao lead" : "a você"}
                      </p>
                      <p className="truncate text-xs text-slate-500">{quoting.content}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuoting(null)}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      aria-label="Cancelar citação"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {/* Anexo selecionado: chip com o nome + remover. */}
                {file && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <Paperclip size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      aria-label="Remover anexo"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
                {/* Sugerir resposta (IA): gera um rascunho editável na caixa. */}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={suggest}
                    loading={suggesting}
                    disabled={suggestCoolingDown || suggestReached}
                    title={
                      suggestReached
                        ? "Limite de sugestões deste turno — envie a resposta para liberar"
                        : "Gerar um rascunho com a IA (você edita antes de enviar)"
                    }
                  >
                    <Sparkles size={14} />
                    {suggestCount === 0 ? "Sugerir resposta" : "Regenerar"}
                  </Button>
                  {suggestCount > 0 && (
                    <span className="text-[11px] text-slate-400">
                      {suggestCount}/{MAX_SUGGESTIONS}
                      {suggestReached && " · envie para liberar"}
                    </span>
                  )}
                  {suggestError && (
                    <span className="text-[11px] text-danger">{suggestError}</span>
                  )}
                </div>
                <div className="relative flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
                  {/* Seletor de respostas rápidas (abre ao digitar "/" no início). */}
                  {snippetOpen && (
                    <div className="absolute bottom-full left-0 z-10 mb-2 max-h-60 w-full overflow-y-auto rounded-xl border border-line-default bg-card p-1 shadow-lg sm:w-80">
                      {filteredSnippets.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400">
                          {quickReplies === null
                            ? "Carregando…"
                            : (quickReplies.length === 0
                                ? "Nenhuma resposta rápida cadastrada."
                                : "Nenhuma resposta encontrada.")}
                        </p>
                      ) : (
                        filteredSnippets.map((q) => (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => insertSnippet(q)}
                            className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                              {q.title}
                              {q.shortcut && (
                                <span className="text-[11px] font-normal text-slate-400">
                                  /{q.shortcut}
                                </span>
                              )}
                            </span>
                            <span className="line-clamp-1 text-xs text-slate-500">{q.body}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {/* Input de arquivo oculto + botão de anexo (clip). */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={replying}
                    className="justify-center sm:w-auto"
                    aria-label="Anexar arquivo"
                    title="Anexar arquivo"
                  >
                    <Paperclip size={16} />
                  </Button>
                  <textarea
                    ref={replyInputRef}
                    value={reply}
                    onChange={(e) => {
                      const v = e.target.value;
                      setReply(v);
                      // Abriu o "/" no início → garante que os snippets estão carregados.
                      if (v.startsWith("/")) loadQuickReplies();
                    }}
                    onKeyDown={(e) => {
                      // Com o seletor aberto, Enter escolhe a 1ª resposta em vez de enviar "/...".
                      if (snippetOpen && e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (filteredSnippets[0]) insertSnippet(filteredSnippets[0]);
                        return;
                      }
                      if (snippetOpen && e.key === "Escape") {
                        e.preventDefault();
                        setReply("");
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitReply();
                      }
                    }}
                    rows={1}
                    placeholder={
                      file ? "Legenda (opcional)…" : "Responder ao lead… (digite “/” para respostas rápidas)"
                    }
                    className="max-h-40 w-full flex-1 resize-none overflow-y-auto rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  <Button
                    onClick={submitReply}
                    loading={replying}
                    disabled={!reply.trim() && !file}
                    className="w-full justify-center sm:w-auto"
                  >
                    <Send size={16} /> Enviar
                  </Button>
                </div>
                {replyError && <p className="mt-1 text-xs text-danger">{replyError}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  A mensagem (ou arquivo) vai para o lead pelo mesmo número. A IA não
                  responde enquanto você está no controle.
                </p>
              </>
            ) : (
              /* Caixa "responder como o lead" (demo local / simula o inbound). */
              <>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Responder"
                    className="w-full flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                  <Button
                    onClick={send}
                    loading={sending}
                    disabled={!text.trim()}
                    className="w-full justify-center sm:w-auto"
                  >
                    <Send size={16} /> Enviar
                  </Button>
                </div>
                {error && <p className="mt-1 text-xs text-danger">{error}</p>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({
  message,
  onReply,
}: {
  message: Message;
  /** Presente quando o operador pode citar esta mensagem (handoff ativo). */
  onReply?: (m: Message) => void;
}) {
  const inbound = message.direction === "INBOUND";
  const quoted = message.replyTo;
  return (
    <div className={cn("group flex items-center gap-1.5", inbound ? "justify-start" : "justify-end")}>
      {/* Botão "responder/citar" — aparece no hover, à esquerda das bolhas de saída. */}
      {onReply && !inbound && (
        <button
          type="button"
          onClick={() => onReply(message)}
          className="opacity-0 transition group-hover:opacity-100 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Responder a esta mensagem"
        >
          <Reply size={14} />
        </button>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
          inbound
            ? "rounded-bl-sm bg-card text-slate-800"
            : "rounded-br-sm bg-brand-500 text-white",
        )}
      >
        {/* Citação (reply): resumo da mensagem original acima do conteúdo. */}
        {quoted && (
          <div
            className={cn(
              "mb-1 rounded border-l-2 px-2 py-1 text-xs",
              inbound
                ? "border-brand-400 bg-slate-50 text-slate-500"
                : "border-white/60 bg-white/15 text-brand-50",
            )}
          >
            <span className="font-medium">
              {quoted.direction === "INBOUND" ? "Lead" : "Você"}
            </span>
            <span className="ml-1 line-clamp-2 align-middle">{quoted.content}</span>
          </div>
        )}
        {message.mediaType ? (
          <>
            <MediaAttachment message={message} inbound={inbound} />
            {/* Legenda/transcrição junto do anexo (oculta o placeholder "📷 Imagem"). */}
            {!MEDIA_PLACEHOLDERS.has(message.content) && (
              <p className="mt-1 whitespace-pre-wrap">{message.content}</p>
            )}
          </>
        ) : (
          <p className="whitespace-pre-wrap">{message.content}</p>
        )}
        <p
          className={cn(
            "mt-0.5 text-[10px]",
            inbound ? "text-slate-400" : "text-brand-100",
          )}
        >
          {inbound ? "Lead" : "Você"} · {formatDateTime(message.createdAt)}
        </p>
      </div>
      {/* Para bolhas de entrada (lead), o botão fica à direita. */}
      {onReply && inbound && (
        <button
          type="button"
          onClick={() => onReply(message)}
          className="opacity-0 transition group-hover:opacity-100 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Responder a esta mensagem"
        >
          <Reply size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Anexo de mídia (imagem/PDF) recebido do lead. NÃO carrega o arquivo inline —
 * mostra só um chip com o nome e um botão "Baixar" que aponta p/ o endpoint
 * autenticado (/api/media/:id → redireciona p/ a URL assinada do storage).
 */
function MediaAttachment({
  message,
  inbound,
}: {
  message: Message;
  inbound: boolean;
}) {
  // Áudio (nota de voz): player inline em vez de chip de download. O <audio>
  // segue o redirect 302 do endpoint p/ a URL assinada do storage.
  if (message.mediaType === "audio") {
    return (
      <audio
        controls
        preload="none"
        src={`/api/media/${message.id}`}
        className="h-9 w-[220px] max-w-full sm:w-[240px]"
      >
        <a href={`/api/media/${message.id}`} target="_blank" rel="noopener noreferrer">
          Baixar áudio
        </a>
      </audio>
    );
  }

  // Imagem: miniatura clicável inline (abre o original assinado numa aba nova) em
  // vez de um chip de download — a conversa fica visual, igual ao WhatsApp. O <img>
  // segue o redirect 302 do endpoint p/ a URL assinada do storage.
  if (message.mediaType === "image") {
    return (
      <a
        href={`/api/media/${message.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        title={message.fileName || "Imagem"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/media/${message.id}`}
          alt={message.fileName || "Imagem"}
          loading="lazy"
          className="max-h-64 w-auto max-w-[240px] rounded-lg object-cover"
        />
      </a>
    );
  }

  // Documento/PDF: chip com nome + botão "Baixar".
  const name = message.fileName || "Documento";
  return (
    <a
      href={`/api/media/${message.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition",
        inbound
          ? "border-slate-200 bg-slate-50 hover:bg-slate-100"
          : "border-white/30 bg-white/10 hover:bg-white/20",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          inbound ? "bg-brand-100 text-brand-600" : "bg-white/20 text-white",
        )}
      >
        <FileText size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span
          className={cn(
            "flex items-center gap-1 text-[11px]",
            inbound ? "text-slate-400" : "text-brand-100",
          )}
        >
          <Download size={11} /> Baixar arquivo
        </span>
      </span>
      <Paperclip
        size={14}
        className={inbound ? "text-slate-300" : "text-brand-100"}
      />
    </a>
  );
}
