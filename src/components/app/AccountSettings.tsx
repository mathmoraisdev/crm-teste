"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, MailWarning, Download, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/utils";

type Account = {
  name: string;
  email: string;
  whatsapp: string | null;
  emailVerified: string | null; // ISO ou null
  createdAt: string; // ISO
  accessUntil: string | null; // ISO — até quando o acesso vale (fim do período pago)
  cancelRequestedAt: string | null; // ISO — dono pediu p/ não renovar; null = ativa
};

type AiKeyStatus = {
  configured: boolean;
  provider: "OPENAI" | "ANTHROPIC" | null;
  last4: string | null;
  verifiedAt: string | null;
};

type AiUsage =
  | { unlimited: true; reason: "byok" | "grandfather" | "admin" }
  | { unlimited: false; used: number; quota: number; month: string };

type PaymentProvider = "MERCADO_PAGO" | "ASAAS";

type PaymentKeyStatus = {
  configured: boolean;
  provider: PaymentProvider | null;
  last4: string | null;
  verifiedAt: string | null;
};

const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = {
  MERCADO_PAGO: "Mercado Pago",
  ASAAS: "Asaas",
};

type FiscalProvider = "FOCUS_NFE" | "PLUGNOTAS" | "TECNOSPEED";
type FiscalEnv = "HOMOLOGACAO" | "PRODUCAO";

type FiscalKeyStatus = {
  configured: boolean;
  provider: FiscalProvider | null;
  last4: string | null;
  verifiedAt: string | null;
  enabled: boolean;
  env: FiscalEnv;
  serie: number;
  cnpj: string | null;
  defaultNcm: string | null;
  defaultCfop: string | null;
};

const FISCAL_PROVIDER_LABEL: Record<FiscalProvider, string> = {
  FOCUS_NFE: "Focus NFe",
  PLUGNOTAS: "PlugNotas",
  TECNOSPEED: "Tecnospeed",
};

