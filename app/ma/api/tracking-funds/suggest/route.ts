import { NextResponse } from "next/server"
import { suggestTrackingKeywords } from "@/lib/server/tracking-keyword-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function poolFlags(pool: string): { isCustomPool: boolean; isMineAllPool: boolean } {
  const isMineAllPool = pool === "mine_all"
  const isCustomPool =
    pool.startsWith("custom_")
    || pool.startsWith("mine_custom_")
    || pool === "mine_default"
    || pool === "jy_ops"
    || isMineAllPool
  return { isCustomPool, isMineAllPool }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  const pool = (searchParams.get("pool") || "all").trim() || "all"
  if (!q) return NextResponse.json([])

  const flags = poolFlags(pool)
  try {
    const rows = await suggestTrackingKeywords({
      keyword: q,
      pool,
      isCustomPool: flags.isCustomPool,
      isMineAllPool: flags.isMineAllPool,
      limit: 12,
    })
    return NextResponse.json(rows)
  } catch (err) {
    console.error("[tracking-funds/suggest]", err)
    return NextResponse.json([])
  }
}
