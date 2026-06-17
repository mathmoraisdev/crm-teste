import type { LeadStatus } from "@prisma/client";
import { Badge } from "@/components/ui/Badge";
import { LEAD_STATUS_META } from "@/lib/leadStatus";

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const meta = LEAD_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
