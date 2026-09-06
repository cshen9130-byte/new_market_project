import { NextResponse } from "next/server"

import {
  analyzeAndStoreSettlementBuffer,
  analyzeStoredSettlementFile,
  listProductSettlementFiles,
  loadProductSettlementMeta,
  publicProductSettlementLink,
  readLatestAnalysis,
} from "@/lib/server/product-settlement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const { searchParams } = new URL(request.url)
    const file = searchParams.get("file")?.trim()
    const meta = await loadProductSettlementMeta(beian_hao)
    const analysis = file
      ? analyzeStoredSettlementFile(beian_hao, file)
      : readLatestAnalysis(beian_hao)
    return NextResponse.json({
      ...meta,
      files: listProductSettlementFiles(beian_hao),
      link: publicProductSettlementLink(beian_hao),
      analysis,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载结算单失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请先上传一个结算单文件。" }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const analysis = analyzeAndStoreSettlementBuffer(beian_hao, file.name, buffer)
    const meta = await loadProductSettlementMeta(beian_hao)
    return NextResponse.json({
      ...meta,
      files: listProductSettlementFiles(beian_hao),
      link: publicProductSettlementLink(beian_hao),
      analysis,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "结算单分析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
