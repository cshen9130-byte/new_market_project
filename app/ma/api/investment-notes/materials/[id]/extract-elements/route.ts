import { NextResponse } from "next/server"
import { getUserById } from "@/lib/server/users"
import { enqueueElementExtractForInvestmentNoteMaterial } from "@/lib/server/investment-note-element-extract"
import { getInvestmentNoteMaterialsByIds } from "@/lib/server/investment-note-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUser(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  return userId ? await getUserById(userId) : null
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getUser(req)
    if (!user) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 })
    }

    const { id } = await context.params
    const material = getInvestmentNoteMaterialsByIds([id])[0]
    if (!material) {
      return NextResponse.json({ ok: false, error: "文件不存在" }, { status: 404 })
    }

    const result = await enqueueElementExtractForInvestmentNoteMaterial({
      materialId: material.id,
      fileName: material.name,
      fileSize: material.size,
      uploadedBy: user.name || user.id,
    })
    if (!result.job) {
      return NextResponse.json(
        { ok: false, error: result.skipReason || "该文件不适合提取产品要素" },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: true, extractJob: result.job })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[investment-notes/materials extract-elements]", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
