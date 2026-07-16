# Branding multivertical (tema por conta) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permitir que cada conta vista o CRM com a cara do seu negócio — cor da marca (accent), logo e nome do app — escolhendo entre presets prontos por tipo de negócio, sem alterar layout nem duplicar funcionalidades.

**Architecture:** As cores da marca hoje são hex fixos no `tailwind.config.ts` (compile-time). Nós as convertemos para **variáveis CSS** (`rgb(var(--brand-N) / <alpha-value>)`), injetadas por conta via um `<style>` server-rendered no layout do app. Assim os **190 usos de `brand-*` em 47 arquivos continuam intactos** — só a *definição* da cor passa a ser dinâmica. O tema mora numa tabela nova `AccountBranding` ligada ao **dono da conta** (`tenantUserId`), com fallback para a paleta verde atual quando não há branding. Presets são conteúdo versionado em código, com `id` casado à taxonomia `BusinessCategory` que já existe nos templates de IA.

**Tech Stack:** Next.js (App Router, RSC) · Prisma + Postgres · TailwindCSS · Supabase Storage (logo) · Vitest (testes co-locados `*.test.ts`).

**Escopo (o que NÃO entra):** color-picker livre (só presets em v1), tema na landing pública, domínio próprio. Neutros (`slate`) permanecem fixos — só o accent `brand` é temável.

---

## ⚠️ DECISÃO DE ESCOPO A TOMAR ANTES (sidebar / chrome escuro)

A verificação do código revelou que a **sidebar** (a superfície mais visível do app) NÃO é pintada por `brand-*`: ela usa `bg-forest` (`#0A1B14` fixo), textos em hex fixo (`#8FB6A5`, `#6E9587`), e `text-mint`/`bg-mint` (`mint = #5FE3A1` fixo, em `tailwind.config.ts`). Só o item ativo (`bg-brand-300/12`) é temável.

**Consequência:** se você só temar `brand` (escopo mínimo), ao aplicar um tema vermelho o app fica vermelho **mas a sidebar continua verde-escura**. Fica inconsistente justamente no lugar que mais aparece.

**Duas saídas (escolha na Fase 0):**
- **(A) Recomendada — temar também `forest` e `mint`:** mapear `forest → rgb(var(--brand-950))` e `mint → rgb(var(--brand-300))` no `tailwind.config.ts`, e trocar os hex fixos da sidebar (`#8FB6A5`/`#6E9587`) por classes com opacidade (ex.: `text-white/60`). Assim a sidebar re-tinge junto. Custo: +~1h, mexe em `Sidebar.tsx`. **Está incorporado como Task 0.5 abaixo.**
- **(B) Aceitar sidebar verde fixa na v1:** pula a Task 0.5. Mais rápido, mas o menu destoa do accent. Só faz sentido se a maioria dos presets for esverdeada.

O restante do plano vale para as duas opções.

---

## Convenções do projeto (leia antes de começar)

- **Testes:** Vitest. Arquivos co-locados: `foo.ts` → `foo.test.ts`. Rode um teste específico com `npx vitest run caminho/arquivo.test.ts`.
- **Schema:** dev usa `npx prisma db push` (ver comentário no topo de `prisma/schema.prisma`). **Produção** tem cutover pendente para `migrate deploy` — NÃO rode migrate em prod aqui; deixe a aplicação em prod como nota do dono.
- **Cor RGB nas vars:** o Tailwind com `rgb(var(--x) / <alpha-value>)` exige o valor da var em **canais separados por espaço**, ex.: `--brand-500: 14 164 107;` (não `#0EA46B`, não vírgulas).
- **Storage:** siga o padrão de `src/server/storage/media-storage.ts` (client lazy com service_role, degrada para `null` sem config).
- **Tenancy:** o dono da conta é `ctx.tenantUserId` (via `getTenantContext()` em `src/lib/tenant.ts`). Branding é por dono, nunca por operador nem por número.
- **Commits frequentes** ao fim de cada task.

---

## Visão geral das fases

- **Fase 0** — Refactor `brand` → variáveis CSS, com paleta default idêntica à atual (zero mudança visual). Base de tudo.
- **Fase 1** — Camada de dados (`AccountBranding`) + injeção do tema por conta no layout + logo/appName no componente de marca.
- **Fase 2** — Presets por categoria + UI de configuração (escolher preset, subir logo, nome) + aplicar preset no onboarding junto com o template de IA.

Cada fase é entregável e reversível de forma independente.

---

# FASE 0 — Cores como variáveis CSS (fundação)

Objetivo: trocar a *definição* das cores `brand-*` de hex fixo para variável CSS, mantendo o visual **idêntico**. Nenhuma tela deve mudar de aparência ao fim da fase.

## Task 0.1: Modelo da paleta + paleta default (com teste)

**Files:**
- Create: `src/lib/theme/palette.ts`
- Test: `src/lib/theme/palette.test.ts`

**Step 1: Escrever o teste que falha**

