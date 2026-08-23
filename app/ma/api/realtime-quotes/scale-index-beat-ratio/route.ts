import { NextResponse } from "next/server"

import { SCALE_INDEX_FREQS, type ScaleIndexFreq } from "@/lib/client/scale-indices"
import { getScaleIndexBeatRatio } from "@/lib/server/scale-index-beat-ratio"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FREQS = new Set<ScaleIndexFreq>(SCALE_INDEX_FREQS.map((item) => item.id))

export async function GET(req: Request) {
  const freq = (new URL(req.url).searchParams.get("freq") || "d") as ScaleIndexFreq
  if (!FREQS.has(freq)) {
    return NextResponse.json({ ok: false, error: "invalid freq" }, { status: 400 })
  }
  try {
    const series = await getScaleIndexBeatRatio(freq)
    return NextResponse.json({ ok: true, freq, series })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "跑赢占比计算失败" },
      { status: 502 },
    )
  }
}
