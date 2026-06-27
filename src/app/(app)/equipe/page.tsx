import { Lock } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { listMembers } from "@/server/services/team.service";
import { prisma } from "@/server/db/client";
import { PLAN_LIMITS, planLabel } from "@/lib/plans";
import { Card } from "@/components/ui/Card";
import { TeamManager } from "@/components/app/TeamManager";

export const dynamic = "force-dynamic";

export default async function EquipePage() {
  const ctx = await getTenantContext();

  if (!ctx || ctx.role !== "ADMIN") {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Equipe
        </h1>
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={20} />
          </span>
          <p className="text-sm font-bold text-ink">Acesso restrito</p>
          <p className="max-w-sm text-sm text-slate-500">
            Apenas o administrador da conta gerencia a equipe.
          </p>
        </Card>
      </div>
    );
  }

  const [owner, members] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ctx.tenantUserId },
      select: { name: true, email: true, plan: true },
    }),
    listMembers(ctx.tenantUserId),
  ]);

  const plan = owner?.plan ?? null;
  const maxSeats = plan ? PLAN_LIMITS[plan].maxSeats : null;
  const seatsUsed = 1 + members.length; // dono + operadores

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.025em] text-ink">
          Equipe
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Adicione operadores que compartilham o mesmo CRM (leads, conversas e
          números). Eles não acessam equipe, números nem financeiro.
        </p>
      </div>

      <TeamManager
        owner={{ name: owner?.name ?? "—", email: owner?.email ?? "" }}
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          createdAt: m.createdAt.toISOString(),
        }))}
        plan={plan}
        planLabel={planLabel(plan)}
        seatsUsed={seatsUsed}
        maxSeats={maxSeats}
      />
    </div>
  );
}
