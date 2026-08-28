import fs from "fs"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { query } from "@/lib/db"
import {
  applyContractKeywordFallbacks,
  extractFundContractElements,
  matchFundsFromExtracted,
  pickHighConfidenceFundMatch,
  readFundContractText,
  softenWeakExtractedFields,
} from "@/lib/server/fund-contract-element-extract"
import { extractShareClassFeeOverrides } from "@/lib/server/fund-contract-element-keywords"
import {
  claimNextElementExtractJob,
  countQueuedElementExtractJobs,
  createElementExtractJobFromBuffer,
  getElementExtractJobById,
  listAppliedElementExtractJobs,
  listAppliedExtractJobsByBeiAns,
  listExtractJobsForRerun,
  extractJobFilePath,
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
  loadExtractedElementDisplayValues,
  writeFillEmptyElementsAcrossShareClasses,
  writeFundElementsAcrossShareClasses,
  writeOverwriteElementsAcrossShareClasses,
} from "@/lib/server/fund-elements-write"
import { beianFamilyKey, ensureShareClassBeianProduct, listFundFamilyProducts } from "@/lib/server/share-class-product"
import {
  compareContractDocumentRecency,
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

export type KeywordBackfillResult = {
  processed: number
  filled: number
  skipped: number
  failed: number
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
const execFileAsync = promisify(execFile)

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
    const buffer = await readStoredContractBuffer(job)
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

function latestJobPerBeian(jobs: ElementExtractJobRow[]): ElementExtractJobRow[] {
  const ranked = [...jobs].sort((a, b) =>
    compareContractDocumentRecency(
      contractDocumentRecency({ fileName: a.original_filename, uploadedAt: a.uploaded_at }),
      contractDocumentRecency({ fileName: b.original_filename, uploadedAt: b.uploaded_at }),
    ) || a.id - b.id,
  )
  const latest = new Map<string, ElementExtractJobRow>()
  for (const job of ranked) {
    const key = (job.beian_hao ?? "").trim().toUpperCase()
    if (!key) continue
    latest.set(key, job)
  }
  return Array.from(latest.values())
}

const DEFAULT_SSH_HOST = "root@8.154.33.143"
const DEFAULT_REMOTE_JOBS_DIR = "/root/market_dashboard_storage/fund-elements/jobs"

function ensureRemoteJobReadEnv() {
  if (process.platform !== "win32") return
  process.env.CONTRACT_EXTRACT_SSH_HOST ||= DEFAULT_SSH_HOST
  process.env.CONTRACT_EXTRACT_REMOTE_JOBS_DIR ||= DEFAULT_REMOTE_JOBS_DIR
}

function isEnoent(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT")
}

function jobFileMissingMessage(job: ElementExtractJobRow, err: unknown): string {
  if (isEnoent(err)) {
    return `合同文件不在当前机器（${job.storage_filename}）。请在服务器上重试提取，或确认 MARKET_DASHBOARD_STORAGE_DIR`
  }
  return err instanceof Error ? err.message : "无法读取合同文件"
}

function remoteStorageRoot(): string {
  ensureRemoteJobReadEnv()
  const jobsDir = process.env.CONTRACT_EXTRACT_REMOTE_JOBS_DIR?.trim()
  if (jobsDir) return jobsDir.replace(/\/fund-elements\/jobs\/?$/, "")
  return "/root/market_dashboard_storage"
}

function cacheJobFileLocally(storageFilename: string, buffer: Buffer) {
  const dest = extractJobFilePath(storageFilename)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buffer)
}

async function sshCatRemoteFile(remotePath: string): Promise<Buffer> {
  ensureRemoteJobReadEnv()
  const host = process.env.CONTRACT_EXTRACT_SSH_HOST?.trim()
  if (!host) throw new Error("未配置远程读取")
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const args = ["-o", "StrictHostKeyChecking=accept-new", host, `cat ${JSON.stringify(remotePath)}`]
  if (fs.existsSync(keyPath)) args.unshift("-i", keyPath)
  const { stdout } = await execFileAsync("ssh", args, {
    encoding: "buffer",
    maxBuffer: 25 * 1024 * 1024,
    windowsHide: true,
  })
  if (!stdout?.length) throw new Error("远程文件为空")
  return Buffer.from(stdout)
}

async function readBeianMaterialCorpus(beian: string, seenFilenames: Set<string>): Promise<string> {
  const wanted = beian.trim()
  if (!wanted) return ""
  let rows: Array<{ id: number; beian_hao: string; original_filename: string; storage_filename: string }> = []
  try {
    rows = await query<{ original_filename: string; storage_filename: string; beian_hao: string; id: number }>(
      `SELECT id, beian_hao, original_filename, storage_filename
       FROM ops_fund_contract_materials
       WHERE upper(btrim(beian_hao)) = upper(btrim($1))
       ORDER BY
         CASE
           WHEN original_filename ~ '要素表|产品介绍|产品资料概要|风险揭示' THEN 0
           ELSE 1
         END,
         id DESC`,
      [wanted],
    )
  } catch {
    return ""
  }

  const parts: string[] = []
  for (const row of rows) {
    const name = row.original_filename || ""
    if (seenFilenames.has(name)) continue
    seenFilenames.add(name)
    try {
      let buffer: Buffer | null = null
      try {
        const file = await readFundContractMaterialFile(row.id)
        buffer = file?.buffer ?? null
      } catch {
        buffer = null
      }
      if (!buffer?.length) {
        const safeName = path.posix.basename(row.storage_filename.replace(/\\/g, "/"))
        if (!safeName || safeName !== row.storage_filename) continue
        buffer = await sshCatRemoteFile(
          `${remoteStorageRoot()}/fund-contracts/${row.beian_hao}/${safeName}`,
        )
      }
      const text = await readFundContractText(buffer, name)
      if (text.trim()) parts.push(text)
    } catch {
      // Skip unreadable 要素表 / 产品介绍; contract text is still used.
    }
  }
  return parts.join("\n")
}

async function readBeianContractCorpus(beian: string, jobs: ElementExtractJobRow[]): Promise<string> {
  const wanted = beian.trim().toUpperCase()
  const parts: string[] = []
  const seenFilenames = new Set<string>()
  for (const job of jobs) {
    if ((job.beian_hao ?? "").trim().toUpperCase() !== wanted) continue
    try {
      const buffer = await readStoredContractBuffer(job)
      parts.push(await readFundContractText(buffer, job.original_filename))
      if (job.original_filename) seenFilenames.add(job.original_filename)
    } catch {
      // Skip unreadable siblings; the latest job is still tried below via other files.
    }
  }
  const extras = await readBeianMaterialCorpus(beian, seenFilenames)
  if (extras.trim()) parts.push(extras)
  return parts.join("\n")
}

export async function readStoredContractBuffer(job: ElementExtractJobRow): Promise<Buffer> {
  ensureRemoteJobReadEnv()
  try {
    return await readElementExtractJobFile(job)
  } catch (localErr) {
    const remoteDir = process.env.CONTRACT_EXTRACT_REMOTE_JOBS_DIR?.trim()
    if (!remoteDir) throw new Error(jobFileMissingMessage(job, localErr))
    const safeName = path.basename(job.storage_filename)
    if (!safeName || safeName !== job.storage_filename) {
      throw new Error("合同存储文件名无效")
    }
    try {
      const buffer = await sshCatRemoteFile(`${remoteDir.replace(/\/+$/, "")}/${safeName}`)
      try {
        cacheJobFileLocally(job.storage_filename, buffer)
      } catch {
        // Extraction can continue from the remote bytes even if the local cache write fails.
      }
      return buffer
    } catch (remoteErr) {
      const remoteMsg = remoteErr instanceof Error ? remoteErr.message : String(remoteErr)
      throw new Error(`${jobFileMissingMessage(job, localErr)}；远程读取失败：${remoteMsg}`)
    }
  }
}

/** Re-read stored contracts and fill empty/weak 要素 from keyword windows (no LLM). */
export async function backfillKeywordFieldsFromStoredContracts(options?: {
  maxJobs?: number
  beianHao?: string
}): Promise<KeywordBackfillResult> {
  const maxJobs = Math.max(1, options?.maxJobs ?? 2000)
  const want = (options?.beianHao ?? "").trim().toUpperCase()
  const result: KeywordBackfillResult = { processed: 0, filled: 0, skipped: 0, failed: 0 }
  const allJobs = await listAppliedElementExtractJobs()
  const jobs = latestJobPerBeian(allJobs)
    .filter((job) => {
      if (!want) return true
      const code = (job.beian_hao ?? "").trim().toUpperCase()
      return code === want || beianFamilyKey(code) === beianFamilyKey(want)
    })
    .slice(0, maxJobs)

  for (const job of jobs) {
    result.processed += 1
    const beian = (job.beian_hao ?? "").trim()
    if (!beian) {
      result.skipped += 1
      continue
    }
    try {
      const text = await readBeianContractCorpus(beian, allJobs)
      if (!text.trim()) {
        result.skipped += 1
        continue
      }
      const productName = job.product_name || job.extracted_json?.fund_name || beian
      const current = await loadExtractedElementDisplayValues(beian, productName)
      const extracted = applyContractKeywordFallbacks(text, {
        ...(job.extracted_json ?? {}),
        fee_manage_rate: job.extracted_json?.fee_manage_rate || current?.fee_manage_rate,
      })
      const shareClassOverrides = extractShareClassFeeOverrides(text)
      const fields = await writeFillEmptyElementsAcrossShareClasses(
        beian,
        extracted.fund_name || productName,
        extracted,
        { shareClassOverrides },
      )
      await updateElementExtractJob(job.id, {
        extracted_json: extracted,
        applied_fields: fields.length ? fields : job.applied_fields,
        error_message: job.error_message,
      })
      if (fields.length) result.filled += 1
      else result.skipped += 1
      if (result.processed % 5 === 0 || fields.length) {
        console.error(
          `[contract-extract] keyword backfill ${result.processed}/${jobs.length} job=${job.id} ${beian} fields=${fields.join(",") || "none"}`,
        )
      }
    } catch (err) {
      result.failed += 1
      console.error(`[contract-extract] keyword backfill job ${job.id} failed:`, err)
    }
  }
  return result
}

/**
 * Copy already-written 申赎要素 onto empty A/B/C and FOF底层 share-class rows
 * (e.g. parent SBLE72 extracted, FOF row BLE72A still a stub).
 */
export async function fanoutAppliedElementsToShareClasses(options?: {
  maxJobs?: number
}): Promise<KeywordBackfillResult> {
  const maxJobs = Math.max(1, options?.maxJobs ?? 2000)
  const result: KeywordBackfillResult = { processed: 0, filled: 0, skipped: 0, failed: 0 }
  const allJobs = await listAppliedElementExtractJobs()
  const jobs = latestJobPerBeian(allJobs).slice(0, maxJobs)

  for (const job of jobs) {
    result.processed += 1
    const beian = (job.beian_hao ?? "").trim()
    if (!beian) {
      result.skipped += 1
      continue
    }
    try {
      const productName = job.product_name || beian
      const source = await loadExtractedElementDisplayValues(beian, productName)
      if (!source) {
        result.skipped += 1
        continue
      }
      let shareClassOverrides = {}
      try {
        const corpus = await readBeianContractCorpus(beian, allJobs)
        if (corpus.trim()) shareClassOverrides = extractShareClassFeeOverrides(corpus)
      } catch {
        // corpus may not be available; proceed without overrides
      }
      const fields = await writeFillEmptyElementsAcrossShareClasses(
        beian,
        productName,
        softenWeakExtractedFields(source),
        { shareClassOverrides },
      )
      if (fields.length) result.filled += 1
      else result.skipped += 1
      if (result.processed % 20 === 0 || fields.length) {
        console.error(
          `[contract-extract] share-class fanout ${result.processed}/${jobs.length} ${beian} fields=${fields.join(",") || "none"}`,
        )
      }
    } catch (err) {
      result.failed += 1
      console.error(`[contract-extract] share-class fanout ${beian} failed:`, err)
    }
  }
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
  if (process.platform === "win32" && (process.env.DATABASE_URL || "").includes(":5433/")) {
    console.warn("[contract-extract] skipped: Windows next against tunneled production DB")
    return { ok: false, reason: "already_running" }
  }
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

  const buffer = await readStoredContractBuffer(job)
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
