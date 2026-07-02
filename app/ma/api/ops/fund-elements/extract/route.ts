import { NextResponse } from "next/server"
import { extractFundContractElements } from "@/lib/server/fund-contract-element-extract"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传基金合同文件" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await extractFundContractElements({
      buffer,
      fileName: file.name || "contract.pdf",
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : "要素提取失败"
    console.error("[ops/fund-elements/extract]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
