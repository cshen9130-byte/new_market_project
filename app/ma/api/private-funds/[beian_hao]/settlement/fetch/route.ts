import { NextResponse } from "next/server"

import {
  fetchProductSettlementFromCfmmc,
  listProductSettlementFiles,
  publicProductSettlementLink,
} from "@/lib/server/product-settlement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao } = await params
    const body = await request.json().catch(() => ({})) as { mode?: "history" | "incremental" }
    const result = await fetchProductSettlementFromCfmmc(
      beian_hao,
      body.mode === "incremental" ? "incremental" : "history",
    )
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error || "监控中心获取失败。",
          files: listProductSettlementFiles(beian_hao),
          link: publicProductSettlementLink(beian_hao),
          analysis: result.analysis ?? null,
        },
        { status: 500 },
      )
    }
    return NextResponse.json({
      ok: true,
      filename: result.filename,
      downloaded: result.downloaded,
      skipped: result.skipped,
      discarded: result.discarded,
      files: listProductSettlementFiles(beian_hao),
      link: publicProductSettlementLink(beian_hao),
      analysis: result.analysis ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "监控中心获取失败。"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
