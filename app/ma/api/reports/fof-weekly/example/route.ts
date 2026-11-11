import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WEEKLY_CURVE_EXAMPLE = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号周报_20260626.png",
)

const WEEKLY_HOLDINGS_EXAMPLE = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号周报_持仓饼图版_范例.png",
)

const HOLDING_PERIOD_CURVE_EXAMPLE = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号持有期报告_20260626.png",
)

const HOLDING_PERIOD_HOLDINGS_EXAMPLE = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号持有期报告_持仓饼图版_范例.png",
)

function resolveExamplePath(req: Request): string {
  const params = new URL(req.url).searchParams
  const variant = (params.get("variant") || "").trim().toLowerCase()
  const kind = (params.get("kind") || params.get("report_kind") || "").trim().toLowerCase()
  const isHoldings = variant === "holdings"
  const isHoldingPeriod = kind === "holding"
  if (isHoldingPeriod && isHoldings) return HOLDING_PERIOD_HOLDINGS_EXAMPLE
  if (isHoldingPeriod) return HOLDING_PERIOD_CURVE_EXAMPLE
  if (isHoldings) return WEEKLY_HOLDINGS_EXAMPLE
  return WEEKLY_CURVE_EXAMPLE
}

export async function GET(req: Request) {
  const filePath = resolveExamplePath(req)
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "范例文件不存在" }, { status: 404 })
  }

  const buffer = await readFile(filePath)
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}
