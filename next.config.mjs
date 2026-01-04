/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Constrain output tracing to the workspace root
  outputFileTracingRoot: process.cwd(),
}

export default nextConfig
