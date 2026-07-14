import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { resolveTableFillColumnTemplates } from "@/lib/ma/table-fill-column-templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const userId = String(req.headers.get("x-market-user-id") || "").trim()
    const user = userId ? await getUserById(userId) : null
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 })
    }

    const templates = await resolveTableFillColumnTemplates()
    return NextResponse.json({ templates })
  } catch (error) {
    console.error("[table-fill-column-templates]", error)
    return NextResponse.json({ error: "加载列名模板失败" }, { status: 500 })
  }
}
