/** @type {import('next').NextConfig} */
const isLowMemBuild = process.env.NEXT_BUILD_LOW_MEMORY === "1"

// Deploy script sets this only when the V8 heap cap is >= 5120 MB.
// Hard ceiling: four in-flight modules, never the webpack default of 100.
function lowMemParallelism() {
  const raw = Number(process.env.NEXT_BUILD_PARALLELISM || "1")
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(4, Math.floor(raw))
}

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
    // Next.js 16 default is 10MB (10485760). Use bytes so the limit is not ignored.
    proxyClientMaxBodySize: 160 * 1024 * 1024,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: [
    "pdf-parse",
    "@napi-rs/canvas",
    "mammoth",
    "xlsx",
    "word-extractor",
    "imapflow",
    "pino",
    "thread-stream",
    "node-unrar-js",
    "adm-zip",
    "subset-font",
    "harfbuzzjs",
  ],
  images: {
    unoptimized: true,
  },
  // Constrain output tracing to the workspace root
  outputFileTracingRoot: process.cwd(),
  webpack: (config, { nextRuntime, webpack }) => {
    if (isLowMemBuild) {
      // One module at a time made the 2026-11-16 production compile take 11.4 min.
      // The finished module graph already fit in a 3072 MB heap that day; the OOM
      // was a later allocation that packed the filesystem cache into one string.
      // Cache stays off. Parallelism only widens the in-flight slice and is
      // capped at 4, and only when the heap cap is 5120 MB (see the deploy script).
      config.parallelism = lowMemParallelism()
      config.cache = false
    }
    // middleware.ts keeps an edge compilation of instrumentation.ts.
    // `if (NEXT_RUNTIME !== "nodejs") return` does not stop webpack from
    // following the dynamic import(), so the edge bundle pulls in fs/crypto
    // and @napi-rs/canvas. The node server build still bundles these.
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.IgnorePlugin({
          checkResource(resource) {
            const request = String(resource).split("?")[0]
            return /(?:^|[\\/])(?:background-jobs-scheduler|dev-prod-db-tunnel)(?:\.[cm]?[jt]s)?$/.test(
              request,
            )
          },
        }),
      )
    }
    return config
  },
}

export default nextConfig

