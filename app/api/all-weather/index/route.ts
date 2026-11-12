import { NextResponse } from "next/server"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import {
  CI011001_REBUILD_KEY,
  CI011001_REBUILD_LABEL,
  loadCi011001RebuildPrices,
  readRebuildModelName,
} from "@/lib/server/ci011001-rebuild"
import { requireLoggedIn } from "@/lib/server/require-cshen"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await requireLoggedIn(req)
  if (!user) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })

  const sp = new URL(req.url).searchParams
  const from = sp.get("from") || "2009-01-01"
  const to = sp.get("to") || shanghaiTodayIsoDate()

  try {
    const data = await loadCi011001RebuildPrices(from, to)
    return NextResponse.json({
      ok: true,
      key: CI011001_REBUILD_KEY,
      label: CI011001_REBUILD_LABEL,
      officialKey: "CI011001.WI",
      model: readRebuildModelName(),
      from,
      to,
      start: data[0]?.date ?? null,
      end: data[data.length - 1]?.date ?? null,
      data,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
