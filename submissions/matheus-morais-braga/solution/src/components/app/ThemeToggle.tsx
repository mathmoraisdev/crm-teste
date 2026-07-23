"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Alterna claro/escuro setando `data-theme` no <html> e persistindo em
 * localStorage. O tema inicial já é aplicado pelo script no-flash do layout;
 * aqui só sincronizamos o rótulo do botão após a montagem.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    setTheme(current);
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignora storage indisponível */
    }
    setTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/5 hover:text-white"
    >
      {/* Antes de montar mostra o ícone do tema claro (default do SSR) p/ evitar mismatch. */}
      {mounted && isDark ? <Sun size={17} /> : <Moon size={17} />}
      <span>{mounted && isDark ? "Tema claro" : "Tema escuro"}</span>
    </button>
  );
}
