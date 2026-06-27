// src/components/app/SeatsDropdown.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Crown, User } from "lucide-react";

type Role = "ADMIN" | "OPERADOR";

export interface Seat {
  id: string;
  name: string;
  email: string;
  role: Role;
  isOwner: boolean;
}

/**
 * Dropdown da coluna "Usuários" no Financeiro. Mostra `usados/máximo` (ou só
 * `usados`) e, ao abrir, lista os assentos da conta: o dono (ADMIN) primeiro,
 * depois os operadores. Renderizado em posição FIXA ancorada no botão para não
 * ser cortado pelo `overflow-hidden` do Card.
 */
export function SeatsDropdown({
  seatsUsed,
  maxSeats,
  seats,
}: {
  seatsUsed: number;
  maxSeats: number | null;
  seats: Seat[];
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Largura do painel (clamp p/ caber em telas estreitas) + margem da borda.
      const margin = 8;
      const panelW = Math.min(256, window.innerWidth - margin * 2);
      // Não deixa estourar a direita da viewport no celular.
      const left = Math.max(margin, Math.min(r.left, window.innerWidth - panelW - margin));
      setCoords({ top: r.bottom + 6, left });
    }
  }

  function toggle() {
    if (!open) place();
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // Fecha ao rolar/redimensionar (o painel é fixo e perderia o ancoramento).
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", (e) => e.key === "Escape" && close());
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const label = maxSeats != null ? `${seatsUsed}/${maxSeats}` : `${seatsUsed}`;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        {label}
        <ChevronDown
          size={14}
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && coords && (
        <>
          {/* Backdrop invisível: clique fora fecha. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 w-64 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
            style={{ top: coords.top, left: coords.left }}
          >
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Usuários da conta ({seats.length})
              </p>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {seats.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      s.isOwner
                        ? "bg-[#EAF0FE] text-[#2C5BD6]"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {s.isOwner ? <Crown size={14} /> : <User size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">
                      {s.name}
                    </div>
                    <div className="truncate text-xs text-slate-400">{s.email}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      s.isOwner
                        ? "bg-[#EAF0FE] text-[#2C5BD6]"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {s.isOwner ? "admin" : "operador"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
