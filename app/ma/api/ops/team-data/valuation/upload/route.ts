import { NextResponse } from "next/server"
import { uploadTeamValuationFiles } from "@/lib/server/team-valuation-upload"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const beian_hao = String(form.get("beian_hao") ?? "")
    const product_name = String(form.get("product_name") ?? "")
    const files = form.getAll("files").filter((item): item is File => item instanceof File)

    const result = await uploadTeamValuationFiles({ beian_hao, product_name, files })

    if ("error" in result) {
      if (result.error === "missing_fields") {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 })
      }
      if (result.error === "too_many_files") {
        return NextResponse.json({ error: "每次最多上传100份估值表" }, { status: 400 })
      }
      return NextResponse.json({ error: "请上传 .xls 或 .xlsx 格式的估值表" }, { status: 400 })
    }

    if (result.saved === 0) {
      return NextResponse.json(
        { error: result.failed[0] ?? "无法解析估值表", failed: result.failed },
        { status: 400 },
      )
    }

    return NextResponse.json({
      ok: true,
      saved: result.saved,
      failed: result.failed,
    })
  } catch (err) {
    console.error("[team-data/valuation/upload]", err)
    return NextResponse.json({ error: "上传估值表失败" }, { status: 500 })
  }
}
