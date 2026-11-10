import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXAMPLE_PATH = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号周报_20260626.png",
)

const HOLDINGS_EXAMPLE_PATH = path.join(
  process.cwd(),
  "haitai_week_report",
  "低波稳健FOF 1号周报_持仓饼图版_范例.png",
)

export async function GET(req: Request) {
  const variant = new URL(req.url).searchParams.get("variant")
  const filePath = variant === "holdings" ? HOLDINGS_EXAMPLE_PATH : EXAMPLE_PATH
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "范例文件不存在" }, { status: 404 })
  }

  const buffer = await readFile(filePath)
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  })
}
