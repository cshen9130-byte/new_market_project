import { proxyCtpMarket } from "@/lib/server/ctp-market-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get("symbol")
  const path = symbol ? `/api/bars?symbol=${encodeURIComponent(symbol)}` : "/api/bars"
  return proxyCtpMarket(path)
}
