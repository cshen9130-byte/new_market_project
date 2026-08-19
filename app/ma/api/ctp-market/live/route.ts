import { proxyCtpMarket } from "@/lib/server/ctp-market-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return proxyCtpMarket("/api/live")
}
