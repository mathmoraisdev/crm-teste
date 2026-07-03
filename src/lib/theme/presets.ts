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
