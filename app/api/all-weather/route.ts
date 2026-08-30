import { NextResponse } from "next/server"
import { isContractTenor } from "@/lib/all-weather/setup"
import { isAllWeatherVariantId, parseAllWeatherVariantId } from "@/lib/all-weather/variants"
import { requireCshen, requireLoggedIn } from "@/lib/server/require-cshen"
import { getOverview, refreshPaperBook, resetPaperBook } from "@/lib/server/all-weather-book"
import { writeAllWeatherSettings } from "@/lib/server/all-weather-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function variantFromRequest(raw: unknown) {
  if (raw == null || raw === "") return parseAllWeatherVariantId(undefined)
  if (!isAllWeatherVariantId(raw)) return null
  return raw
}

export async function GET(req: Request) {
  const user = await requireLoggedIn(req)
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 })
  try {
    const url = new URL(req.url)
    const refresh = url.searchParams.get("refresh") === "1"
    const variantId = variantFromRequest(url.searchParams.get("variant"))
    if (!variantId) return NextResponse.json({ error: "策略版本无效" }, { status: 400 })
    const data = await getOverview(refresh, variantId)
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
    const variantId = variantFromRequest(body?.variant)
    if (!variantId) return NextResponse.json({ error: "策略版本无效" }, { status: 400 })
    if (body?.action === "setup") {
      if (!isContractTenor(body.contractTenor)) {
        return NextResponse.json({ error: "合约月份无效" }, { status: 400 })
      }
      writeAllWeatherSettings({ contractTenor: body.contractTenor }, variantId)
      resetPaperBook(variantId)
      const data = await refreshPaperBook({ reset: true, variantId })
      return NextResponse.json({ ok: true, ...data })
    }
    if (body?.action === "reset") {
      resetPaperBook(variantId)
      const data = await refreshPaperBook({ reset: true, variantId })
      return NextResponse.json({ ok: true, ...data })
    }
    const data = await refreshPaperBook({ variantId })
    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : "刷新失败"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
