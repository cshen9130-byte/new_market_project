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
  ],
  images: {
    unoptimized: true,
  },
  // Constrain output tracing to the workspace root
  outputFileTracingRoot: process.cwd(),
  webpack: (config, { nextRuntime, webpack }) => {
    if (isLowMemBuild) {
      // Cap concurrent module builds so peak RSS fits a small deploy host.
      config.parallelism = 1
      // Filesystem cache serializes the whole module graph into one string
      // (V8 String::SlowFlatten / Utf8Length) and has OOM'd a 3 GB heap on a
      // 7 GiB server while RAM was still free. Disk cache is not worth that.
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
