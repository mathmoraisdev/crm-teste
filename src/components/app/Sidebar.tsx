"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Users, Megaphone, Smartphone, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/app/Logo";

const NAV = [
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/campaigns", label: "Campanhas", icon: Megaphone },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // segue para o login de qualquer forma
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-screen w-60 flex-none flex-col bg-forest p-4">
      <Link href="/leads" className="px-2 pb-5 pt-1.5">
        <Logo dark />
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                active
                  ? "bg-brand-300/12 text-white"
                  : "text-[#8FB6A5] hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon size={17} className={active ? "text-mint" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        <Link
          href="/campaigns"
          className="rounded-2xl border border-white/[.07] bg-white/[.04] p-3.5 transition-colors hover:bg-white/[.07]"
        >
          <span className="flex items-center gap-2 text-[12.5px] font-bold text-white">
            <Smartphone size={14} className="text-mint" /> Números WhatsApp
          </span>
          <span className="mt-1 block font-mono text-[11.5px] text-[#8FB6A5]">
            Conectar &amp; gerenciar chips
          </span>
        </Link>

        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#8FB6A5] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
        >
          <LogOut size={17} /> Sair
        </button>
      </div>
    </aside>
  );
}
