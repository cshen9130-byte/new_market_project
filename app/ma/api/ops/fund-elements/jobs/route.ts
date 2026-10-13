import { createHash } from "crypto"
import { NextResponse } from "next/server"
import {
  EXTRACT_JOB_MAX_FILES,
  EXTRACT_JOB_STATUSES,
  annotateElementExtractJobDuplicates,
  createElementExtractJobFromBuffer,
  findLiveElementExtractDuplicate,
  listElementExtractJobs,
  type ElementExtractJobRow,
  type ElementExtractUploadDuplicate,
  type ExtractJobStatus,
} from "@/lib/server/fund-element-extract-jobs"
import { startContractExtractJob } from "@/lib/server/fund-contract-extract-job"
import { retargetPromotedExtractJobs } from "@/lib/server/unregistered-fund-product"

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
    const ids = (searchParams.get("ids") || "")
      .split(",")
      .map((value) => parseInt(value, 10))
      .filter((id) => Number.isFinite(id) && id > 0)
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)
    const result = await listElementExtractJobs({ status, q, ids, limit, offset })
    const annotated = await annotateElementExtractJobDuplicates(result.rows)
    const rows = await retargetPromotedExtractJobs(annotated)
    return NextResponse.json({ ok: true, ...result, rows })
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
    const created: ElementExtractJobRow[] = []
    const duplicates: ElementExtractUploadDuplicate[] = []
    const errors: { fileName: string; error: string }[] = []
    const seenHashes = new Map<string, ElementExtractJobRow>()
    const seenNames = new Map<string, ElementExtractJobRow>()
    for (const file of files) {
      const fileName = file.name || "contract.pdf"
      try {
        const buffer = Buffer.from(await file.arrayBuffer())
        const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
        const nameKey = fileName.trim().toLowerCase()
        const inBatch = seenHashes.get(hash) || (nameKey ? seenNames.get(nameKey) : undefined)
        if (inBatch) {
          duplicates.push({
            fileName,
            existingId: inBatch.id,
            existingFileName: inBatch.original_filename,
          })
          continue
        }
        const existing = await findLiveElementExtractDuplicate({
          contentHash: hash,
          originalFilename: fileName,
          fileSize: buffer.byteLength,
        })
        if (existing) {
          seenHashes.set(hash, existing)
          if (nameKey) seenNames.set(nameKey, existing)
          duplicates.push({
            fileName,
            existingId: existing.id,
            existingFileName: existing.original_filename,
          })
          continue
        }
        const job = await createElementExtractJobFromBuffer({
          buffer,
          originalFilename: fileName,
          uploaded_by,
          contentHash: hash,
        })
        seenHashes.set(hash, job)
        if (nameKey) seenNames.set(nameKey, job)
        created.push(job)
      } catch (err) {
        errors.push({
          fileName,
          error: err instanceof Error ? err.message : "上传失败",
        })
      }
    }

    if (created.length) {
      startContractExtractJob()
    }

    return NextResponse.json(
      { ok: true, data: created, duplicates, errors },
      { status: 202 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "上传失败"
    console.error("[ops/fund-elements/jobs POST]", err)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
