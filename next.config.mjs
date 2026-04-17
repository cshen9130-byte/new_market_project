/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas", "mammoth", "xlsx", "word-extractor", "imapflow", "pino", "thread-stream"],
  images: {
    unoptimized: true,
  },
  // Constrain output tracing to the workspace root
  outputFileTracingRoot: process.cwd(),
}

export default nextConfig
