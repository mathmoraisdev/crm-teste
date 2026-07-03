"use client";

import { useId } from "react";
import type { ActivityPoint } from "@/server/services/dashboard.service";

// Duas séries do gráfico de atividade. Azul = recebidas, verde de marca = IA.
const RECEIVED_COLOR = "#2C5BD6";
const AI_COLOR = "#0EA46B";

/** "YYYY-MM-DD" → "DD/MM" (sem depender de fuso). */
function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Gráfico de tendência (área) recebidas × respondidas pela IA, em SVG inline —
 * sem dependência e CSP-safe. `preserveAspectRatio="none"` estica p/ a largura;
 * os traços usam `vector-effect` p/ não distorcer. Rótulos/legenda ficam em HTML
 * em volta (não distorcem).
 */
export function TrendChart({ data }: { data: ActivityPoint[] }) {
  const gid = useId().replace(/:/g, "");
  const W = 720;
  const H = 200;
  const padX = 6;
  const padTop = 12;
  const padBottom = 8;
  const n = data.length;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const maxY = Math.max(1, ...data.map((d) => Math.max(d.received, d.aiReplied)));
  const hasData = data.some((d) => d.received > 0 || d.aiReplied > 0);

  const x = (i: number) => (n <= 1 ? padX + innerW / 2 : padX + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / maxY) * innerH;
  const baseline = padTop + innerH;

  const line = (key: "received" | "aiReplied") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key: "received" | "aiReplied") =>
    `${line(key)} L${x(n - 1).toFixed(1)},${baseline} L${x(0).toFixed(1)},${baseline} Z`;

  const labelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div>
      {/* Legenda + pico do período */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: RECEIVED_COLOR }} /> Recebidas
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: AI_COLOR }} /> Respondidas pela IA
        </span>
        <span className="ml-auto text-slate-400">pico {maxY}/dia</span>
      </div>

      <div className="px-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`rc-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RECEIVED_COLOR} stopOpacity="0.18" />
              <stop offset="100%" stopColor={RECEIVED_COLOR} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`ai-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={AI_COLOR} stopOpacity="0.22" />
              <stop offset="100%" stopColor={AI_COLOR} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Linhas de grade horizontais */}
          {[0.25, 0.5, 0.75].map((t) => (
            <line
              key={t}
              x1={padX}
              x2={W - padX}
              y1={padTop + innerH * t}
              y2={padTop + innerH * t}
              stroke="#EEF1F0"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hasData && (
            <>
              <path d={area("received")} fill={`url(#rc-${gid})`} />
              <path d={area("aiReplied")} fill={`url(#ai-${gid})`} />
              <path
                d={line("received")}
                fill="none"
                stroke={RECEIVED_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={line("aiReplied")}
                fill="none"
                stroke={AI_COLOR}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
      </div>

      {/* Rótulos do eixo X (HTML, não distorcem) */}
      <div className="flex justify-between px-4 pb-3 pt-1 text-[11px] font-medium text-slate-400">
        {labelIdx.map((i) => (
          <span key={i}>{data[i] ? ddmm(data[i].day) : ""}</span>
        ))}
      </div>

      {!hasData && (
        <p className="pb-4 text-center text-xs text-slate-400">Sem atividade no período.</p>
      )}
    </div>
  );
}
