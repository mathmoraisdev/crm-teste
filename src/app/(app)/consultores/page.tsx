import { Lock } from "lucide-react";
import { env } from "@/lib/env";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { listConsultantLeads } from "@/server/services/consultant.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** E-mails admin do env (separados por vírgula), normalizados. */
function adminEmails(): Set<string> {
  return new Set(
    env.ADMIN_EMAILS.split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export default async function ConsultoresPage() {
  const userId = await getCurrentUserId();
  const user = userId ? await getUserById(userId) : null;
  const isAdmin = !!user && adminEmails().has(user.email.toLowerCase());

  if (!isAdmin) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Consultores
        </h1>
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={20} />
          </span>
          <p className="text-sm font-bold text-ink">Acesso restrito</p>
          <p className="max-w-sm text-sm text-slate-500">
            Esta área é exclusiva da equipe. Se você deveria ter acesso, peça
            para adicionarem seu e-mail à lista de administradores.
          </p>
        </Card>
      </div>
    );
  }

  const leads = await listConsultantLeads();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Consultores
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {leads.length === 0
            ? "Nenhum contato ainda."
            : `${leads.length} ${leads.length === 1 ? "contato recebido" : "contatos recebidos"}`}{" "}
          · funil &ldquo;fale com nosso consultor&rdquo;
        </p>
      </div>

      <Card className="overflow-hidden">
        {leads.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">
            Os leads que pedirem para falar com um consultor aparecem aqui.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>WhatsApp</Th>
                <Th>Plano</Th>
                <Th>Origem</Th>
                <Th>Status</Th>
                <Th>Recebido</Th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <div className="font-semibold text-ink">{l.name}</div>
                    {l.email && (
                      <div className="text-xs text-slate-400">{l.email}</div>
                    )}
                  </Td>
                  <Td className="font-mono text-[13px] text-slate-600">{l.whatsapp}</Td>
                  <Td className="text-slate-600">{l.plan ?? "—"}</Td>
                  <Td>
                    <Badge tone="slate">{l.source}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={l.status === "NOVO" ? "blue" : "green"}>{l.status}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-slate-500">
                    {formatDateTime(l.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
