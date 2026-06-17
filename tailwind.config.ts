import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta do app — tons sóbrios para um CRM "apresentável"
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#3b6fe0",
          600: "#2f59c4",
          700: "#264aa3",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
