import type { Config } from "tailwindcss";

/**
 * Design system "Disparador.ai" — verde sóbrio sobre neutros levemente esverdeados.
 *
 * Estratégia: remapeamos a escala `slate` (usada por todo o app) para os neutros
 * verde-acinzentados do design e a escala `brand` para o verde da marca. Assim a
 * maior parte das telas herda o visual novo sem reescrever cada classe.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Variante `dark:` alinhada ao MESMO seletor das CSS vars (data-theme no <html>).
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Verde da marca — agora TEMÁVEL por conta via variáveis CSS.
        // Os valores das vars vivem em src/lib/theme/palette.ts e são injetados
        // por conta no layout do app (fallback = DEFAULT_PALETTE no globals.css).
        brand: {
          50: "rgb(var(--brand-50) / <alpha-value>)",
          100: "rgb(var(--brand-100) / <alpha-value>)",
          200: "rgb(var(--brand-200) / <alpha-value>)",
          300: "rgb(var(--brand-300) / <alpha-value>)",
          400: "rgb(var(--brand-400) / <alpha-value>)",
          500: "rgb(var(--brand-500) / <alpha-value>)",
          600: "rgb(var(--brand-600) / <alpha-value>)",
          700: "rgb(var(--brand-700) / <alpha-value>)",
          800: "rgb(var(--brand-800) / <alpha-value>)",
          900: "rgb(var(--brand-900) / <alpha-value>)",
          950: "rgb(var(--brand-950) / <alpha-value>)",
        },
        // Neutros do design (verde-acinzentado) — agora TEMÁVEIS via CSS vars.
        // Os valores (claro/escuro) vivem em src/app/globals.css.
        slate: {
          50: "rgb(var(--slate-50) / <alpha-value>)",
          100: "rgb(var(--slate-100) / <alpha-value>)",
          200: "rgb(var(--slate-200) / <alpha-value>)",
          300: "rgb(var(--slate-300) / <alpha-value>)",
          400: "rgb(var(--slate-400) / <alpha-value>)",
          500: "rgb(var(--slate-500) / <alpha-value>)",
          600: "rgb(var(--slate-600) / <alpha-value>)",
          700: "rgb(var(--slate-700) / <alpha-value>)",
          800: "rgb(var(--slate-800) / <alpha-value>)",
          900: "rgb(var(--slate-900) / <alpha-value>)",
          950: "rgb(var(--slate-950) / <alpha-value>)",
        },
        // Tokens semânticos auxiliares.
        forest: "rgb(var(--brand-950))",
        ink: "rgb(var(--ink) / <alpha-value>)",
        mint: "rgb(var(--brand-300))",
        // Tokens semânticos de superfície/borda (respondem ao tema via var).
        surface: "rgb(var(--surface-app) / <alpha-value>)",
        card: "rgb(var(--surface-card) / <alpha-value>)",
        raised: "rgb(var(--surface-raised) / <alpha-value>)",
        inset: "rgb(var(--surface-inset) / <alpha-value>)",
        line: "rgb(var(--border-subtle) / <alpha-value>)",
        "line-default": "rgb(var(--border-default) / <alpha-value>)",
        "line-strong": "rgb(var(--border-strong) / <alpha-value>)",
        // Status semânticos (claro/escuro via var).
        danger: "rgb(var(--danger) / <alpha-value>)",
        "danger-surface": "rgb(var(--danger-surface) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-surface": "rgb(var(--warning-surface) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        "info-surface": "rgb(var(--info-surface) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        "success-surface": "rgb(var(--success-surface) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-surface": "rgb(var(--accent-surface) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-display)", "Bricolage Grotesque", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "Manrope", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "DM Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-9px)" },
        },
        pulsedot: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: ".45", transform: "scale(.82)" },
        },
      },
      animation: {
        floaty: "floaty 4.5s ease-in-out infinite",
        pulsedot: "pulsedot 1.8s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
