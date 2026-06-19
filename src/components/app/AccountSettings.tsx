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
};

export function AccountSettings({ account }: { account: Account }) {
  const router = useRouter();
  const verified = !!account.emailVerified;

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
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

      {/* Privacidade / LGPD */}
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

      {/* Zona de perigo */}
      <Card className="border-red-200">
        <CardHeader
          title={<span className="text-[#C0392B]">Zona de perigo</span>}
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