```ts
// src/lib/theme/palette.test.ts
import { describe, it, expect } from "vitest";
import { DEFAULT_PALETTE, paletteToCssVars, BRAND_STOPS } from "./palette";

describe("paleta de marca", () => {
  it("tem exatamente as 11 paradas do Tailwind", () => {
    expect(Object.keys(DEFAULT_PALETTE)).toEqual(BRAND_STOPS.map(String));
  });

  it("cada parada é 'R G B' com canais 0–255", () => {
    for (const v of Object.values(DEFAULT_PALETTE)) {
      const parts = v.split(" ").map(Number);
      expect(parts).toHaveLength(3);
      for (const c of parts) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(255);
    }
  });

  it("gera as linhas CSS de variáveis a partir da paleta", () => {
    const css = paletteToCssVars(DEFAULT_PALETTE);
    expect(css).toContain("--brand-500: 14 164 107;");
    expect(css).toContain("--brand-950: 10 27 20;");
  });

  it("o default 500 corresponde ao verde primário atual (#0EA46B)", () => {
    expect(DEFAULT_PALETTE["500"]).toBe("14 164 107");
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/theme/palette.test.ts`
Expected: FAIL — "Cannot find module './palette'".

**Step 3: Implementar o mínimo**

Converta os hex atuais do `tailwind.config.ts` para canais RGB. Referência (hex → "R G B"):
`50 #E7F6EE→231 246 238` · `100 #C8EAD7→200 234 215` · `200 #A6DCC0→166 220 192` · `300 #5FE3A1→95 227 161` · `400 #10B981→16 185 129` · `500 #0EA46B→14 164 107` · `600 #0B8C5A→11 140 90` · `700 #0B7D52→11 125 82` · `800 #067A52→6 122 82` · `900 #0A3D29→10 61 41` · `950 #0A1B14→10 27 20`.

```ts
// src/lib/theme/palette.ts
/**
 * Paleta da marca como CANAIS RGB separados por espaço ("R G B"), no formato que
 * o Tailwind espera em `rgb(var(--brand-N) / <alpha-value>)`. É a fonte única das
 * cores temáveis por conta. O default reproduz EXATAMENTE o verde Disparador.ai —
 * sem branding, o app fica visualmente idêntico.
 */

export const BRAND_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type BrandStop = (typeof BRAND_STOPS)[number];

/** Chave = parada (string), valor = "R G B". */
export type BrandPalette = Record<`${BrandStop}`, string>;

export const DEFAULT_PALETTE: BrandPalette = {
  "50": "231 246 238",
  "100": "200 234 215",
  "200": "166 220 192",
  "300": "95 227 161",
  "400": "16 185 129",
  "500": "14 164 107",
  "600": "11 140 90",
  "700": "11 125 82",
  "800": "6 122 82",
  "900": "10 61 41",
  "950": "10 27 20",
};

/** Linhas `--brand-N: R G B;` para injetar num bloco `:root{...}`. */
export function paletteToCssVars(p: BrandPalette): string {
  return BRAND_STOPS.map((s) => `--brand-${s}: ${p[`${s}`]};`).join("");
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/theme/palette.test.ts`
Expected: PASS (4 testes).

**Step 5: Commit**

```bash
git add src/lib/theme/palette.ts src/lib/theme/palette.test.ts
git commit -m "feat(theme): paleta de marca como canais RGB + default idêntico ao verde atual"
```

---

## Task 0.2: Tailwind lê a paleta via variáveis CSS

**Files:**
- Modify: `tailwind.config.ts:16-28` (bloco `brand`)

**Step 1: Trocar os hex do `brand` por `rgb(var(...))`**

Substitua o objeto `brand: { ... }` por:

```ts
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
```

**Nota:** NÃO toque em `slate`, `forest`, `ink`, `mint` — neutros permanecem fixos nesta versão. `mint` (#5FE3A1) segue hex; se quiser, numa v2 ele vira `var(--brand-300)`.

**Step 2: (ainda vai quebrar o visual — falta injetar as vars, na próxima task)**

Não valide visualmente ainda. Só confira que o build de tipos não quebrou:
Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados ao config.

**Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "refactor(theme): brand scale lê variáveis CSS em vez de hex fixo"
```

---

## Task 0.3: Injetar a paleta default em `:root` (restaura o visual)

**Files:**
- Modify: `src/app/globals.css:1-13`

**Step 1: Adicionar o bloco `:root` com as vars default e trocar cores hardcoded de brand**

Logo após `@tailwind utilities;`, adicione o `:root` com a paleta default (mesmos valores de `DEFAULT_PALETTE`). Mantido em CSS estático para ser o **fallback** quando não há branding (ou fora do app, ex.: login, landing).

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Paleta de marca default (verde Disparador.ai). Espelha DEFAULT_PALETTE em
   src/lib/theme/palette.ts. O layout do app SOBRESCREVE estas vars por conta. */
:root {
  --brand-50: 231 246 238;
  --brand-100: 200 234 215;
  --brand-200: 166 220 192;
  --brand-300: 95 227 161;
  --brand-400: 16 185 129;
  --brand-500: 14 164 107;
  --brand-600: 11 140 90;
  --brand-700: 11 125 82;
  --brand-800: 6 122 82;
  --brand-900: 10 61 41;
  --brand-950: 10 27 20;
}

html,
body {
  @apply bg-slate-50 text-ink antialiased;
}

::selection {
  background: rgb(var(--brand-500));
  color: #fff;
}
```

**Step 2: Trocar a cor fixa no `.scroll-tabs`**

O `theme("colors.brand.500")` agora resolve para a string com `<alpha-value>` (inválida em `scrollbar-color`). Troque a regra existente:

```css
.scroll-tabs {
  scrollbar-width: thin;
  scrollbar-color: rgb(var(--brand-500)) theme("colors.slate.100");
}
```

(O `bg-brand-500` no `::-webkit-scrollbar-thumb` continua funcionando — é classe utilitária, não `theme()`.)

**Step 3: Validar paridade visual**

Run: `npm run dev` e abra o app (dashboard, inbox, kanban, agenda).
Expected: **visual idêntico** ao de antes — mesmo verde em botões, badges, sidebar (`brand-950`), scrollbars e seleção de texto. Se algo ficou preto/transparente, alguma var não foi definida — confira as 11 paradas.

**Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): injeta paleta default em :root e restaura paridade visual"
```

---

## Task 0.5: (opção A) Temar o chrome escuro da sidebar

Pule esta task se escolheu a opção (B) na decisão de escopo. Faça-a para que a sidebar re-tinja com o accent.

**Files:**
- Modify: `tailwind.config.ts` (tokens `forest` e `mint`)
- Modify: `src/components/app/Sidebar.tsx` (hex fixos → classes com opacidade)

**Step 1: `forest` e `mint` viram variáveis**

No `tailwind.config.ts`, troque os tokens semânticos:

```ts
        forest: "rgb(var(--brand-950))",
        ink: "#0A1410",
        mint: "rgb(var(--brand-300))",
