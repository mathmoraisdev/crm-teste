import { Badge } from "@/components/ui/Badge";
import { scoreTone } from "@/lib/leadStatus";

export function ScoreBadge({ score }: { score: number }) {
  return (
    <Badge tone={scoreTone(score)}>
      <span className="tabular-nums">{score}</span>
    </Badge>
  );
}
