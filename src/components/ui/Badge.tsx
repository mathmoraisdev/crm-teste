import { cn } from "@/lib/utils";

type Tone =
  | "slate"
  | "blue"
  | "amber"
  | "green"
  | "red"
  | "violet"
  | "emerald";

const tones: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-info-surface text-info",
  amber: "bg-warning-surface text-warning",
  green: "bg-brand-50 text-brand-700",
  red: "bg-danger-surface text-danger",
  violet: "bg-accent-surface text-accent",
  emerald: "bg-brand-100 text-brand-800",
};

export function Badge({
  tone = "slate",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type { Tone };