```

(`ink` continua fixo — é o texto quase-preto sobre fundo claro, não é marca.)

**Step 2: Trocar os hex fixos da sidebar por opacidade branca**

Em `Sidebar.tsx`, os textos muted usam `#8FB6A5` e `#6E9587` (verdes fixos que destoam de um tema não-verde). Troque por brancos com opacidade, que ficam bem sobre qualquer `forest`:
- `text-[#8FB6A5]` → `text-white/70`
- `text-[#6E9587]` (label de grupo) → `text-white/45`
- `text-[#6E9587]` no card do rodapé idem.

Mantenha `bg-forest`, `text-mint`, `bg-mint`, `bg-brand-300/12` — agora todos derivam das vars.

**Step 3: Verificar**

Run: `npm run dev` com uma `brandScale` de teste vermelha (ver Task 1.3, que injeta o override).
Expected: sidebar fica **vinho/vermelho-escura** (forest = brand-950 vermelho), ícone ativo e badge em tom claro do tema (mint = brand-300), textos legíveis. Sem branding, permanece o verde atual (as vars default reproduzem os hex antigos).

**Step 4: Commit**

```bash
git add tailwind.config.ts src/components/app/Sidebar.tsx
git commit -m "feat(theme): sidebar re-tinge com o accent (forest/mint via vars)"
```

> Nota: as vars default de `--brand-950` (`10 27 20`) e `--brand-300` (`95 227 161`) já reproduzem exatamente `forest`/`mint` atuais — sem branding, zero mudança visual.

---

## Task 0.4: Snapshot de fim de fase (checagem manual)

**Checklist (sem código):**
- [ ] `npx vitest run` — verde.
- [ ] `npx tsc --noEmit` — sem erros novos.
- [ ] App visualmente idêntico ao `master` anterior.
- [ ] Grep de sanidade: `theme("colors.brand` não deve mais aparecer com `<alpha-value>` em contexto de valor puro. Run: usar Grep por `colors\.brand` em `src/**/*.css` e confirmar que só resta o caso do `.scroll-tabs` já ajustado.

Ao passar, a Fase 0 está fechada: cores viraram variáveis, mas nada mudou para o usuário. Pronto para tornar o tema dinâmico.

---

# FASE 1 — Dados do tema por conta + injeção dinâmica

Objetivo: guardar o tema por conta e injetá-lo no layout do app, sobrescrevendo o `:root` default. Sem UI ainda (setaremos via seed/DB nesta fase; a UI vem na Fase 2).

## Task 1.1: Modelo `AccountBranding` no schema

**Files:**
- Modify: `prisma/schema.prisma` (adicionar model + relação em `User`)

**Step 1: Adicionar o model** (após o model `AccountNotice`, por proximidade temática de "por conta"):

```prisma
// Identidade visual da conta (branding multivertical). 1:1 com o DONO da conta.
// Ausência = paleta default (verde). Só o accent `brand` é temável nesta versão.
model AccountBranding {
  id        String   @id @default(cuid())
  accountId String   @unique // User.id do dono (tenantUserId)
  account   User     @relation(fields: [accountId], references: [id], onDelete: Cascade)

  presetId    String? // id do preset aplicado (ex.: "beleza-rose"); null = default/custom
  brandScale  Json?   // BrandPalette { "50": "R G B", ... }; null = usa DEFAULT_PALETTE
  logoUrl     String? // URL pública do logo no Storage; null = logo padrão
  appName     String? // nome exibido no lugar de "Disparador.ai"; null = padrão

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**Step 2: Adicionar a relação inversa no `User`** (junto das outras relações, ex.: perto de `offers`/`sales`):

```prisma
  branding AccountBranding?
