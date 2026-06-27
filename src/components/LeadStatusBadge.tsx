import type { LeadStatus } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";
import { LEAD_STATUS_META } from "@/lib/leadStatus";

/** `label` sobrescreve o rótulo padrão (rótulos renomeados por conta). */
export function LeadStatusBadge({
  status,
  label,
}: {
  status: LeadStatus;
  label?: string;
}) {
  const meta = LEAD_STATUS_META[status];
  return <Badge tone={meta.tone}>{label ?? meta.label}</Badge>;
}
