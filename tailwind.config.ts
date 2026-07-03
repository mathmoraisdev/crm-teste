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
        // Neutros do design (verde-acinzentado) sobrepondo o slate padrão.
        slate: {
          50: "#F4F7F5",
          100: "#EDF2EF",
          200: "#E2EAE6",
          300: "#D5DFDA",
          400: "#94A39B",
          500: "#6B7A73",
          600: "#46544D",
          700: "#34433B",
          800: "#1A2A23",
          900: "#0A1B14",
          950: "#050D09",
        },
        // Tokens semânticos auxiliares.
        forest: "#0A1B14",
        ink: "#0A1410",
        mint: "#5FE3A1",
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