export function AccountSettings({
  account,
  aiKey,
  aiUsage,
  paymentKey,
  fiscalKey,
  fiscalEmissionGlobal = false,
  salesAllowed = false,
  canSettings = true,
  isOwner = true,
}: {
  account: Account;
  aiKey: AiKeyStatus;
  aiUsage: AiUsage;
  paymentKey?: PaymentKeyStatus;
  fiscalKey?: FiscalKeyStatus;
  fiscalEmissionGlobal?: boolean; // kill-switch global FISCAL_EMISSION (só p/ aviso na UI)
  salesAllowed?: boolean; // plano permite o funil de vendas (mostra o bloco de Pix)
  canSettings?: boolean;
  isOwner?: boolean; // dono/ADMIN — só ele exporta/exclui a conta
}) {
  const router = useRouter();
  const verified = !!account.emailVerified;

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Assinatura (cancelar/reativar). `canceledAt` = ISO se há cancelamento pedido.
  const [canceledAt, setCanceledAt] = useState<string | null>(account.cancelRequestedAt);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  // Troca de senha (self-service, exige a senha atual).
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdDone, setPwdDone] = useState(false);

  // BYOK: chave de API do usuário.
  const [status, setStatus] = useState<AiKeyStatus>(aiKey);
  const [provider, setProvider] = useState<"OPENAI" | "ANTHROPIC">(
    aiKey.provider ?? "OPENAI",
  );
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  async function saveKey() {
    setSaving(true);
    setKeyError(null);
    try {
      const res = await fetch("/api/account/ai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: keyInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
      setStatus(data);
      setKeyInput("");
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    await fetch("/api/account/ai-key", { method: "DELETE" });
    setStatus({ configured: false, provider: null, last4: null, verifiedAt: null });
  }

  // BYOK de pagamento: gateway Pix do cliente (Mercado Pago / Asaas).
  const [payStatus, setPayStatus] = useState<PaymentKeyStatus>(
    paymentKey ?? { configured: false, provider: null, last4: null, verifiedAt: null },
  );
  const [payProvider, setPayProvider] = useState<PaymentProvider>(
    paymentKey?.provider ?? "MERCADO_PAGO",
  );
  const [payKeyInput, setPayKeyInput] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  async function savePaymentKey() {
    setPaySaving(true);
    setPayError(null);
    try {
      const res = await fetch("/api/account/payment-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: payProvider, apiKey: payKeyInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao conectar.");
      setPayStatus(data);
      setPayKeyInput("");
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Erro ao conectar.");
    } finally {
      setPaySaving(false);
    }
  }

  async function removePaymentKey() {
    await fetch("/api/account/payment-key", { method: "DELETE" });
    setPayStatus({ configured: false, provider: null, last4: null, verifiedAt: null });
  }

  // BYOK fiscal: emissor terceiro de NFC-e (Focus NFe / PlugNotas / Tecnospeed).
  const EMPTY_FISCAL: FiscalKeyStatus = {
    configured: false, provider: null, last4: null, verifiedAt: null,
    enabled: false, env: "HOMOLOGACAO", serie: 1, cnpj: null,
    defaultNcm: null, defaultCfop: null,
  };
  const [fiscalStatus, setFiscalStatus] = useState<FiscalKeyStatus>(fiscalKey ?? EMPTY_FISCAL);
  const [fiscalProvider, setFiscalProvider] = useState<FiscalProvider>(
    fiscalKey?.provider ?? "FOCUS_NFE",
  );
  const [fiscalEnvSel, setFiscalEnvSel] = useState<FiscalEnv>(fiscalKey?.env ?? "HOMOLOGACAO");
  const [fiscalKeyInput, setFiscalKeyInput] = useState("");
  const [fiscalSaving, setFiscalSaving] = useState(false);
  const [fiscalError, setFiscalError] = useState<string | null>(null);
  // Perfil fiscal (série/CNPJ/NCM/CFOP + opt-in).
  const [fiscalSerie, setFiscalSerie] = useState<number>(fiscalKey?.serie ?? 1);
  const [fiscalCnpj, setFiscalCnpj] = useState(fiscalKey?.cnpj ?? "");
  const [fiscalNcm, setFiscalNcm] = useState(fiscalKey?.defaultNcm ?? "");
  const [fiscalCfop, setFiscalCfop] = useState(fiscalKey?.defaultCfop ?? "");
  const [fiscalProfileSaving, setFiscalProfileSaving] = useState(false);
  const [fiscalProfileMsg, setFiscalProfileMsg] = useState<string | null>(null);

  async function saveFiscalKey() {
    setFiscalSaving(true);
    setFiscalError(null);
    try {
      const res = await fetch("/api/account/fiscal-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: fiscalProvider, apiKey: fiscalKeyInput, env: fiscalEnvSel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao conectar.");
      setFiscalStatus(data);
      setFiscalEnvSel(data.env);
      setFiscalSerie(data.serie);
      setFiscalKeyInput("");
    } catch (e) {
      setFiscalError(e instanceof Error ? e.message : "Erro ao conectar.");
    } finally {
      setFiscalSaving(false);
    }
  }

  async function removeFiscalKey() {
    await fetch("/api/account/fiscal-key", { method: "DELETE" });
    setFiscalStatus(EMPTY_FISCAL);
  }

  async function patchFiscalProfile(patch: Record<string, unknown>) {
    setFiscalProfileSaving(true);
    setFiscalProfileMsg(null);
    try {
      const res = await fetch("/api/account/fiscal-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar.");
      setFiscalStatus(data);
      setFiscalProfileMsg("Salvo.");
    } catch (e) {
      setFiscalProfileMsg(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setFiscalProfileSaving(false);
    }
  }

  async function changePwd() {
    setPwdError(null);
    setPwdDone(false);
    if (newPwd.length < 8) {
      setPwdError("A nova senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError("As senhas não conferem.");
      return;
    }
    setPwdSaving(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: curPwd, newPassword: newPwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwdError(data?.error || "Não foi possível alterar a senha.");
        return;
      }
      setPwdDone(true);
      setCurPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch {
      setPwdError("Erro de rede. Tente novamente.");
    } finally {
      setPwdSaving(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      await fetch("/api/auth/resend-verification", { method: "POST" });
      setResent(true);
    } catch {
      // best-effort: mostra a confirmação neutra mesmo em erro de rede
      setResent(true);
    } finally {
      setResending(false);
    }
  }

  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `disparador-ai-dados-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Erro ao excluir a conta.");
    }
    // Sessão já foi limpa pelo servidor — vai para a landing.
    router.replace("/");
    router.refresh();
  }

  // Cancelar/reativar assinatura. Não corta acesso nem apaga dados — só marca a
  // intenção; o acesso segue até `accessUntil`. `setSubscription(true)` é usado
  // pelo ConfirmDialog (ele trata loading/erro); a reativação tem estado próprio.
  async function setSubscription(cancel: boolean) {
    const res = await fetch("/api/account/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Erro ao atualizar a assinatura.");
    }
    setCanceledAt(cancel ? new Date().toISOString() : null);
    router.refresh();
  }

  async function reactivate() {
    setReactivating(true);
    setSubError(null);
    try {
      await setSubscription(false);
    } catch (e) {
      setSubError(e instanceof Error ? e.message : "Erro ao reativar.");
    } finally {
      setReactivating(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Dados da conta */}
      <Card>
        <CardHeader title="Dados da conta" subtitle="Informações do seu cadastro." />
        <dl className="divide-y divide-slate-100">
          <Row label="Nome" value={account.name} />
          <Row
            label="E-mail"
            value={
              <span className="flex flex-wrap items-center gap-2">
                {account.email}
                {verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                    <BadgeCheck size={13} /> Verificado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-xs font-semibold text-warning">
                    <MailWarning size={13} /> Não verificado
                  </span>
                )}
              </span>
            }
          />
          <Row label="WhatsApp" value={account.whatsapp || "—"} />
          <Row label="Conta criada em" value={formatDateTime(account.createdAt)} />
        </dl>

        {!verified && (
          <div className="border-t border-slate-100 px-5 py-4">
            {resent ? (
              <p className="text-sm text-slate-600">
                E-mail de verificação enviado. Confira sua caixa de entrada (e o spam).
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Confirme seu e-mail para garantir o acesso à sua conta.
                </p>
                <Button variant="secondary" onClick={resendVerification} loading={resending}>
                  Reenviar verificação
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Senha */}
      <Card>
        <CardHeader title="Senha" subtitle="Altere sua senha de acesso ao painel." />
        <div className="space-y-3 px-5 py-4">
          <input
            type="password"
            autoComplete="current-password"
            value={curPwd}
            onChange={(e) => setCurPwd(e.target.value)}
            placeholder="Senha atual"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="Nova senha (mín. 8 caracteres)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPwd}
            onChange={(e) => setConfirmPwd(e.target.value)}
            placeholder="Confirmar nova senha"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          {pwdError && <p className="text-sm text-danger">{pwdError}</p>}
          {pwdDone && (
            <p className="text-sm text-brand-700">Senha alterada com sucesso.</p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={changePwd}
              loading={pwdSaving}
              disabled={!curPwd || newPwd.length < 8 || !confirmPwd}
            >
              Alterar senha
            </Button>
          </div>
        </div>
      </Card>

      {/* Privacidade / LGPD — operações da conta inteira: só o dono. */}
      {isOwner && (
        <Card>
          <CardHeader
            title="Privacidade e seus dados"
            subtitle="Baixe uma cópia de tudo o que guardamos sobre você (LGPD)."
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <p className="text-sm text-slate-600">
              Exporta conta, leads, campanhas, mensagens e números em um arquivo JSON.
            </p>
            <Button variant="secondary" onClick={exportData} disabled={exporting}>
              {exporting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Exportar meus dados
            </Button>
          </div>
        </Card>
      )}

      {/* BYOK — Chave de API de IA */}
      <Card>
        <CardHeader
          title="Chave de API de IA"
          subtitle="Use sua própria chave (OpenAI ou Anthropic). Se não configurar, usamos a chave da plataforma."
        />
        <div className="space-y-3 px-5 py-4">
          {!canSettings ? (
            <p className="text-sm text-slate-600">
              {status.configured
                ? `${status.provider} • chave terminando em ••••${status.last4}${status.verifiedAt ? " • validada" : ""}.`
                : "Usando a chave da plataforma."}{" "}
              Apenas o administrador da conta pode alterar a chave de IA.
            </p>
          ) : status.configured ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {status.provider} • chave terminando em{" "}
                <strong>••••{status.last4}</strong>
                {status.verifiedAt ? " • validada" : ""}
              </p>
              <Button variant="secondary" onClick={removeKey}>
                Remover
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={provider}
                  onChange={(e) =>
                    setProvider(e.target.value as "OPENAI" | "ANTHROPIC")
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
                >
                  <option value="OPENAI">OpenAI</option>
                  <option value="ANTHROPIC">Anthropic</option>
                </select>
                <input
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={provider === "OPENAI" ? "sk-..." : "sk-ant-..."}
                  className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              {keyError && <p className="text-sm text-danger">{keyError}</p>}
              <div className="flex justify-end">
                <Button
                  onClick={saveKey}
                  loading={saving}
                  disabled={keyInput.length < 12}
                >
                  Testar e salvar
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Medidor de consumo na chave da plataforma (BYOK = ilimitado). */}
        <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
          {aiUsage.unlimited ? (
            <span>
              Atendimentos de IA: <strong>Ilimitado</strong>
              {aiUsage.reason === "byok" ? " (sua chave)" : ""}
            </span>
          ) : (
            <>
              <span>
                Atendimentos de IA: <strong>{aiUsage.used} / {aiUsage.quota}</strong> créditos este mês
              </span>
              <p className="mt-1 text-xs text-slate-400">
                Modelo econômico = 1 crédito por atendimento; modelo avançado = 10.
              </p>
              {aiUsage.used >= aiUsage.quota && (
                <p className="mt-1 text-danger">
                  Cota esgotada. Faça upgrade de plano ou cadastre sua própria chave de IA acima para
                  liberar atendimentos ilimitados.
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* BYOK de pagamento — receber Pix na conta do gateway do cliente. Só
          aparece se o plano permite o funil de vendas. */}
      {salesAllowed && (
        <Card>
          <CardHeader
            title="Receber pagamentos (Pix)"
            subtitle="Conecte seu Mercado Pago ou Asaas. A cobrança cai direto na sua conta — a plataforma não intermedia o dinheiro."
          />
          <div className="space-y-3 px-5 py-4">
            {!canSettings ? (
              <p className="text-sm text-slate-600">
                {payStatus.configured
                  ? `${payStatus.provider ? PAYMENT_PROVIDER_LABEL[payStatus.provider] : ""} • conectado ••••${payStatus.last4}.`
                  : "Nenhum gateway conectado."}{" "}
                Apenas o administrador da conta pode conectar um gateway.
              </p>
            ) : payStatus.configured ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  {payStatus.provider ? PAYMENT_PROVIDER_LABEL[payStatus.provider] : ""} • conectado{" "}
                  <strong>••••{payStatus.last4}</strong>
                  {payStatus.verifiedAt ? " • validado" : ""}
                </p>
                <Button variant="secondary" onClick={removePaymentKey}>
                  Remover
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={payProvider}
                    onChange={(e) => setPayProvider(e.target.value as PaymentProvider)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
                  >
                    <option value="MERCADO_PAGO">Mercado Pago</option>
                    <option value="ASAAS">Asaas</option>
                  </select>
                  <input
                    type="password"
                    value={payKeyInput}
                    onChange={(e) => setPayKeyInput(e.target.value)}
                    placeholder={payProvider === "MERCADO_PAGO" ? "Access Token (APP_USR-...)" : "API Key ($aact_...)"}
                    className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                {payError && <p className="text-sm text-danger">{payError}</p>}
                <div className="flex justify-end">
                  <Button onClick={savePaymentKey} loading={paySaving} disabled={payKeyInput.length < 12}>
                    Conectar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* BYOK fiscal — emitir NFC-e no fechamento via emissor terceiro (Focus NFe/…).
          Opt-in por conta; o cadastro tributário pesado mora no emissor. Só o dono. */}
      {isOwner && (
        <Card className="mt-6">
          <CardHeader
            title="Nota fiscal (NFC-e)"
            subtitle="Emita a nota do consumidor no fechamento da comanda via emissor terceiro. Você conecta o token do emissor; a assinatura e o cadastro tributário ficam com ele."
          />
          <div className="space-y-4 px-5 py-4">
            {!canSettings ? (
              <p className="text-sm text-slate-600">
                {fiscalStatus.configured
                  ? `${fiscalStatus.provider ? FISCAL_PROVIDER_LABEL[fiscalStatus.provider] : ""} • conectado ••••${fiscalStatus.last4}.`
                  : "Nenhum emissor conectado."}{" "}
                Apenas o administrador da conta pode configurar a emissão fiscal.
              </p>
            ) : (
              <>
                {/* Credencial */}
                {fiscalStatus.configured ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-600">
                      {fiscalStatus.provider ? FISCAL_PROVIDER_LABEL[fiscalStatus.provider] : ""} • conectado{" "}
                      <strong>••••{fiscalStatus.last4}</strong>
                      {fiscalStatus.verifiedAt ? " • validado" : ""} •{" "}
                      {fiscalStatus.env === "PRODUCAO" ? "produção" : "homologação"}
                    </p>
                    <Button variant="secondary" onClick={removeFiscalKey}>
                      Remover
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        value={fiscalProvider}
                        onChange={(e) => setFiscalProvider(e.target.value as FiscalProvider)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
                      >
                        <option value="FOCUS_NFE">Focus NFe</option>
                        <option value="PLUGNOTAS">PlugNotas</option>
                        <option value="TECNOSPEED">Tecnospeed</option>
                      </select>
                      <select
                        value={fiscalEnvSel}
                        onChange={(e) => setFiscalEnvSel(e.target.value as FiscalEnv)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm sm:w-auto"
                      >
                        <option value="HOMOLOGACAO">Homologação (teste)</option>
                        <option value="PRODUCAO">Produção (nota real)</option>
                      </select>
                      <input
                        type="password"
                        value={fiscalKeyInput}
                        onChange={(e) => setFiscalKeyInput(e.target.value)}
                        placeholder="Token da API do emissor"
                        className="w-full flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    {fiscalEnvSel === "PRODUCAO" && (
                      <p className="text-sm text-warning">
                        Produção emite nota fiscal <strong>real</strong> (valor contábil). Use homologação para testar.
                      </p>
                    )}
                    {fiscalError && <p className="text-sm text-danger">{fiscalError}</p>}
                    <div className="flex justify-end">
                      <Button onClick={saveFiscalKey} loading={fiscalSaving} disabled={fiscalKeyInput.length < 12}>
                        Conectar
                      </Button>
                    </div>
                  </>
                )}

                {/* Perfil fiscal + opt-in (só com credencial configurada) */}
                {fiscalStatus.configured && (
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">Série</span>
                        <input
                          type="number"
                          min={1}
                          value={fiscalSerie}
                          onChange={(e) => setFiscalSerie(Math.max(1, Number(e.target.value) || 1))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">CNPJ emitente</span>
                        <input
                          value={fiscalCnpj}
                          onChange={(e) => setFiscalCnpj(e.target.value)}
                          placeholder="00.000.000/0000-00"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">NCM padrão</span>
                        <input
                          value={fiscalNcm}
                          onChange={(e) => setFiscalNcm(e.target.value)}
                          placeholder="ex.: 21069090"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-slate-600">CFOP padrão</span>
                        <input
                          value={fiscalCfop}
                          onChange={(e) => setFiscalCfop(e.target.value)}
                          placeholder="ex.: 5102"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      {fiscalProfileMsg && <p className="text-sm text-slate-500">{fiscalProfileMsg}</p>}
                      <Button
                        variant="secondary"
                        loading={fiscalProfileSaving}
                        onClick={() =>
                          patchFiscalProfile({
                            fiscalSerie,
                            fiscalCnpj: fiscalCnpj.trim() || null,
                            fiscalDefaultNcm: fiscalNcm.trim() || null,
                            fiscalDefaultCfop: fiscalCfop.trim() || null,
                          })
                        }
                        className="ml-auto"
                      >
                        Salvar perfil
                      </Button>
                    </div>

                    {/* Opt-in: emitir no fechamento */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">Emitir NFC-e no fechamento</p>
                        <p className="mt-0.5 text-sm text-slate-500">
                          {fiscalStatus.enabled
                            ? "Cada comanda fechada vira nota (assíncrono, no worker)."
                            : "Desligado — nenhuma comanda vira nota."}
                        </p>
                      </div>
                      <Button
                        variant={fiscalStatus.enabled ? "secondary" : "primary"}
                        loading={fiscalProfileSaving}
                        onClick={() => patchFiscalProfile({ fiscalEnabled: !fiscalStatus.enabled })}
                      >
                        {fiscalStatus.enabled ? "Desligar" : "Ligar"}
                      </Button>
                    </div>
                    {fiscalStatus.enabled && !fiscalEmissionGlobal && (
                      <p className="text-sm text-slate-500">
                        Emissão em implantação — sua conta está pronta; ligamos globalmente em breve.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {/* Assinatura — cancelar/reativar: só o dono. Não corta acesso nem apaga dados. */}
      {isOwner && (
        <Card className="mt-6">
          <CardHeader
            title="Assinatura"
            subtitle="Cancele quando quiser, sem multa nem fidelidade."
          />
          <div className="px-5 py-4">
            {canceledAt ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">Cancelamento solicitado</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {account.accessUntil ? (
                      <>
                        Seu acesso continua até{" "}
                        <strong>{formatDateTime(account.accessUntil)}</strong>. Depois
                        disso a conta é desativada, mas seus dados não são apagados.
                      </>
                    ) : (
                      <>
                        Sua assinatura não será renovada. Seus dados continuam salvos
                        e você pode reativar quando quiser.
                      </>
                    )}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={reactivate}
                  loading={reactivating}
                >
                  Reativar assinatura
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Você mantém o acesso até o fim do período já pago
                  {account.accessUntil && (
                    <> (<strong>{formatDateTime(account.accessUntil)}</strong>)</>
                  )}
                  . Nenhum dado é apagado — dá para reativar antes disso.
                </p>
                <Button variant="secondary" onClick={() => setConfirmCancel(true)}>
                  Cancelar assinatura
                </Button>
              </div>
            )}
            {subError && (
              <p className="mt-3 rounded-md bg-danger-surface px-3 py-2 text-sm text-danger">
                {subError}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Zona de perigo — excluir a conta inteira: só o dono. */}
      {isOwner && (
        <Card className="border-danger">
          <CardHeader
            title={<span className="text-danger">Zona de perigo</span>}
            subtitle="Esta ação é permanente e não pode ser desfeita."
          />
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <p className="text-sm text-slate-600">
              Excluir a conta remove todos os seus leads, campanhas, mensagens e números conectados.
            </p>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Excluir minha conta
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar assinatura"
        confirmLabel="Confirmar cancelamento"
        danger={false}
        message={
          account.accessUntil ? (
            <>
              Você mantém o acesso até{" "}
              <strong>{formatDateTime(account.accessUntil)}</strong>. Não há multa,
              e seus dados <strong>não são apagados</strong> — dá para reativar antes
              dessa data. Deseja continuar?
            </>
          ) : (
            <>
              Sua assinatura deixará de ser renovada. Seus dados{" "}
              <strong>não são apagados</strong> e você pode reativar quando quiser.
              Deseja continuar?
            </>
          )
        }
        onConfirm={() => setSubscription(true)}
        onClose={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir minha conta"
        confirmLabel="Excluir definitivamente"
        message={
          <>
            Tem certeza? Todos os seus dados (leads, campanhas, mensagens e números) serão
            apagados <strong>permanentemente</strong>. Esta ação não pode ser desfeita.
          </>
        }
        onConfirm={deleteAccount}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
      <dt className="text-sm font-semibold text-slate-500">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
