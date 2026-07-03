import { NextResponse } from "next/server"
import { upsertTrackingFundListCacheEntry } from "@/lib/server/tracking-funds-list-cache-pg"
import {
  addFundToTrackingPool,
  invalidateTrackingPoolListCaches,
  isWritableTrackingPool,
  removeFundFromTrackingPool,
} from "@/lib/server/tracking-pool-membership"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function ensureFundListCacheEntry(beian_hao: string, product_name: string) {
  try {
    await upsertTrackingFundListCacheEntry(beian_hao, product_name)
  } catch (err) {
    console.error("[tracking-funds/add] cache upsert failed", beian_hao, err)
  }
}

export async function POST(req: Request) {
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }) }

  const { pool, beian_hao, product_name } = body as Record<string, string>
  if (!beian_hao || !product_name) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }
  if (!pool || !isWritableTrackingPool(pool)) {
    return NextResponse.json({ error: "unknown_pool" }, { status: 400 })
  }

  try {
    const { created } = await addFundToTrackingPool(pool, beian_hao, product_name)
    await ensureFundListCacheEntry(beian_hao, product_name)
    invalidateTrackingPoolListCaches([pool])
    if (!created) {
      return NextResponse.json({ error: "already_exists" }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[tracking-funds/add]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const pool = searchParams.get("pool") ?? ""
  const beian_hao = searchParams.get("beian_hao") ?? ""
  if (!pool || !beian_hao) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 })
  }
  if (!isWritableTrackingPool(pool)) {
    return NextResponse.json({ error: "unknown_pool" }, { status: 400 })
  }
  try {
    await removeFundFromTrackingPool(pool, beian_hao)
    invalidateTrackingPoolListCaches([pool])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[tracking-funds/add DELETE]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