```

**Step 3: Aplicar no banco de dev**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." + client regenerado.
Run (se necessário): `npx prisma generate`

> **Produção:** deixar como nota do dono (cutover para `migrate deploy` pendente — ver memória `crm-inbox-db-push-pending`). Não aplicar aqui.

**Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(theme): model AccountBranding (tema/logo/nome por conta)"
```

---

## Task 1.2: Serviço de branding com resolução + fallback (com teste)

**Files:**
- Create: `src/server/services/branding.service.ts`
- Test: `src/server/services/branding.service.test.ts`

O serviço expõe `resolveBranding(row)`: dada a linha `AccountBranding | null`, devolve um objeto **sempre completo** (paleta + logo + appName) aplicando defaults. A leitura do DB fica numa função fina separada para o teste não precisar de banco.

**Step 1: Teste que falha (lógica pura de resolução)**

```ts
// src/server/services/branding.service.test.ts
import { describe, it, expect } from "vitest";
import { resolveBranding, DEFAULT_APP_NAME } from "./branding.service";
import { DEFAULT_PALETTE } from "@/lib/theme/palette";

describe("resolveBranding", () => {
  it("sem branding → tudo default", () => {
    const r = resolveBranding(null);
    expect(r.palette).toEqual(DEFAULT_PALETTE);
    expect(r.appName).toBe(DEFAULT_APP_NAME);
    expect(r.logoUrl).toBeNull();
  });

  it("brandScale válida sobrescreve a paleta", () => {
    const scale = { ...DEFAULT_PALETTE, "500": "220 38 38" };
    const r = resolveBranding({ brandScale: scale, appName: "Clínica X", logoUrl: "u", presetId: "x" } as never);
    expect(r.palette["500"]).toBe("220 38 38");
    expect(r.appName).toBe("Clínica X");
    expect(r.logoUrl).toBe("u");
  });

  it("brandScale inválida (parada faltando) cai no default — nunca renderiza cor quebrada", () => {
    const r = resolveBranding({ brandScale: { "500": "1 2 3" }, appName: null, logoUrl: null, presetId: null } as never);
    expect(r.palette).toEqual(DEFAULT_PALETTE);
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/server/services/branding.service.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar**

```ts
// src/server/services/branding.service.ts
import { prisma } from "@/server/db/client";
import { BRAND_STOPS, DEFAULT_PALETTE, type BrandPalette } from "@/lib/theme/palette";
import type { AccountBranding } from "@prisma/client";

export const DEFAULT_APP_NAME = "Disparador.ai";

export interface ResolvedBranding {
  palette: BrandPalette;
  appName: string;
  logoUrl: string | null;
  presetId: string | null; // p/ pré-selecionar o preset atual na UI
}

/** Valida que um JSON tem as 11 paradas com formato "R G B"; senão null. */
function asValidPalette(raw: unknown): BrandPalette | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as BrandPalette;
  for (const s of BRAND_STOPS) {
    const v = obj[`${s}`];
    if (typeof v !== "string" || v.split(" ").map(Number).filter((n) => n >= 0 && n <= 255).length !== 3) {
      return null;
    }
    out[`${s}`] = v;
  }
  return out;
}

/** Resolve a linha (ou null) num branding SEMPRE completo, com defaults seguros. */
export function resolveBranding(row: AccountBranding | null): ResolvedBranding {
  return {
    palette: asValidPalette(row?.brandScale) ?? DEFAULT_PALETTE,
    appName: row?.appName?.trim() || DEFAULT_APP_NAME,
    logoUrl: row?.logoUrl ?? null,
    presetId: row?.presetId ?? null,
  };
}

