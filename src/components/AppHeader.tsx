"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Users, Megaphone, Bot, LogOut } from "lucide-react";

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  // Sem cabeçalho na tela de login.
  if (pathname === "/login") return null;

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignora — segue para o login de qualquer forma
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/leads" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white">
            <Bot size={18} />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Prospecta<span className="text-brand-600">IA</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/leads"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Users size={16} /> Leads
          </Link>
          <Link
            href="/campaigns"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <Megaphone size={16} /> Campanhas
          </Link>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="ml-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
            title="Sair"
          >
            <LogOut size={16} /> Sair
          </button>
        </nav>
      </div>
    </header>
  );
}
