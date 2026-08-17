import fs from "fs"
import path from "path"
import { query } from "@/lib/db"
import {
  extractFundContractElements,
  matchFundsFromExtracted,
  pickHighConfidenceFundMatch,
} from "@/lib/server/fund-contract-element-extract"
import {
  claimNextElementExtractJob,
  countQueuedElementExtractJobs,
  createElementExtractJobFromBuffer,
  getElementExtractJobById,
  listAppliedExtractJobsByBeiAns,
  listExtractJobsForRerun,
  listNeedsReviewExtractJobs,
  readElementExtractJobFile,
  requeueExtractJobs,
  updateElementExtractJob,
  type ElementExtractJobRow,
} from "@/lib/server/fund-element-extract-jobs"
import {
  readFundContractMaterialFile,
  saveFundContractMaterialFromBuffer,
} from "@/lib/server/fund-contract-materials"
import {
  appliedFieldKeys,
  writeFillEmptyElementsAcrossShareClasses,
  writeFundElementsAcrossShareClasses,
  writeOverwriteElementsAcrossShareClasses,
} from "@/lib/server/fund-elements-write"
import { ensureShareClassBeianProduct, listFundFamilyProducts } from "@/lib/server/share-class-product"
import {
  contractDocumentRecency,
  isLatestContractDocument,
} from "@/lib/server/contract-document-recency"
import { shouldYieldBackgroundWorkToUsers } from "@/lib/server/user-activity-priority"

export type ContractExtractRunResult = {
  processed: number
  applied: number
  needsReview: number
  failed: number
  remaining: number
}

export type ContractExtractJobStatus = {
  status: "queued" | "running" | "done" | "error"
  message: string
  startedAt: number
  finishedAt?: number
  result?: ContractExtractRunResult
}

const JOB_KEY = "__contractExtract"
const YIELD_POLL_MS = 3_000

function extractedHasContent(
  extracted: ElementExtractJobRow["extracted_json"] | null | undefined,
): boolean {
  return Boolean(
    extracted && Object.values(extracted).some((value) => String(value ?? "").trim()),
  )
}

function getJobMap(): Map<string, ContractExtractJobStatus> {
  const g = globalThis as typeof globalThis & {
    __contractExtractJobs?: Map<string, ContractExtractJobStatus>
  }
  if (!g.__contractExtractJobs) g.__contractExtractJobs = new Map()
  return g.__contractExtractJobs
}

function runtimeDir(): string {
  const root =
    process.env.MARKET_DASHBOARD_STORAGE_DIR || path.join(process.cwd(), "data")
  return path.join(root, "runtime")
}

