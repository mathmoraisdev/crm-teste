import { Lock } from "lucide-react";
import { getTenantContext } from "@/lib/tenant";
import { listAudit } from "@/server/services/audit.service";
import { Card } from "@/components/ui/Card";
import { AuditTable } from "@/components/app/AuditTable";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const ctx = await getTenantContext();

  if (!ctx || ctx.role !== "ADMIN") {
    return (
      <div className="space-y-5">
        <h1 className="font-display text-2xl sm:text-[30px] font-bold tracking-[-0.025em] text-ink">
          Auditoria
        </h1>
        <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Lock size={20} />
          </span>
          <p className="text-sm font-bold text-ink">Acesso restrito</p>
          <p className="max-w-sm text-sm text-slate-500">
            Apenas o administrador da conta consulta o log de auditoria.
          </p>
        </Card>
      </div>
    );
  }

  const first = await listAudit(ctx.tenantUserId, {});
  const items = first.items.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName,
    action: r.action,
    entityType: r.entityType,
    summary: r.summary,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl sm:text-[30px] font-bold tracking-[-0.025em] text-ink">
          Auditoria
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Registro imutável das ações sensíveis — quem fez, o quê e quando. Visível só
          para o administrador da conta.
        </p>
      </div>

      <AuditTable initialItems={items} initialCursor={first.nextCursor} />
    </div>
  );
}