/** Lê o branding do dono da conta e resolve (com fallback). Barato: 1 query. */
export async function getBranding(tenantUserId: string): Promise<ResolvedBranding> {
  const row = await prisma.accountBranding.findUnique({ where: { accountId: tenantUserId } });
  return resolveBranding(row);
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/server/services/branding.service.test.ts`
Expected: PASS (3 testes).

**Step 5: Commit**

```bash
git add src/server/services/branding.service.ts src/server/services/branding.service.test.ts
git commit -m "feat(theme): branding.service com resolução e fallback seguro"
```

---

## Task 1.3: Componente que injeta o tema + uso no layout do app

**Files:**
- Create: `src/components/app/BrandingStyle.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Step 1: Server component que emite o `<style>` só se a paleta difere do default**

```tsx
// src/components/app/BrandingStyle.tsx
import { paletteToCssVars, DEFAULT_PALETTE, type BrandPalette } from "@/lib/theme/palette";

/**
 * Injeta a paleta da conta como override do :root. Server-rendered (sem flash).
 * Se a paleta é a default, não emite nada — o globals.css já cobre.
 */
export function BrandingStyle({ palette }: { palette: BrandPalette }) {
  if (palette === DEFAULT_PALETTE) return null;
  return <style dangerouslySetInnerHTML={{ __html: `:root{${paletteToCssVars(palette)}}` }} />;
}
```

**Step 2: Carregar o branding no layout e injetar**

Edite `src/app/(app)/layout.tsx`: carregue o branding do tenant em paralelo e renderize `<BrandingStyle>` no topo do `<div>`.

```tsx
import { Sidebar } from "@/components/app/Sidebar";
import { getCurrentUserId } from "@/lib/session";
import { getUserById } from "@/server/services/user.service";
import { isAdminEmail } from "@/lib/admin";
import { getTenantContext } from "@/lib/tenant";
import { getBranding } from "@/server/services/branding.service";
import { BrandingStyle } from "@/components/app/BrandingStyle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await getCurrentUserId();
  const ctx = await getTenantContext();
  const [user, branding] = await Promise.all([
    userId ? getUserById(userId) : null,
    ctx ? getBranding(ctx.tenantUserId) : null,
  ]);
  const isAdmin = isAdminEmail(user?.email);
  const isAccountAdmin = ctx?.role === "ADMIN";

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {branding && <BrandingStyle palette={branding.palette} />}
      <Sidebar isAdmin={isAdmin} isAccountAdmin={isAccountAdmin} />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 2xl:max-w-[1600px]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

**Step 3: Verificar end-to-end com um branding manual no banco**

Insira uma linha de teste (Prisma Studio ou SQL) para o SEU usuário dono, com uma `brandScale` vermelha:

```bash
npx prisma studio
# Na tabela AccountBranding: accountId = <seu tenantUserId>,
# brandScale = {"50":"254 242 242","100":"254 226 226","200":"254 202 202","300":"252 165 165","400":"248 113 113","500":"239 68 68","600":"220 38 38","700":"185 28 28","800":"153 27 27","900":"127 29 29","950":"69 10 10"}
```

Run: `npm run dev`, recarregue o app.
Expected: botões/sidebar/badges agora **vermelhos**; a landing/login (fora de `(app)`) seguem verdes (usam o `:root` default). Remova a linha de teste ao confirmar.

**Step 4: Commit**

```bash
git add src/components/app/BrandingStyle.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(theme): injeta paleta da conta no layout do app (override do :root)"
```

---

## Task 1.4: Logo/appName dinâmicos no componente de marca

**Files:**
- Modify: `src/components/app/Logo.tsx`
- Modify: `src/components/app/Sidebar.tsx` (passar logo/appName — confirmar onde `<Logo>` é usado)

**Step 1: Aceitar `logoUrl` e `appName` opcionais no `Logo`**

Estenda a assinatura de `Logo` sem quebrar chamadas atuais (props opcionais). Quando `logoUrl` existe, renderiza a imagem no lugar do `LogoMark`; quando `appName` existe, substitui o wordmark "Disparador.ai".

```tsx
export function Logo({
  className,
  dark = false,
  size = "md",
  logoUrl = null,
  appName = null,
}: {
  className?: string;
  dark?: boolean;
  size?: "sm" | "md" | "lg";
  logoUrl?: string | null;
  appName?: string | null;
}) {
  const mark = size === "lg" ? "h-[34px] w-[34px]" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  const text = size === "lg" ? "text-[21px]" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className={cn("overflow-hidden rounded-[11px] shadow-[0_6px_16px_-6px_rgba(14,164,107,.7)]", mark)}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={appName ?? "logo"} className="h-full w-full object-cover" />
        ) : (
          <LogoMark className="h-full w-full" />
        )}
      </span>
      <span className={cn("font-display font-bold tracking-[-0.02em]", text, dark ? "text-white" : "text-ink")}>
        {appName ? (
          appName
        ) : (
          <>Disparador<span className={dark ? "text-mint" : "text-brand-500"}>.ai</span></>
        )}
      </span>
    </span>
  );
}
```

**Step 2: Passar branding para o `<Logo>` na Sidebar**

A Sidebar (`src/components/app/Sidebar.tsx`) renderiza `<Logo dark />` em **dois** pontos: o header mobile (~linha 150) e o topo da sidebar desktop (~linha 180). Ajuste a assinatura de `Sidebar` para receber `branding?: { logoUrl: string | null; appName: string }` e repasse aos dois `<Logo dark logoUrl={branding?.logoUrl} appName={branding?.appName} />`. No `layout.tsx`, passe `branding={branding ? { logoUrl: branding.logoUrl, appName: branding.appName } : undefined}` ao `<Sidebar>`.

> `<Logo>` também aparece no login/landing (sem props) → seguem no default "Disparador.ai". Não altere essas telas.

**Step 3: Verificar**

Run: `npm run dev`. Com a linha de branding de teste (agora com `appName: "Clínica X"` e um `logoUrl` público qualquer), a Sidebar deve mostrar o novo nome/logo. Sem branding, "Disparador.ai" + avião.
Run: `npx tsc --noEmit` — sem erros.

**Step 4: Commit**

```bash
git add src/components/app/Logo.tsx src/components/app/Sidebar.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(theme): logo e nome do app por conta na sidebar"
```

Fim da Fase 1: tema/logo/nome já funcionam por conta — só falta a UI para o cliente configurar e os presets.

---

# FASE 2 — Presets por vertical + UI de configuração + onboarding

Objetivo: dar ao cliente uma tela para escolher um preset (paleta pronta), subir logo e definir o nome; e casar a escolha de "tipo de negócio" no onboarding com o template de IA que já existe.

## Task 2.1: Catálogo de presets casado às `BusinessCategory` (com teste)

**Files:**
- Create: `src/lib/theme/presets.ts`
- Test: `src/lib/theme/presets.test.ts`

Cada preset traz uma `BrandPalette` completa (11 paradas), um `label` e a `category` correspondente à taxonomia de `business-templates.ts`. 6–8 presets bem-acabados na v1.

**Step 1: Teste que falha**

```ts
// src/lib/theme/presets.test.ts
import { describe, it, expect } from "vitest";
import { THEME_PRESETS, presetById, presetForCategory } from "./presets";
import { BRAND_STOPS } from "./palette";

