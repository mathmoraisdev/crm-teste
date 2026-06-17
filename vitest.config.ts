import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Config mínima do vitest. O único motivo de existir é resolver o alias `@/`
 * (espelha o tsconfig `paths`) para que testes possam importar/mockar serviços
 * que usam `@/server/...` e `@/lib/...`. Os testes de lógica pura não dependem
 * disto, mas os que mockam Prisma/env sim.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
