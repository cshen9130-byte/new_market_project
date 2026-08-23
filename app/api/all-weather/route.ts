import { NextResponse } from "next/server"
import { isContractTenor } from "@/lib/all-weather/setup"
import { requireCshen } from "@/lib/server/require-cshen"
import { getOverview, refreshPaperBook, resetPaperBook } from "@/lib/server/all-weather-book"
import { writeAllWeatherSettings } from "@/lib/server/all-weather-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const url = new URL(req.url)
    const refresh = url.searchParams.get("refresh") === "1"
    const data = await getOverview(refresh)
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "加载失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const user = await requireCshen(req)
  if (!user) return NextResponse.json({ error: "无权限" }, { status: 403 })
  try {
    const body = await req.json().catch(() => ({}))
    if (body?.action === "setup") {
      if (!isContractTenor(body.contractTenor)) {
        return NextResponse.json({ error: "合约月份无效" }, { status: 400 })
      }
      writeAllWeatherSettings({ contractTenor: body.contractTenor })
      resetPaperBook()
      const data = await refreshPaperBook({ reset: true })
      return NextResponse.json({ ok: true, ...data })
    }
    if (body?.action === "reset") {
      resetPaperBook()
      const data = await refreshPaperBook({ reset: true })
      return NextResponse.json({ ok: true, ...data })
    }
    const data = await refreshPaperBook()
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "刷新失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
