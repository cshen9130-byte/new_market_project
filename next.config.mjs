/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Reduce parallel page compilation on low-RAM deploy servers (see scripts/deploy/)
    cpus: process.env.NEXT_BUILD_LOW_MEMORY === "1" ? 1 : undefined,
    workerThreads: process.env.NEXT_BUILD_LOW_MEMORY === "1" ? false : undefined,
    webpackMemoryOptimizations: process.env.NEXT_BUILD_LOW_MEMORY === "1" ? true : undefined,
  },
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
