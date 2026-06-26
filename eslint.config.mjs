import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "prisma/generated/**",
      "docs/**", // material de design/referência, não é código da aplicação
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    // Código de servidor não tem componentes/hooks React. A regra dispara um
    // falso positivo com APIs do Baileys nomeadas `useX` (useMultiFileAuthState,
    // useDbAuthState), que não são React Hooks.
    files: ["src/server/**/*.{ts,tsx}"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];

export default eslintConfig;
