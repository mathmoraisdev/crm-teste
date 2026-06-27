import { Lock } from "lucide-react";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { listAccountsForAdmin } from "@/server/services/account.service";
import { revenueCents, revenueTotalCents, listPayments } from "@/server/services/payment.service";
import { monthRange, currentMonth } from "@/lib/period";
import { formatCentsBRL } from "@/lib/money";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table, Th, Td } from "@/components/ui/Table";
import { formatDateTime } from "@/lib/utils";
import { AccountAccessModal } from "@/components/app/AccountAccessModal";
import { FinanceiroFilters } from "@/components/app/FinanceiroFilters";
import { LandingToggle } from "@/components/app/LandingToggle";
import { isLandingEnabled } from "@/server/services/settings.service";

export const dynamic = "force-dynamic";

const METHOD_LABELS = { PIX: "Pix", CARTAO: "Cartão", BOLETO: "Boleto", TRANSFERENCIA: "Transferência" } as const;
const PLAN_LABELS = { INICIAL: "Inicial", PROFISSIONAL: "Profissional", ESCALA: "Escala" } as const;

export default async function FinanceiroPage({
  searchParams,
}: { searchParams: Promise<{ month?: string; status?: string }> }) {
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

  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : currentMonth();
  const status = sp.status ?? "todos"; // todos | ativo | suspenso
  const { from, to } = monthRange(month);

  const [accounts, revMonth, revTotal, payments, landingOn] = await Promise.all([
    listAccountsForAdmin(),
    revenueCents(from, to),
    revenueTotalCents(),
    listPayments(from, to),
    isLandingEnabled(),
  ]);

  const filteredAccounts = accounts.filter((a) =>
    status === "ativo" ? a.active : status === "suspenso" ? !a.active : true,
  );
  const activeCount = accounts.filter((a) => a.active).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Financeiro
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Gerencie o prazo de acesso de cada conta. O acesso expira sozinho na
          validade (trial ou pago); suspensa/vencida: a IA não responde e o
          disparo congela até estender ou forçar ativo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-slate-400">Receita ({month})</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatCentsBRL(revMonth)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Receita total</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatCentsBRL(revTotal)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Pagamentos no mês</p>
          <p className="mt-1 text-2xl font-bold text-ink">{payments.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-400">Contas ativas</p>
          <p className="mt-1 text-2xl font-bold text-ink">{activeCount}</p>
        </Card>
      </div>

      <Card className="p-4">
        <LandingToggle initialEnabled={landingOn} />
      </Card>

      <FinanceiroFilters month={month} status={status} />

      <Card className="overflow-hidden">
        <Table>
          <thead>
            <tr>
              <Th>Conta</Th>
              <Th>Plano</Th>
              <Th>Usuários</Th>
              <Th>Chips</Th>
              <Th>Leads</Th>
              <Th>Criada</Th>
              <Th>Validade</Th>
              <Th>Pagamento</Th>
              <Th>Status</Th>
              <Th>Ação</Th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((a) => (
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
                <Td>
                  {a.plan ? (
                    <Badge tone="blue">{PLAN_LABELS[a.plan]}</Badge>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-slate-600">
                  {a.maxSeats != null ? `${a.seatsUsed}/${a.maxSeats}` : a.seatsUsed}
                </Td>
                <Td className="text-slate-600">{a.numbers}</Td>
                <Td className="text-slate-600">{a.leads}</Td>
                <Td className="whitespace-nowrap text-slate-500">
                  {formatDateTime(a.createdAt)}
                </Td>
                <Td className="whitespace-nowrap text-slate-500">
                  {a.accessUntil ? formatDateTime(a.accessUntil) : "—"}
                  {a.daysLeft != null && (
                    <span className="ml-1 text-xs text-slate-400">({a.daysLeft}d)</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-slate-500">
                  {a.paymentMethod ? METHOD_LABELS[a.paymentMethod] : "—"}
                  {a.paymentDueDate && (
                    <span className="ml-1 text-xs text-slate-400">
                      vence {formatDateTime(a.paymentDueDate)}
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={a.active ? "green" : "slate"}>
                    {a.active ? "Ativo" : "Suspenso"}
                  </Badge>
                </Td>
                <Td>
                  <AccountAccessModal
                    accountId={a.id}
                    active={a.active}
                    isAdmin={a.isAdmin}
                    daysLeft={a.daysLeft}
                    paymentMethod={a.paymentMethod}
                    paymentDueDate={a.paymentDueDate ? a.paymentDueDate.toISOString() : null}
                    plan={a.plan}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-ink">Extrato — {month}</p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Conta</Th>
              <Th>Forma</Th>
              <Th>Cobre até</Th>
              <Th>Valor</Th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-b border-slate-100 px-5 py-8 text-center text-slate-400">
                  Nenhum pagamento neste período.
                </td>
              </tr>
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <Td className="whitespace-nowrap text-slate-500">{formatDateTime(p.paidAt)}</Td>
                  <Td>
                    <div className="font-semibold text-ink">{p.accountName}</div>
                    <div className="text-xs text-slate-400">{p.accountEmail}</div>
                  </Td>
                  <Td className="text-slate-600">{p.method ? METHOD_LABELS[p.method] : "—"}</Td>
                  <Td className="whitespace-nowrap text-slate-500">
                    {p.coversUntil ? formatDateTime(p.coversUntil) : "—"}
                  </Td>
                  <Td className="whitespace-nowrap font-semibold text-ink">{formatCentsBRL(p.amountCents)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
