/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg-static (binário nativo de ~70MB) e fluent-ffmpeg só são importados no
  // worker (tsx, processo persistente do Railway) — nunca no app web. Marcá-los
  // como external evita que o bundler do Next os tente incluir no serverless da
  // Vercel (onde nem rodariam e poderiam quebrar o build).
  serverExternalPackages: ["ffmpeg-static", "fluent-ffmpeg"],
};

export default nextConfig;
