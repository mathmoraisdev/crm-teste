"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, Unlock, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatCentsBRL, parseBRLToCents } from "@/lib/money";

interface CashSession {
  id: string;
  status: "ABERTA" | "FECHADA";
  openingFloatCents: number;
  openedById: string;
  openedAt: string;
}

interface SessionSummary {
  cashSalesCents: number;
  salesByMethod: Record<"DINHEIRO" | "PIX" | "CARTAO" | "OUTRO", number>;
  suprimentosCents: number;
  sangriasCents: number;
  expected: number;
  counted: number | null;
  diff: number | null;
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Barra de estado do turno no topo do OrderBoard. Caixa fechado → abrir (pede o
 * fundo de troco). Caixa aberto → sangria/suprimento/fechar. O fechamento é CEGO:
 * o operador digita o contado antes de ver o esperado; a diferença é revelada só
 * depois de gravar ([[design-tokens-dark-theme]] p/ as cores de sobra/falta). */
export function CashSessionBar() {
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "open" | "sangria" | "suprimento" | "close">(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendas/cash-session", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setSession(data.session as CashSession | null);
    } catch {
      /* mantém estado anterior */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mb-4 rounded-xl border border-line-default bg-card px-4 py-3">
      {error && <p className="mb-2 rounded-lg bg-danger-surface px-3 py-1.5 text-xs text-danger">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Carregando caixa…
        </div>
      ) : session ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Unlock size={16} className="text-brand-600" />
            <div>
              <p className="text-sm font-semibold text-ink">Caixa aberto às {hhmm(session.openedAt)}</p>
              <p className="text-xs text-slate-500">Fundo de troco: {formatCentsBRL(session.openingFloatCents)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setModal("sangria")}>
              <ArrowDownCircle size={14} /> Sangria
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setModal("suprimento")}>
              <ArrowUpCircle size={14} /> Suprimento
            </Button>
            <Button size="sm" onClick={() => setModal("close")}>
              <Lock size={14} /> Fechar caixa
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Lock size={16} className="text-slate-400" />
            <p className="text-sm font-medium text-slate-500">
              Caixa fechado — abra um turno para conferir a gaveta ao final.
            </p>
          </div>
          <Button size="sm" onClick={() => setModal("open")}>
            <Unlock size={14} /> Abrir caixa
          </Button>
        </div>
      )}

      {modal === "open" && (
        <OpenModal
          onClose={() => setModal(null)}
          onDone={async () => {
            setModal(null);
            await load();
          }}
          onError={setError}
        />
      )}
      {(modal === "sangria" || modal === "suprimento") && session && (
        <MovementModal
          sessionId={session.id}
          kind={modal === "sangria" ? "SANGRIA" : "SUPRIMENTO"}
          onClose={() => setModal(null)}
          onDone={() => setModal(null)}
          onError={setError}
        />
      )}
      {modal === "close" && session && (
        <CloseModal
          sessionId={session.id}
          onClose={() => setModal(null)}
          onDone={async () => {
            setModal(null);
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

// ── Abrir caixa (fundo de troco) ─────────────────────────────────────────────
function OpenModal({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const cents = parseBRLToCents(raw) ?? 0; // fundo pode ser 0
    setBusy(true);
    onError(null);
    try {
      const res = await fetch("/api/vendas/cash-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingFloatCents: cents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao abrir o caixa.");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao abrir o caixa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Abrir caixa">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Fundo de troco</label>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            inputMode="decimal"
            autoFocus
            placeholder="R$ 0,00"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <p className="mt-1 text-xs text-slate-400">
            Dinheiro inicial na gaveta para dar troco. Entra no esperado da conferência.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Abrir caixa
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Sangria / Suprimento ─────────────────────────────────────────────────────
function MovementModal({
  sessionId,
  kind,
  onClose,
  onDone,
  onError,
}: {
  sessionId: string;
  kind: "SANGRIA" | "SUPRIMENTO";
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [raw, setRaw] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const isSangria = kind === "SANGRIA";

  async function submit() {
    const cents = parseBRLToCents(raw);
    if (cents == null || cents <= 0) return onError("Informe um valor válido.");
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/vendas/cash-session/${sessionId}/movement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, amountCents: cents, reason: reason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao registrar o movimento.");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao registrar o movimento.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isSangria ? "Sangria (retirada)" : "Suprimento (reforço)"}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          {isSangria
            ? "Retirada de dinheiro da gaveta (depósito, sangria de segurança). Reduz o esperado."
            : "Reforço de dinheiro na gaveta (troco extra). Aumenta o esperado."}
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Valor</label>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder="R$ 0,00"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Motivo (opcional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={isSangria ? "ex.: depósito bancário" : "ex.: troco extra"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Fechar caixa (conferência cega) ──────────────────────────────────────────
function CloseModal({
  sessionId,
  onClose,
  onDone,
  onError,
}: {
  sessionId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  async function submit() {
    const cents = parseBRLToCents(raw);
    if (cents == null) return onError("Informe o valor contado.");
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/vendas/cash-session/${sessionId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedCents: cents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao fechar o caixa.");
      setSummary(data.summary as SessionSummary); // só agora o esperado é revelado
    } catch (e) {
      onError(e instanceof Error ? e.message : "Erro ao fechar o caixa.");
    } finally {
      setBusy(false);
    }
  }

  // Fase 2: conferência revelada (esperado × contado × diferença).
  if (summary) {
    const diff = summary.diff ?? 0;
    const tone =
      diff === 0
        ? { box: "bg-success-surface text-success", label: "Caixa bateu certo" }
        : diff < 0
          ? { box: "bg-danger-surface text-danger", label: `Falta ${formatCentsBRL(-diff)}` }
          : { box: "bg-warning-surface text-warning", label: `Sobra ${formatCentsBRL(diff)}` };
    return (
      <Modal open onClose={onDone} title="Conferência do caixa">
        <div className="space-y-4">
          <div className="space-y-1.5 text-sm">
            <Row label="Esperado em dinheiro" value={formatCentsBRL(summary.expected)} />
            <Row label="Contado na gaveta" value={formatCentsBRL(summary.counted ?? 0)} />
          </div>
          <div className={`rounded-lg px-4 py-3 text-center font-bold ${tone.box}`}>{tone.label}</div>
          <div className="space-y-1 border-t border-line-default pt-3 text-xs text-slate-500">
            <Row label="Vendas em dinheiro" value={formatCentsBRL(summary.cashSalesCents)} muted />
            <Row label="Suprimentos" value={`+ ${formatCentsBRL(summary.suprimentosCents)}`} muted />
            <Row label="Sangrias" value={`− ${formatCentsBRL(summary.sangriasCents)}`} muted />
            <Row label="Pix (informativo)" value={formatCentsBRL(summary.salesByMethod.PIX)} muted />
            <Row label="Cartão (informativo)" value={formatCentsBRL(summary.salesByMethod.CARTAO)} muted />
          </div>
          <div className="flex justify-end">
            <Button onClick={onDone}>Concluir</Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Fase 1: conferência cega — pede o contado SEM mostrar o esperado.
  return (
    <Modal open onClose={onClose} title="Fechar caixa">
      <div className="space-y-4">
        <p className="text-xs text-slate-500">
          Conte o dinheiro na gaveta e informe o total. O esperado só aparece depois — para a
          conferência ser honesta.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink">Valor contado na gaveta</label>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            inputMode="decimal"
            autoFocus
            placeholder="R$ 0,00"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Conferir e fechar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-slate-500" : "text-slate-600"}>{label}</span>
      <span className={muted ? "text-slate-500" : "font-semibold text-ink"}>{value}</span>
    </div>
  );
}
