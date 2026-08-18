import { NextResponse } from "next/server"
import {
  backfillKeywordFieldsFromStoredContracts,
  requeueIncompleteContractExtractJobs,
  startContractExtractJob,
} from "@/lib/server/fund-contract-extract-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  try {
    const backfill = await backfillKeywordFieldsFromStoredContracts()
    const queued = await requeueIncompleteContractExtractJobs()
    const total = queued.queued + queued.fromMaterials
    if (total > 0) {
      startContractExtractJob({ maxJobs: 400, maxMs: 50 * 60 * 1000 })
    }
    return NextResponse.json({
      ok: true,
      backfill,
      queued: queued.queued,
      fromMaterials: queued.fromMaterials,
      message: [
        `已用合同关键词回填 ${backfill.filled} 个产品`,
        total
          ? `并排队 ${queued.queued} 份待补提合同${queued.fromMaterials ? `，另从合同附件补入 ${queued.fromMaterials} 份` : ""}，后台继续提取`
          : backfill.filled
            ? "无需再排队 LLM 提取"
            : "没有需要重新提取的合同",
      ].join("；"),
    })
  } catch (err) {
    console.error("[ops/fund-elements/jobs reextract]", err)
    return NextResponse.json({ error: "重新提取排队失败" }, { status: 500 })
  }
}
