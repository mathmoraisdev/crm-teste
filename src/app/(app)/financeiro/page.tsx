import { Lock } from "lucide-react";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { listAccountsForAdmin } from "@/server/services/account.service";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/utils";
import { AccountBillingToggle } from "@/components/app/AccountBillingToggle";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const userId = await getCurrentUserId();
  const me = userId ? await getUserById(userId) : null;

  if (!isAdminEmail(me?.email)) {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Financeiro
        </h1>
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={20} />
          </span>
          <p className="text-sm font-bold text-ink">Acesso restrito</p>
          <p className="max-w-sm text-sm text-slate-500">
            Esta área é exclusiva do administrador.
          </p>
        </Card>
      </div>
    );
  }

  const accounts = await listAccountsForAdmin();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Ative ou suspenda contas conforme o pagamento. Conta suspensa: a IA não
          responde e o disparo congela até a reativação.
        </p>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Conta</Th>
              <Th>Chips</Th>
              <Th>Leads</Th>
              <Th>Criada</Th>
              <Th>Status</Th>
              <Th>Ação</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <Td>
                  <div className="font-semibold text-ink">
                    {a.name}
                    {a.isAdmin && (
                      <Badge tone="blue" className="ml-2">
                        admin
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{a.email}</div>
                </Td>
                <Td className="text-slate-600">{a.numbers}</Td>
                <Td className="text-slate-600">{a.leads}</Td>
                <Td className="whitespace-nowrap text-slate-500">
                  {formatDateTime(a.createdAt)}
                </Td>
                <Td>
                  <Badge tone={a.billingActive ? "green" : "slate"}>
                    {a.billingActive ? "Ativo" : "Suspenso"}
                  </Badge>
                </Td>
                <Td>
                  <AccountBillingToggle
                    accountId={a.id}
                    active={a.billingActive}
                    disabled={a.isAdmin}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
