/** @type {import('next').NextConfig} */
const isLowMemBuild = process.env.NEXT_BUILD_LOW_MEMORY === "1"

const nextConfig = {
  productionBrowserSourceMaps: !isLowMemBuild,
  // Next.js 16 enables Turbopack by default; an empty config acknowledges the
  // custom webpack block below (used for low-memory deploy builds) so dev HMR
  // does not hit "unexpected Turbopack error" from the config mismatch.
  turbopack: {},
  experimental: {
    // Reduce parallel page compilation on low-RAM deploy servers (see scripts/deploy/)
    cpus: isLowMemBuild ? 1 : undefined,
    workerThreads: isLowMemBuild ? false : undefined,
    webpackMemoryOptimizations: isLowMemBuild ? true : undefined,
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
  webpack: (config) => {
    if (isLowMemBuild) {
      // Cap concurrent module builds so peak RSS fits a ~3.4 GiB host.
      config.parallelism = 1
      // Keep disk cache for speed, but do not retain cache generations in RAM.
      if (config.cache && typeof config.cache === "object") {
        config.cache.maxMemoryGenerations = 0
      }
    }
    return config
  },
}

export default nextConfig