function lockPath(): string {
  return path.join(runtimeDir(), "contract-extract.lock")
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readLockPid(): number | null {
  try {
    const raw = fs.readFileSync(lockPath(), "utf8").trim()
    const pid = parseInt(raw, 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

function tryAcquireLock(): boolean {
  fs.mkdirSync(runtimeDir(), { recursive: true })
  const writeLock = (): boolean => {
    try {
      const fd = fs.openSync(lockPath(), "wx")
      fs.writeFileSync(fd, String(process.pid), "utf8")
      fs.closeSync(fd)
      return true
    } catch {
      return false
    }
  }
  if (writeLock()) return true
  const pid = readLockPid()
  if (pid != null && pid !== process.pid && pidIsAlive(pid)) return false
  try {
    fs.unlinkSync(lockPath())
  } catch {
    // ignore
  }
  return writeLock()
}

function releaseLock(): void {
  try {
    const pid = readLockPid()
    if (pid != null && pid !== process.pid) return
    fs.unlinkSync(lockPath())
  } catch {
    // ignore
  }
}

export function getContractExtractJobStatus(): ContractExtractJobStatus | null {
  return getJobMap().get(JOB_KEY) ?? null
}

function sanitizeExtractedForDocument(
  fileName: string,
  extracted: NonNullable<ElementExtractJobRow["extracted_json"]>,
): NonNullable<ElementExtractJobRow["extracted_json"]> {
  if (/合同/.test(fileName)) return extracted
  if (!/说明函|减免说明|意见征询|告知函|公告/.test(fileName)) return extracted
  return { ...extracted, inception_date: null, puton_date: null }
}

async function attachContractAndApply(
  job: ElementExtractJobRow,
  buffer: Buffer,
  beianHao: string,
  productName: string,
  extracted: NonNullable<ElementExtractJobRow["extracted_json"]>,
  matchedFunds: NonNullable<ElementExtractJobRow["matched_funds"]>,
  textPreview: string,
): Promise<"applied" | "needs_review"> {
  const ensured = await ensureShareClassBeianProduct(beianHao)
  const resolvedBeian = ensured?.beian_hao || beianHao

  let contractId = job.contract_material_id
  if (!contractId) {
    const material = await saveFundContractMaterialFromBuffer({
      beian_hao: resolvedBeian,
      buffer,
      originalFilename: job.original_filename,
      uploaded_by: job.uploaded_by,
      title: productName,
    })
    contractId = material.id
  }

  const currentRecency = contractDocumentRecency({
    fileName: job.original_filename,
    uploadedAt: job.uploaded_at,
  })
  const family = await listFundFamilyProducts(resolvedBeian)
  const applied = await listAppliedExtractJobsByBeiAns(
    family.map((row) => row.beian_hao).concat(resolvedBeian),
  )
  const otherRecencies = applied
    .filter((row) => row.id !== job.id)
    .map((row) => contractDocumentRecency({
      fileName: row.original_filename,
      uploadedAt: row.uploaded_at,
    }))
  const useLatest = isLatestContractDocument(currentRecency, otherRecencies)
  const fields = useLatest
    ? await writeOverwriteElementsAcrossShareClasses(resolvedBeian, productName, extracted)
    : await writeFillEmptyElementsAcrossShareClasses(resolvedBeian, productName, extracted)

  const latestNote = useLatest
    ? null
    : currentRecency.kind === "announcement"
      ? "已保存文件；公告/说明未覆盖合同要素"
      : "已保存合同；要素以更新的合同或补充协议为准"

  await updateElementExtractJob(job.id, {
    status: "applied",
    beian_hao: resolvedBeian,
    product_name: productName,
    extracted_json: extracted,
    matched_funds: matchedFunds,
    text_preview: textPreview,
    applied_fields: fields,
    error_message: latestNote,
    contract_material_id: contractId,
  })
  return "applied"
}

async function processOneJob(
  job: ElementExtractJobRow,
  options?: { reuseExtracted?: boolean },
): Promise<"applied" | "needs_review" | "failed"> {
  try {
    const buffer = await readElementExtractJobFile(job)
    const hints = {
      fileName: job.original_filename,
      contractText: job.text_preview ?? undefined,
    }
    const hasExtractedContent = extractedHasContent(job.extracted_json)
    const result = options?.reuseExtracted && hasExtractedContent
      ? {
          extracted: job.extracted_json,
          matched_funds: await matchFundsFromExtracted(job.extracted_json, hints),
          text_preview: job.text_preview ?? "",
        }
      : await extractFundContractElements({
          buffer,
          fileName: job.original_filename,
        })
    if (!result.extracted) {
      throw new Error("要素提取结果为空")
    }
    const extracted = sanitizeExtractedForDocument(job.original_filename, result.extracted)
    const matched =
      pickHighConfidenceFundMatch(extracted, result.matched_funds, {
        fileName: job.original_filename,
      }) ??
      (job.beian_hao
        ? {
            beian_hao: job.beian_hao,
            product_name: job.product_name || extracted.fund_name || job.beian_hao,
            short_name: null,
          }
        : null)
    if (!matched) {
      await updateElementExtractJob(job.id, {
        status: "needs_review",
        extracted_json: extracted,
        matched_funds: result.matched_funds,
        text_preview: result.text_preview,
        beian_hao: null,
        product_name: extracted.fund_name,
        error_message: result.matched_funds.length
          ? "匹配不唯一，请人工确认目标产品后写入"
          : "未匹配到产品，请人工搜索后写入",
      })
      return "needs_review"
    }
    if (!extractedHasContent(extracted)) {
      await updateElementExtractJob(job.id, {
        status: "needs_review",
        extracted_json: extracted,
        matched_funds: result.matched_funds,
        text_preview: result.text_preview,
        beian_hao: matched.beian_hao,
        product_name: matched.product_name,
        error_message: "已匹配产品，但未能从文件提取要素（扫描件请确认清晰后重试）",
      })
      return "needs_review"
    }
    return await attachContractAndApply(
      job,
      buffer,
      matched.beian_hao,
      matched.product_name,
      extracted,
      result.matched_funds,
      result.text_preview,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "要素提取失败"
    console.error(`[contract-extract] job ${job.id} failed:`, err)
    await updateElementExtractJob(job.id, {
      status: "failed",
      error_message: message,
    })
    return "failed"
  }
}

export async function rematchNeedsReviewExtractJobs(options?: {
  maxJobs?: number
}): Promise<ContractExtractRunResult> {
  const maxJobs = Math.max(1, options?.maxJobs ?? 200)
  const result: ContractExtractRunResult = {
    processed: 0,
    applied: 0,
    needsReview: 0,
    failed: 0,
    remaining: 0,
  }

  const jobs = (await listNeedsReviewExtractJobs()).slice(0, maxJobs)
  for (const job of jobs) {
    const claimed = await updateElementExtractJob(job.id, {
      status: "extracting",
      error_message: null,
    })
    if (!claimed || claimed.status !== "extracting") continue
    const outcome = await processOneJob({ ...job, ...claimed }, { reuseExtracted: true })
    result.processed += 1
    if (outcome === "applied") result.applied += 1
    else if (outcome === "needs_review") result.needsReview += 1
    else result.failed += 1
  }

  result.remaining = await countQueuedElementExtractJobs()
  return result
}

export async function enqueueOrphanContractMaterialJobs(): Promise<number> {
  let materials: Array<{
    id: number
    beian_hao: string
    original_filename: string
    uploaded_by: string | null
    title: string | null
  }> = []
  try {
    materials = await query<{
      id: number
      beian_hao: string
      original_filename: string
      uploaded_by: string | null
      title: string | null
    }>(
      `SELECT m.id, m.beian_hao, m.original_filename, m.uploaded_by, COALESCE(m.title, '') AS title
       FROM ops_fund_contract_materials m
       WHERE (
         m.original_filename ~ '合同'
         OR COALESCE(m.title, '') ~ '合同'
       )
       AND NOT EXISTS (
         SELECT 1 FROM ops_element_extract_jobs j
         WHERE j.contract_material_id = m.id
            OR (
              UPPER(BTRIM(COALESCE(j.beian_hao, ''))) = UPPER(BTRIM(m.beian_hao))
              AND j.original_filename = m.original_filename
            )
       )
       ORDER BY m.id ASC
       LIMIT 200`,
    )
  } catch (err) {
    console.error("[contract-extract] list orphan materials failed", err)
    return 0
  }

  let created = 0
  for (const material of materials) {
    const file = await readFundContractMaterialFile(material.id)
    if (!file) continue
    try {
      await createElementExtractJobFromBuffer({
        buffer: file.buffer,
        originalFilename: material.original_filename,
        uploaded_by: material.uploaded_by || "",
        beian_hao: material.beian_hao,
        product_name: material.title || null,
        contract_material_id: material.id,
      })
      created += 1
    } catch (err) {
      console.error(`[contract-extract] enqueue material ${material.id} failed:`, err)
    }
  }
  return created
}

export async function requeueIncompleteContractExtractJobs(): Promise<{
  queued: number
  fromMaterials: number
}> {
  const jobs = await listExtractJobsForRerun()
  const queued = await requeueExtractJobs(jobs.map((job) => job.id))
  const fromMaterials = await enqueueOrphanContractMaterialJobs()
  return { queued, fromMaterials }
}

export async function processContractExtractQueue(options?: {
  retryFailed?: boolean
  maxJobs?: number
  maxMs?: number
  yieldToUserTraffic?: boolean
}): Promise<ContractExtractRunResult> {
  const maxJobs = Math.max(1, options?.maxJobs ?? 200)
  const maxMs = Math.max(5_000, options?.maxMs ?? 50 * 60 * 1000)
  const yieldToUserTraffic = options?.yieldToUserTraffic === true
  const started = Date.now()
  const result: ContractExtractRunResult = {
    processed: 0,
    applied: 0,
    needsReview: 0,
    failed: 0,
    remaining: 0,
  }

  while (result.processed < maxJobs) {
    if (Date.now() - started >= maxMs) break
    if (yieldToUserTraffic && shouldYieldBackgroundWorkToUsers()) {
      console.log("[contract-extract] yielding to interactive user traffic")
      break
    }
    const job = await claimNextElementExtractJob({ retryFailed: options?.retryFailed })
    if (!job) break
    const outcome = await processOneJob(job)
    result.processed += 1
    if (outcome === "applied") result.applied += 1
    else if (outcome === "needs_review") result.needsReview += 1
    else result.failed += 1
  }

  result.remaining = await countQueuedElementExtractJobs()
  return result
}

export function startContractExtractJob(options?: {
  retryFailed?: boolean
  yieldToUserTraffic?: boolean
  maxJobs?: number
  maxMs?: number
}): { ok: true } | { ok: false; reason: "already_running" } {
  const jobs = getJobMap()
  const existing = jobs.get(JOB_KEY)
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return { ok: false, reason: "already_running" }
  }
  if (!tryAcquireLock()) {
    return { ok: false, reason: "already_running" }
  }

  const job: ContractExtractJobStatus = {
    status: "queued",
    message: "准备提取合同要素…",
    startedAt: Date.now(),
  }
  jobs.set(JOB_KEY, job)

  const abort = new AbortController()
  let yieldPoll: ReturnType<typeof setInterval> | null = null
  if (options?.yieldToUserTraffic) {
    yieldPoll = setInterval(() => {
      if (!shouldYieldBackgroundWorkToUsers()) return
      abort.abort(new DOMException("yielded to user traffic", "AbortError"))
    }, YIELD_POLL_MS)
  }

  void (async () => {
    job.status = "running"
    job.message = "正在提取合同要素…"
    try {
      const result = await processContractExtractQueue({
        retryFailed: options?.retryFailed,
        yieldToUserTraffic: options?.yieldToUserTraffic,
        maxJobs: options?.maxJobs,
        maxMs: options?.maxMs,
      })
      if (abort.signal.aborted) {
        job.status = "done"
        job.message = "已让出前台，剩余任务将在下次调度继续"
        job.result = result
        job.finishedAt = Date.now()
        return
      }
      job.status = "done"
      job.message = result.processed
        ? `完成 ${result.processed} 份（写入 ${result.applied}，待确认 ${result.needsReview}，失败 ${result.failed}）`
        : "没有待处理任务"
      job.result = result
      job.finishedAt = Date.now()
    } catch (err) {
      job.status = "error"
      job.message = err instanceof Error ? err.message : "合同要素提取失败"
      job.finishedAt = Date.now()
      console.error("[contract-extract] runner error:", err)
    } finally {
      if (yieldPoll) clearInterval(yieldPoll)
      releaseLock()
    }
  })()

  return { ok: true }
}

export async function applyElementExtractJobManually(input: {
  jobId: number
  beian_hao: string
  product_name?: string | null
  fields?: Record<string, string | null>
}): Promise<ElementExtractJobRow> {
  const job = await getElementExtractJobById(input.jobId)
  if (!job) throw new Error("任务不存在")
  if (!job.extracted_json) throw new Error("任务尚未完成提取，无法写入")

  const ensured = await ensureShareClassBeianProduct(input.beian_hao)
  const resolvedBeian = ensured?.beian_hao || input.beian_hao.trim()
  const productName = input.product_name?.trim() || job.product_name || resolvedBeian

  const buffer = await readElementExtractJobFile(job)
  let contractId = job.contract_material_id
  if (!contractId) {
    const material = await saveFundContractMaterialFromBuffer({
      beian_hao: resolvedBeian,
      buffer,
      originalFilename: job.original_filename,
      uploaded_by: job.uploaded_by,
      title: productName,
    })
    contractId = material.id
  }

  const extracted = job.extracted_json
  let fields: string[] = []
  if (input.fields) {
    const writeBody = { beian_hao: resolvedBeian, ...input.fields }
    await writeFundElementsAcrossShareClasses(writeBody)
    fields = appliedFieldKeys(writeBody)
  } else {
    fields = await writeOverwriteElementsAcrossShareClasses(resolvedBeian, productName, extracted)
  }

  const updated = await updateElementExtractJob(job.id, {
    status: "applied",
    beian_hao: resolvedBeian,
    product_name: productName,
    applied_fields: fields,
    error_message: null,
    contract_material_id: contractId,
  })
  if (!updated) throw new Error("更新任务状态失败")
  return updated
}
