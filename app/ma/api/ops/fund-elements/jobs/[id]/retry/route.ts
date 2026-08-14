import { NextResponse } from "next/server"
import { getElementExtractJobById, requeueElementExtractJob } from "@/lib/server/fund-element-extract-jobs"
import { startContractExtractJob } from "@/lib/server/fund-contract-extract-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const jobId = parseInt(id, 10)
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: "无效的任务 ID" }, { status: 400 })
    }
    const existing = await getElementExtractJobById(jobId)
    if (!existing) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 })
    }
    const row = await requeueElementExtractJob(jobId)
    if (!row) {
      return NextResponse.json({ error: "当前状态不可重试" }, { status: 400 })
    }
    startContractExtractJob()
    return NextResponse.json({ ok: true, data: row })
  } catch (err) {
    console.error("[ops/fund-elements/jobs retry]", err)
    return NextResponse.json({ error: "重试失败" }, { status: 500 })
  }
}
