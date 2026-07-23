import { ImageResponse } from "next/og";

// Card de preview (Open Graph) que o WhatsApp/redes mostram ao colar o link.
// Gerado pelo Next (Satori) — sem asset externo, sem designer. A mesma arte da
// marca (avião de papel + fagulha mint) vive em `src/app/icon.svg` / Logo.tsx.
export const runtime = "edge";
export const alt = "Disparador.ai — Atenda e gerencie seu negócio no WhatsApp com IA";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Logo (tile verde + avião) inline, servida como data-URI (Satori renderiza <img>
// data-URI de forma confiável em qualquer versão).
const LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#12C27E"/><stop offset="1" stop-color="#067A52"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#g)"/><path d="M10.5 12.8 L30.2 20 L18.8 20 Z" fill="#FFFFFF"/><path d="M18.8 20 L30.2 20 L10.5 27.2 Z" fill="#FFFFFF" fill-opacity="0.62"/><path d="M30.6 7 C30.95 9.4 31.5 9.95 33.9 10.3 C31.5 10.65 30.95 11.2 30.6 13.6 C30.25 11.2 29.7 10.65 27.3 10.3 C29.7 9.95 30.25 9.4 30.6 7 Z" fill="#5FE3A1"/></svg>`;

export default function OpengraphImage() {
  const logo = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "84px",
          background: "linear-gradient(135deg, #06251B 0%, #0B4A34 58%, #0E7A52 100%)",
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logo}
          width={130}
          height={130}
          style={{ borderRadius: 36, boxShadow: "0 24px 60px -16px rgba(14,164,107,.65)" }}
          alt=""
        />
        <div
          style={{
            display: "flex",
            marginTop: 46,
            fontSize: 90,
            fontWeight: 800,
            letterSpacing: "-0.03em",
          }}
        >
          <span>Disparador</span>
          <span style={{ color: "#5FE3A1" }}>.ai</span>
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 40,
            lineHeight: 1.3,
            color: "rgba(255,255,255,0.9)",
            maxWidth: 940,
          }}
        >
          Atenda e gerencie seu negócio no WhatsApp com IA
        </div>
        <div style={{ display: "flex", marginTop: 44, fontSize: 27, color: "#8FE9C0" }}>
          IA · CRM · Agenda · Caixa · Estoque · Campanhas
        </div>
      </div>
    ),
    { ...size },
  );
}
