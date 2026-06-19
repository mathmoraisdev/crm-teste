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
        // Verde da marca (claro → escuro).
        brand: {
          50: "#E7F6EE",
          100: "#C8EAD7",
          200: "#A6DCC0",
          300: "#5FE3A1", // acento brilhante sobre fundo escuro
          400: "#10B981",
          500: "#0EA46B", // primário
          600: "#0B8C5A",
          700: "#0B7D52",
          800: "#067A52",
          900: "#0A3D29",
          950: "#0A1B14", // "forest" — sidebar / painéis escuros
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
