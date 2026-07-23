import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Superfície temável + elevação suave em camadas. No dark a sombra é
        // quase nula — a elevação vem da cor da superfície (bg-card > bg-surface).
        "rounded-2xl border border-line bg-card",
        "shadow-[0_1px_2px_rgba(10,20,16,.04),0_8px_24px_-16px_rgba(10,20,16,.10)]",
        "dark:shadow-[0_1px_2px_rgba(0,0,0,.25)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
