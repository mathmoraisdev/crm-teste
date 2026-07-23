import { paletteToCssVars, DEFAULT_PALETTE, type BrandPalette } from "@/lib/theme/palette";

/**
 * Injeta a paleta da conta como override do :root. Server-rendered (sem flash).
 * Se a paleta é a default, não emite nada — o globals.css já cobre.
 */
export function BrandingStyle({ palette }: { palette: BrandPalette }) {
  if (palette === DEFAULT_PALETTE) return null;
  return <style dangerouslySetInnerHTML={{ __html: `:root{${paletteToCssVars(palette)}}` }} />;
}
