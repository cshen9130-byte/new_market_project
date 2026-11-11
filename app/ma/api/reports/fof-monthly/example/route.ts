import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EXAMPLE_FILES: Record<string, string> = {
  review: "低波稳健FOF 1号月报回顾版_20260626.png",
  curve: "低波稳健FOF 1号月报曲线版_20260626.png",
  // Hook for 新建报告 产品月报 · 持仓版:
  // /ma/api/reports/fof-monthly/example?variant=holdings&kind=monthly
  holdings: "低波稳健FOF 1号月报_持仓饼图版_20260626.png",
}

function resolveLayout(req: Request): keyof typeof EXAMPLE_FILES {
  const { searchParams } = new URL(req.url)
  const variant = (searchParams.get("variant") || "").trim().toLowerCase()
  const layout = (searchParams.get("layout") || "").trim().toLowerCase()
  if (variant === "holdings" || layout === "holdings") return "holdings"
  if (layout === "curve") return "curve"
  return "review"
}

export async function GET(req: Request) {
  const layout = resolveLayout(req)
  const fileName = EXAMPLE_FILES[layout]
  const examplePath = path.join(process.cwd(), "haitai_week_report", fileName)

  if (!existsSync(examplePath)) {
    return NextResponse.json({ error: "范例文件不存在" }, { status: 404 })
  }

  const buffer = await readFile(examplePath)
  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}