describe("presets de tema", () => {
  it("todo preset tem as 11 paradas em 'R G B'", () => {
    for (const p of THEME_PRESETS) {
      expect(Object.keys(p.palette).sort()).toEqual(BRAND_STOPS.map(String).sort());
      for (const v of Object.values(p.palette)) {
        expect(v.split(" ").map(Number)).toHaveLength(3);
      }
    }
  });

  it("ids são únicos", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("presetById encontra e presetForCategory cai num default se a categoria não tem preset dedicado", () => {
    expect(presetById(THEME_PRESETS[0].id)).toBe(THEME_PRESETS[0]);
    expect(presetById("nao-existe")).toBeNull();
    expect(presetForCategory("beleza")).not.toBeNull(); // deve haver preset p/ beleza
    expect(presetForCategory("outro")).not.toBeNull(); // sempre devolve algo (fallback)
  });
});
```

**Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/theme/presets.test.ts`
Expected: FAIL — módulo inexistente.

**Step 3: Implementar** (paletas de exemplo; ajuste os hexes ao gosto — o importante é a estrutura). Use um gerador manual: para cada preset, 11 tons do claro ao escuro do matiz.

```ts
// src/lib/theme/presets.ts
import type { BrandPalette } from "./palette";
import { DEFAULT_PALETTE } from "./palette";
import type { BusinessCategory } from "@/lib/business-templates";

export interface ThemePreset {
  id: string;
  label: string;
  /** Categoria de negócio associada (casada aos templates de IA). */
  category: BusinessCategory;
  palette: BrandPalette;
}

// Presets iniciais. Cada `palette` são 11 paradas "R G B" (claro→escuro).
export const THEME_PRESETS: ThemePreset[] = [
  { id: "verde-padrao", label: "Verde (padrão)", category: "outro", palette: DEFAULT_PALETTE },
  {
    id: "beleza-rose", label: "Rosé (beleza)", category: "beleza",
    palette: {
      "50": "253 242 248", "100": "252 231 243", "200": "251 207 232", "300": "249 168 212",
      "400": "244 114 182", "500": "236 72 153", "600": "219 39 119", "700": "190 24 93",
      "800": "157 23 77", "900": "131 24 67", "950": "80 7 36",
    },
  },
  {
    id: "saude-teal", label: "Teal (saúde)", category: "saude",
    palette: {
      "50": "240 253 250", "100": "204 251 241", "200": "153 246 228", "300": "94 234 212",
      "400": "45 212 191", "500": "20 184 166", "600": "13 148 136", "700": "15 118 110",
      "800": "17 94 89", "900": "19 78 74", "950": "4 47 46",
    },
  },
  {
    id: "automotivo-azul", label: "Azul (automotivo)", category: "automotivo",
    palette: {
      "50": "239 246 255", "100": "219 234 254", "200": "191 219 254", "300": "147 197 253",
      "400": "96 165 250", "500": "59 130 246", "600": "37 99 235", "700": "29 78 216",
      "800": "30 64 175", "900": "30 58 138", "950": "23 37 84",
    },
  },
  {
    id: "servicos-indigo", label: "Índigo (serviços)", category: "servicos-pro",
    palette: {
      "50": "238 242 255", "100": "224 231 255", "200": "199 210 254", "300": "165 180 252",
      "400": "129 140 248", "500": "99 102 241", "600": "79 70 229", "700": "67 56 202",
      "800": "55 48 163", "900": "49 46 129", "950": "30 27 75",
    },
  },
  {
    id: "alimentacao-ambar", label: "Âmbar (alimentação)", category: "alimentacao",
    palette: {
      "50": "255 251 235", "100": "254 243 199", "200": "253 230 138", "300": "252 211 77",
      "400": "251 191 36", "500": "245 158 11", "600": "217 119 6", "700": "180 83 9",
      "800": "146 64 14", "900": "120 53 15", "950": "69 26 3",
    },
  },
  {
    id: "fitness-laranja", label: "Laranja (fitness)", category: "fitness",
    palette: {
      "50": "255 247 237", "100": "255 237 213", "200": "254 215 170", "300": "253 186 116",
      "400": "251 146 60", "500": "249 115 22", "600": "234 88 12", "700": "194 65 12",
      "800": "154 52 18", "900": "124 45 18", "950": "67 20 7",
    },
  },
  {
    id: "imoveis-violeta", label: "Violeta (imóveis)", category: "imoveis-turismo",
    palette: {
      "50": "245 243 255", "100": "237 233 254", "200": "221 214 254", "300": "196 181 253",
      "400": "167 139 250", "500": "139 92 246", "600": "124 58 237", "700": "109 40 217",
      "800": "91 33 182", "900": "76 29 149", "950": "46 16 101",
    },
  },
];

export function presetById(id: string): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.id === id) ?? null;
}

/** Preset dedicado da categoria, ou o "verde-padrao" como fallback. */
export function presetForCategory(cat: BusinessCategory): ThemePreset {
  return THEME_PRESETS.find((p) => p.category === cat) ?? THEME_PRESETS[0];
}
```

**Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/theme/presets.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/theme/presets.ts src/lib/theme/presets.test.ts
git commit -m "feat(theme): catálogo de presets por vertical casado às BusinessCategory"
```

---

## Task 2.2: Upload de logo no Storage (bucket público)

**Files:**
- Create: `src/server/storage/branding-storage.ts`
- Modify: `src/lib/env.ts` (adicionar `SUPABASE_BRANDING_BUCKET` com default) — confirmar shape do env atual antes.

Logos precisam de URL estável para `<img>` em toda página → bucket **público** (diferente do bucket de mídia, que é privado com URL assinada).

**Step 1: Helper de upload** (segue o padrão do `media-storage.ts`)

```ts
// src/server/storage/branding-storage.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isMediaStorageConfigured } from "@/lib/env";

const BUCKET = env.SUPABASE_BRANDING_BUCKET ?? "branding";
let client: SupabaseClient | null = null;
let ensured = false;

function getClient(): SupabaseClient | null {
  if (!isMediaStorageConfigured) return null;
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

async function ensureBucket(sb: SupabaseClient) {
  if (ensured) return;
  ensured = true;
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) {
    console.warn(`[branding-storage] createBucket falhou: ${error.message}`);
  }
}

/** Sobe o logo (path estável por conta) e devolve a URL pública, ou null. */
export async function uploadBrandingLogo(
  buffer: Buffer,
  opts: { accountId: string; ext: string; mime: string },
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  await ensureBucket(sb);
  const path = `${opts.accountId}/logo.${opts.ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: opts.mime, upsert: true, cacheControl: "3600",
  });
  if (error) {
    console.warn(`[branding-storage] upload falhou: ${error.message}`);
    return null;
  }
  // Cache-buster para refletir troca de logo mantendo path estável.
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${buffer.length}`;
}
```

**Step 2: Env** — em `src/lib/env.ts`, logo após a linha `SUPABASE_MEDIA_BUCKET: z.string().default("whatsapp-media"),` (por volta da linha 89), adicione:

```ts
  SUPABASE_BRANDING_BUCKET: z.string().default("branding"),
```

(Mesmo padrão zod do bucket de mídia. `isMediaStorageConfigured` já exportado em `env.ts` cobre a checagem de credenciais — o `branding-storage.ts` acima o reutiliza.)

**Step 3: (sem teste automatizado — I/O externo)** Verifica na Task 2.4 end-to-end.

**Step 4: Commit**

```bash
git add src/server/storage/branding-storage.ts src/lib/env.ts
git commit -m "feat(theme): upload de logo em bucket público de branding"
```

---

## Task 2.3: API para salvar branding

**Files:**
- Create: `src/app/api/branding/route.ts`

Espelha o padrão de `src/app/api/account/pipeline-labels/route.ts` (rota de settings da conta): `dynamic = "force-dynamic"`, resolve `getTenantContext()`, retorna **401** sem sessão e **403** sem permissão, e usa `ctx.tenantUserId` como escopo. Branding é identidade da conta → gate no **dono** (`ctx.role === "ADMIN"`), como o export/delete faz. Aceita `multipart/form-data` com `presetId`, `appName` e o arquivo `logo`.

**Step 1: Implementar `POST`** (esboço — ajuste ao helper de auth/resposta do projeto):

```ts
// src/app/api/branding/route.ts
import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/tenant";
import { prisma } from "@/server/db/client";
import { presetById } from "@/lib/theme/presets";
import { uploadBrandingLogo } from "@/server/storage/branding-storage";

export async function POST(req: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (ctx.role !== "ADMIN") {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const form = await req.formData();
  const presetId = (form.get("presetId") as string | null)?.trim() || null;
  const appName = (form.get("appName") as string | null)?.trim() || null;
  const file = form.get("logo") as File | null;

  const data: Record<string, unknown> = { appName };
  if (presetId) {
    const preset = presetById(presetId);
    if (!preset) return NextResponse.json({ error: "preset inválido" }, { status: 400 });
    data.presetId = preset.id;
    data.brandScale = preset.palette;
  }
  if (file && file.size > 0) {
    if (file.size > 512 * 1024) return NextResponse.json({ error: "logo até 512KB" }, { status: 400 });
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : null;
    if (!ext) return NextResponse.json({ error: "use PNG, JPG ou WEBP" }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const url = await uploadBrandingLogo(buf, { accountId: ctx.tenantUserId, ext, mime: file.type });
    if (url) data.logoUrl = url;
  }

  await prisma.accountBranding.upsert({
    where: { accountId: ctx.tenantUserId },
    create: { accountId: ctx.tenantUserId, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
```

**Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

**Step 3: Commit**

```bash
git add src/app/api/branding/route.ts
git commit -m "feat(theme): API para salvar preset/logo/nome da conta"
```

---

## Task 2.4: UI de configuração (aba "Identidade" nas Configurações)

**Files:**
- Create: `src/components/app/BrandingSettings.tsx`
- Modify: `src/app/(app)/configuracoes/page.tsx` (server component que já carrega `ctx`, `isOwner` e renderiza `AccountSettings`, `CustomFieldsManager`, `PipelineLabelsManager`).

**Step 1: Componente client** — grade de presets (swatch do `500` + label), upload de logo com preview, campo de nome, botão salvar (POST multipart para `/api/branding`, depois `router.refresh()`).

Pontos-chave:
- Mostrar os `THEME_PRESETS` como botões com um quadradinho `style={{ background: 'rgb(' + palette['500'].replaceAll(' ', ',') + ')' }}`.
- Preview ao vivo é opcional; o `router.refresh()` após salvar já re-injeta o tema via layout (SSR).
- Só renderizar a seção se `role === "ADMIN"` (operador não configura marca).

**Step 2: Fiação server** — em `configuracoes/page.tsx`, a página já tem `ctx`, `isOwner = ctx?.role === "ADMIN"` e `ownerId = ctx?.tenantUserId ?? userId`. Adicione `getBranding(ownerId)` ao `Promise.all` existente e, **só quando `isOwner`**, renderize a seção após o bloco `<AccountSettings>` (dentro de um `<div className="mt-6">`, como os outros managers):

```tsx
{isOwner && (
  <div className="mt-6">
    <BrandingSettings
      initial={{ presetId: branding.presetId ?? null, appName: branding.appName, logoUrl: branding.logoUrl }}
    />
  </div>
)}
```

Import: `import { BrandingSettings } from "@/components/app/BrandingSettings";` e `import { getBranding } from "@/server/services/branding.service";`. (`ResolvedBranding` já carrega `presetId`/`appName`/`logoUrl` resolvidos — a UI pré-seleciona o preset atual direto.)

**Step 3: Verificar end-to-end**

Run: `npm run dev`.
- Escolher preset "Rosé", salvar → após refresh, app inteiro fica rosé; swatch marcado.
- Subir um PNG → logo aparece na sidebar; recarregar mantém.
- Definir nome "Clínica X" → wordmark troca.
- Logar como OPERADOR → seção de identidade não aparece; POST direto retorna 403.
Expected: todos os pontos acima OK. Rode `npx vitest run` (tudo verde) e `npx tsc --noEmit`.

**Step 4: Commit**

```bash
git add src/components/app/BrandingSettings.tsx "src/app/(app)/configuracoes"
git commit -m "feat(theme): aba Identidade — escolher preset, logo e nome da conta"
```

---

## Task 2.5: Casar preset ao onboarding do template de IA

**Files:**
- Modify: `src/components/BusinessTemplatePicker.tsx` (ou o fluxo que consome `onApply`)

Quando o usuário aplica um template de negócio (que já preenche persona/knowledgeBase), oferecer aplicar **também** o tema da categoria correspondente — uma escolha, sistema inteiro vestido.

**Step 1:** No `onApply` do picker (ou no componente pai que trata a aplicação), após aplicar o conteúdo, chamar `presetForCategory(tpl.category)` e oferecer/aplicar o preset via `/api/branding` (checkbox "aplicar também as cores deste ramo", marcado por padrão para o dono).

> Mantenha desacoplado: se o usuário é OPERADOR ou já tem branding custom, não force. O picker só **sugere**; a fonte de verdade do tema continua a aba Identidade.

**Step 2: Verificar** — aplicar "Salão de beleza" com o check ligado → conteúdo da IA + tema rosé aplicados juntos após refresh.

**Step 3: Commit**

```bash
git add src/components/BusinessTemplatePicker.tsx
git commit -m "feat(theme): aplicar tema da categoria junto com o template de negócio"
```

---

## Fechamento

**Checklist final:**
- [ ] `npx vitest run` — verde.
- [ ] `npx tsc --noEmit` — limpo.
- [ ] Conta sem branding = visual verde original (paridade).
- [ ] Conta com preset = accent trocado em TODAS as telas (inbox, kanban, agenda, campanhas, financeiro) sem tocar nos 190 usos.
- [ ] Logo/nome refletidos na sidebar; operador não vê a config.
- [ ] Landing/login públicos seguem verde default.

**Notas de produção (para o dono aplicar):**
- `prisma db push` foi rodado em dev; aplicar o schema em prod pelo caminho de migração vigente (ver memória `crm-inbox-db-push-pending`).
- Garantir `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` presentes (mesmas do media-storage) para o upload de logo; sem elas o upload degrada para "sem logo" (não quebra).
- Bucket `branding` é público por design (logos não são sensíveis).

**Fora de escopo (v2, sob demanda):** color-picker livre com geração de escala a partir de 1 cor; tema na landing pública; domínio próprio; temar `LogoMark`/`mint` via vars.
