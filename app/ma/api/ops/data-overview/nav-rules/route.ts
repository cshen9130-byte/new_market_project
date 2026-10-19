import { NextResponse } from "next/server"
import { readNavFixesCatalog } from "@/lib/server/nav-fixes-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const body = readNavFixesCatalog()
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("[ops/data-overview/nav-rules]", err)
    const missing = err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
    return NextResponse.json(
      {
        error: "nav_rules_failed",
        message: missing ? "找不到净值规则表文件" : "净值规则表加载失败，请稍后重试",
      },
      { status: missing ? 404 : 500 },
    )
  }
}
