import { NextResponse } from "next/server"
import { authService } from "@/lib/auth"
import { listFundContractMaterials, saveFundContractMaterial } from "@/lib/server/fund-contract-materials"
import { ensureShareClassBeianProduct } from "@/lib/server/share-class-product"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function currentUser(req: Request) {
  try {
    const session = await authService.getSession(req as never)
    return session?.user?.name ?? session?.user?.email ?? ""
  } catch {
    return ""
  }
}

export async function GET(req: Request) {
  const beian_hao = (new URL(req.url).searchParams.get("beian_hao") || "").trim()
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  try {
    const data = await listFundContractMaterials(beian_hao)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    console.error("[ops/fund-contracts GET]", err)
    return NextResponse.json({ error: "加载合同资料失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const beian_hao = String(form.get("beian_hao") ?? "").trim()
    const file = form.get("file")
    const chart_date = String(form.get("chart_date") ?? "").trim() || null
    const title = String(form.get("title") ?? "").trim() || null
    if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })
    if (!(file instanceof File)) return NextResponse.json({ error: "请上传文件" }, { status: 400 })

    // Synthesized A/B/C codes from element-extract matching may not exist yet.
    const ensured = await ensureShareClassBeianProduct(beian_hao)
    const resolvedBeian = ensured?.beian_hao || beian_hao

    const row = await saveFundContractMaterial({
      beian_hao: resolvedBeian,
      file,
      uploaded_by: await currentUser(req),
      chart_date,
      title,
    })

    return NextResponse.json({ ok: true, data: row })
  } catch (err) {
    const message = err instanceof Error ? err.message : "保存合同失败"
    console.error("[ops/fund-contracts POST]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
