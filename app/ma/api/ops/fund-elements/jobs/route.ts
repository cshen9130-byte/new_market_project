import { NextResponse } from "next/server"
import {
  EXTRACT_JOB_MAX_FILES,
  EXTRACT_JOB_STATUSES,
  createElementExtractJob,
  listElementExtractJobs,
  type ExtractJobStatus,
} from "@/lib/server/fund-element-extract-jobs"
import { startContractExtractJob } from "@/lib/server/fund-contract-extract-job"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function currentUser(req: Request) {
  const rawName = String(req.headers.get("x-market-user-name") || "").trim()
  if (rawName) {
    try {
      return decodeURIComponent(rawName)
    } catch {
      return rawName
    }
  }
  return String(req.headers.get("x-market-user-id") || "").trim()
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const statusRaw = (searchParams.get("status") || "all").trim()
    const status = EXTRACT_JOB_STATUSES.includes(statusRaw as ExtractJobStatus)
      ? (statusRaw as ExtractJobStatus)
      : "all"
    const q = (searchParams.get("q") || "").trim()
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const result = await listElementExtractJobs({ status, q, limit, offset })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error("[ops/fund-elements/jobs GET]", err)
    return NextResponse.json({ error: "加载提取任务失败" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const files: File[] = []
    for (const value of form.getAll("files")) {
      if (value instanceof File) files.push(value)
    }
    for (const value of form.getAll("file")) {
      if (value instanceof File) files.push(value)
    }
    if (!files.length) {
      return NextResponse.json({ error: "请上传基金合同文件" }, { status: 400 })
    }
    if (files.length > EXTRACT_JOB_MAX_FILES) {
      return NextResponse.json({ error: `单次最多上传 ${EXTRACT_JOB_MAX_FILES} 个文件` }, { status: 400 })
    }

    const uploaded_by = currentUser(req)
    const created = []
    const errors: { fileName: string; error: string }[] = []
    for (const file of files) {
      try {
        created.push(await createElementExtractJob({ file, uploaded_by }))
      } catch (err) {
        errors.push({
          fileName: file.name,
          error: err instanceof Error ? err.message : "上传失败",
        })
      }
    }

    if (created.length) {
      startContractExtractJob()
    }

    return NextResponse.json(
      { ok: true, data: created, errors },
      { status: 202 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "上传失败"
    console.error("[ops/fund-elements/jobs POST]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
