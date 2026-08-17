import { NextResponse } from "next/server"
import {
  requeueIncompleteContractExtractJobs,
  startContractExtractJob,
} from "@/lib/server/fund-contract-extract-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const queued = await requeueIncompleteContractExtractJobs()
    const total = queued.queued + queued.fromMaterials
    if (total > 0) {
      startContractExtractJob({ maxJobs: 400, maxMs: 50 * 60 * 1000 })
    }
    return NextResponse.json({
      ok: true,
      queued: queued.queued,
      fromMaterials: queued.fromMaterials,
      message: total
        ? `已排队 ${queued.queued} 份待补提合同${queued.fromMaterials ? `，另从合同附件补入 ${queued.fromMaterials} 份` : ""}，后台正在提取`
        : "没有需要重新提取的合同",
    })
  } catch (err) {
    console.error("[ops/fund-elements/jobs reextract]", err)
    return NextResponse.json({ error: "重新提取排队失败" }, { status: 500 })
  }
}
