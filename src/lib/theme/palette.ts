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
