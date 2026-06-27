"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { ConsultantModal } from "@/components/ConsultantModal";

export interface PricingPlan {
  name: string;
  desc: string;
  priceMonthly: number; // valor mensal em reais (cheio)
  cta: string;
  selfServe?: boolean;
  featured?: boolean;
  features: string[];
}

const fmt = (n: number) => `R$${n.toLocaleString("pt-BR")}`;

// Anual = mensal × 10 (paga 10, leva 12). Exibe o total/ano e o equivalente/mês.
function priceLabel(monthly: number, period: "mensal" | "anual") {
  if (period === "mensal") return { big: fmt(monthly), suffix: "/mês", hint: null as string | null };
  const yearly = monthly * 10;
  return { big: fmt(yearly), suffix: "/ano", hint: `equivale a ${fmt(Math.round(yearly / 12))}/mês` };
}

export function PricingPlans({ plans }: { plans: PricingPlan[] }) {
  const [period, setPeriod] = useState<"mensal" | "anual">("mensal");

  return (
    <>
      {/* TOGGLE Mensal / Anual */}
      <div className="mb-8 flex items-center justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-[#E0E7E3] bg-white p-1">
          {(["mensal", "anual"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={
                period === p
                  ? "rounded-full bg-forest px-4 py-1.5 text-[13.5px] font-bold text-white transition-colors"
                  : "rounded-full px-4 py-1.5 text-[13.5px] font-semibold text-slate-500 transition-colors hover:text-ink"
              }
            >
              {p === "mensal" ? "Mensal" : "Anual"}
              {p === "anual" && (
                <span
                  className={
                    period === "anual"
                      ? "ml-2 rounded-full bg-mint px-2 py-0.5 font-mono text-[10px] font-extrabold text-forest"
                      : "ml-2 rounded-full bg-brand-50 px-2 py-0.5 font-mono text-[10px] font-extrabold text-brand-700"
                  }
                >
                  -2 meses
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-stretch gap-5 md:grid-cols-3">
        {plans.map((p) => {
          const price = priceLabel(p.priceMonthly, period);
          return (
            <div
              key={p.name}
              className={
                p.featured
                  ? "relative flex flex-col overflow-hidden rounded-[20px] border border-forest bg-forest p-8 shadow-[0_30px_60px_-24px_rgba(10,27,20,.5)]"
                  : "flex flex-col rounded-[20px] border border-[#EBEFEC] bg-white p-8"
              }
            >
              {p.featured && (
                <span className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(95,227,161,.22),transparent_70%)]" />
              )}
              <div className="relative flex items-center justify-between">
                <div className={`text-base font-extrabold ${p.featured ? "text-white" : ""}`}>{p.name}</div>
                {p.featured && (
                  <span className="rounded-full bg-mint px-2.5 py-1 font-mono text-[11px] font-extrabold tracking-[0.04em] text-forest">
                    MAIS POPULAR
                  </span>
                )}
              </div>
              <p className={`relative mt-1.5 text-[13.5px] ${p.featured ? "text-[#9FBCAF]" : "text-slate-500"}`}>{p.desc}</p>
              <div className="relative mt-5 flex items-end gap-1">
                <span className={`font-display text-[46px] font-bold leading-none tracking-[-0.03em] ${p.featured ? "text-white" : ""}`}>{price.big}</span>
                <span className={`mb-1.5 text-sm font-semibold ${p.featured ? "text-[#9FBCAF]" : "text-slate-500"}`}>{price.suffix}</span>
              </div>
              {price.hint && (
                <p className={`relative mt-1 text-xs font-semibold ${p.featured ? "text-[#9FBCAF]" : "text-slate-400"}`}>{price.hint}</p>
              )}
              {p.selfServe ? (
                <Link
                  href="/signup"
                  className={
                    p.featured
                      ? "relative mt-6 block rounded-xl bg-brand-500 py-3.5 text-center text-[15px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.7)] transition-colors hover:bg-brand-400"
                      : "relative mt-6 block rounded-xl border border-[#E0E7E3] bg-[#F1F5F3] py-3.5 text-center text-[15px] font-bold text-ink transition-colors hover:border-brand-100 hover:bg-brand-50"
                  }
                >
                  {p.cta}
                </Link>
              ) : (
                <ConsultantModal
                  plan={p.name}
                  trigger={
                    <button
                      type="button"
                      className={
                        p.featured
                          ? "relative mt-6 rounded-xl bg-brand-500 py-3.5 text-center text-[15px] font-bold text-white shadow-[0_12px_26px_-10px_rgba(14,164,107,.7)] transition-colors hover:bg-brand-400"
                          : "relative mt-6 rounded-xl border border-[#E0E7E3] bg-[#F1F5F3] py-3.5 text-center text-[15px] font-bold text-ink transition-colors hover:border-brand-100 hover:bg-brand-50"
                      }
                    >
                      {p.cta}
                    </button>
                  }
                />
              )}
              <div className={`relative my-6 h-px ${p.featured ? "bg-[#1E3A2C]" : "bg-[#F0F3F1]"}`} />
              <div className="relative flex flex-col gap-3">
                {p.features.map((f) => (
                  <div key={f} className={`flex gap-2.5 text-sm ${p.featured ? "text-[#E8F3ED]" : "text-[#1A2A23]"}`}>
                    <Check size={17} className={p.featured ? "shrink-0 text-mint" : "shrink-0 text-brand-500"} /> {f}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
