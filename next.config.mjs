/** @type {import('next').NextConfig} */
const isLowMemBuild = process.env.NEXT_BUILD_LOW_MEMORY === "1"

const nextConfig = {
  productionBrowserSourceMaps: !isLowMemBuild,
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
      config.cache = false
      config.parallelism = 1
    }
    return config
  },
}

export default nextConfig
