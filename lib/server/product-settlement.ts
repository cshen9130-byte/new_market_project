/**
 * Product-scoped 结算单 files + 监控中心 credentials.
 * Isolated from account-risk (`data/account-risk`, public.cfmmc_*).
 */

import { spawn, spawnSync } from "child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs"
import path from "path"

import { lookupListCacheFundHeader } from "@/lib/server/fund-detail-fast-path"
import { analyzeProductSettlementWorkbook } from "@/lib/server/product-settlement-analyze"
import type { SettlementWorkbookAnalysis } from "@/lib/server/settlement-account-etl"

const DATA_ROOT = path.join(process.cwd(), "data", "product-settlement")
const SPREADSHEET_EXT = new Set([".xls", ".xlsx", ".xlsm", ".xlsb"])
const AUTO_FETCH_RETRY_INTERVAL_MS = 60 * 60 * 1000

export type ProductSettlementLink = {
  userId: string
  password: string
  enabled: boolean
  scheduleTime: string
  lastFetchDate: string | null
  lastFetchAt: string | null
  lastError: string | null
  lastFile: string | null
}

export type ProductSettlementFile = {
  name: string
  size: number
  mtime: string
  source: "upload" | "cfmmc"
}

export type PublicProductSettlementLink = Omit<ProductSettlementLink, "password"> & {
  password: string
  linked: boolean
}

const DEFAULT_LINK: ProductSettlementLink = {
  userId: "",
  password: "",
  enabled: false,
  scheduleTime: "17:00",
  lastFetchDate: null,
  lastFetchAt: null,
  lastError: null,
  lastFile: null,
}

let productFetchRunning = false

function safeBeian(beianHao: string): string {
  const trimmed = beianHao.trim()
  if (!trimmed || trimmed.includes("..") || /[\\/]/.test(trimmed)) {
    throw new Error("无效的产品备案号")
  }
  return trimmed
}

function productDir(beianHao: string): string {
  return path.join(DATA_ROOT, safeBeian(beianHao))
}

function filesDir(beianHao: string): string {
  return path.join(productDir(beianHao), "files")
}

function linkPath(beianHao: string): string {
  return path.join(productDir(beianHao), "link.json")
}

function analysisPath(beianHao: string): string {
  return path.join(productDir(beianHao), "latest-analysis.json")
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function shanghaiParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  )
  return {
    dateKey: `${parts.year}${parts.month}${parts.day}`,
    hhmm: `${String(parts.hour ?? "").padStart(2, "0")}:${String(parts.minute ?? "").padStart(2, "0")}`,
  }
}

function normalizeScheduleTime(time: string): string {
  const [hRaw, mRaw] = (time || "17:00").split(":")
  const h = Number(hRaw)
  const m = Number(mRaw)
  return `${String(Number.isFinite(h) ? h : 17).padStart(2, "0")}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")}`
}

function isDue(now: Date, scheduleTime: string, lastFetchDate: string | null, lastFetchAt: string | null): boolean {
  const sched = normalizeScheduleTime(scheduleTime)
  const { dateKey, hhmm } = shanghaiParts(now)
  if (hhmm < sched) return false
  const lastAt = lastFetchAt ? new Date(lastFetchAt) : null
  if (lastAt && !Number.isNaN(lastAt.getTime())) {
    const last = shanghaiParts(lastAt)
    if (last.dateKey === dateKey && last.hhmm >= sched) {
      if (lastFetchDate === dateKey) return false
      if (now.getTime() - lastAt.getTime() < AUTO_FETCH_RETRY_INTERVAL_MS) return false
    }
  }
  return true
}

function isMaskedSecret(value: string | undefined): boolean {
  return !value || value.startsWith("•")
}

function isSpreadsheetName(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  return SPREADSHEET_EXT.has(ext) && !name.startsWith("~$")
}

function safeResolveInDir(dir: string, file: string): string | null {
  const resolved = path.resolve(dir, path.basename(file))
  const root = path.resolve(dir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

export function readProductSettlementLink(beianHao: string): ProductSettlementLink {
  const file = linkPath(beianHao)
  if (!existsSync(file)) return { ...DEFAULT_LINK }
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Partial<ProductSettlementLink>
    return {
      ...DEFAULT_LINK,
      ...raw,
      scheduleTime: normalizeScheduleTime(raw.scheduleTime || DEFAULT_LINK.scheduleTime),
    }
  } catch {
    return { ...DEFAULT_LINK }
  }
}

function writeProductSettlementLink(beianHao: string, link: ProductSettlementLink) {
  ensureDir(productDir(beianHao))
  writeFileSync(linkPath(beianHao), JSON.stringify(link, null, 2), "utf-8")
}

export function publicProductSettlementLink(beianHao: string): PublicProductSettlementLink {
  const link = readProductSettlementLink(beianHao)
  const linked = Boolean(link.userId && link.password)
  return {
    ...link,
    password: linked ? "••••••••" : "",
    linked,
  }
}

export function saveProductSettlementLink(
  beianHao: string,
  body: { userId?: string; password?: string; enabled?: boolean; scheduleTime?: string },
): PublicProductSettlementLink {
  const current = readProductSettlementLink(beianHao)
  const userId = (body.userId ?? current.userId).trim()
  if (!userId) throw new Error("请填写监控中心用户名")
  const password = isMaskedSecret(body.password) ? current.password : (body.password ?? "").trim()
  if (!password) throw new Error("请填写监控中心密码")
  const next: ProductSettlementLink = {
    ...current,
    userId,
    password,
    enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
    scheduleTime: body.scheduleTime ? normalizeScheduleTime(body.scheduleTime) : current.scheduleTime,
  }
  writeProductSettlementLink(beianHao, next)
  return publicProductSettlementLink(beianHao)
}

export function deleteProductSettlementLink(beianHao: string): PublicProductSettlementLink {
  const file = linkPath(beianHao)
  if (existsSync(file)) unlinkSync(file)
  return publicProductSettlementLink(beianHao)
}

export function listProductSettlementFiles(beianHao: string): ProductSettlementFile[] {
  const dir = filesDir(beianHao)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(isSpreadsheetName)
    .map((name) => {
      const full = path.join(dir, name)
      const stat = statSync(full)
      return {
        name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        source: /_\d{4}-\d{2}-\d{2}\.xls/i.test(name) ? "cfmmc" as const : "upload" as const,
      }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
}

export function readLatestAnalysis(beianHao: string): SettlementWorkbookAnalysis | null {
  const file = analysisPath(beianHao)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as SettlementWorkbookAnalysis
  } catch {
    return null
  }
}

function writeLatestAnalysis(beianHao: string, analysis: SettlementWorkbookAnalysis) {
  ensureDir(productDir(beianHao))
  writeFileSync(analysisPath(beianHao), JSON.stringify(analysis), "utf-8")
}

export function saveUploadedSettlementFile(beianHao: string, fileName: string, buffer: Buffer): string {
  const dir = filesDir(beianHao)
  ensureDir(dir)
  const base = path.basename(fileName).replace(/[^\w.\u4e00-\u9fff()-]+/g, "_")
  const ext = path.extname(base).toLowerCase()
  if (!SPREADSHEET_EXT.has(ext)) throw new Error("仅支持 xls / xlsx / xlsm / xlsb 结算单文件")
  const dest = path.join(dir, base || `settlement${ext}`)
  writeFileSync(dest, buffer)
  return path.basename(dest)
}

export function analyzeStoredSettlementFile(beianHao: string, fileName: string): SettlementWorkbookAnalysis {
  const full = safeResolveInDir(filesDir(beianHao), fileName)
  if (!full || !existsSync(full)) throw new Error("结算单文件不存在")
  const analysis = analyzeProductSettlementWorkbook(readFileSync(full), path.basename(full))
  writeLatestAnalysis(beianHao, analysis)
  return analysis
}

export function analyzeAndStoreSettlementBuffer(
  beianHao: string,
  fileName: string,
  buffer: Buffer,
): SettlementWorkbookAnalysis {
  const stored = saveUploadedSettlementFile(beianHao, fileName, buffer)
  const analysis = analyzeProductSettlementWorkbook(buffer, stored)
  writeLatestAnalysis(beianHao, analysis)
  return analysis
}

export async function loadProductSettlementMeta(beianHao: string): Promise<{
  beianHao: string
  productName: string
}> {
  const header = await lookupListCacheFundHeader(beianHao).catch(() => null)
  return {
    beianHao: safeBeian(beianHao),
    productName: header?.product_name?.trim() || header?.short_name?.trim() || beianHao,
  }
}

function pythonHasModule(python: string, moduleName: string): boolean {
  try {
    const r = spawnSync(python, ["-c", `import ${moduleName}`], {
      timeout: 8000,
      windowsHide: true,
      encoding: "utf8",
    })
    return r.status === 0
  } catch {
    return false
  }
}

function findPython(): string {
  const cwd = process.cwd()
  const preferred = [process.env.PYTHON_EXECUTABLE, process.env.PYTHON_EXE].filter(
    (p): p is string => !!p && p.trim().length > 0,
  )
  const local = process.platform === "win32"
    ? [path.join(cwd, ".venv", "Scripts", "python.exe")]
    : [path.join(cwd, ".venv", "bin", "python3"), path.join(cwd, ".venv", "bin", "python")]
  const fallback = process.platform === "win32" ? "python" : "python3"
  const candidates = [...new Set([...preferred, ...local.filter((p) => existsSync(p)), fallback])]
  return candidates.find((p) => pythonHasModule(p, "playwright")) || candidates[0] || fallback
}

function playwrightDirHasBrowser(dir: string): boolean {
  if (!dir || !path.isAbsolute(dir) || !existsSync(dir)) return false
  try {
    return readdirSync(dir).some((name) => name.startsWith("chromium"))
  } catch {
    return false
  }
}

function resolvePlaywrightBrowsersPath(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "ms-playwright")
      : "",
    process.platform === "win32"
      ? path.join(process.env.USERPROFILE || "", "ms-playwright")
      : path.join(process.env.HOME || "", ".cache", "ms-playwright"),
    path.join(process.cwd(), "ms-playwright"),
  ]
  return candidates.find((dir) => !!dir && playwrightDirHasBrowser(dir))
}

function runPythonLogged(
  python: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { env, windowsHide: true })
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error("获取超时")))
    }, timeoutMs)
    child.stdout.on("data", (buf: Buffer) => { stdout += buf.toString("utf8") })
    child.stderr.on("data", (buf: Buffer) => { stderr += buf.toString("utf8") })
    child.on("error", (err) => finish(() => reject(err)))
    child.on("close", (code) => {
      if (code === 0 || stdout.trim()) finish(() => resolve({ stdout, stderr }))
      else finish(() => reject(new Error(stderr.trim().slice(0, 800) || `exit ${code}`)))
    })
  })
}

function parseJsonLine(stdout: string): {
  ok: boolean
  filename?: string
  files?: string[]
  downloaded?: number
  skipped?: number
  discarded?: number
  error?: string
} {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
  const last = lines[lines.length - 1] ?? ""
  try {
    return JSON.parse(last) as {
      ok: boolean
      filename?: string
      files?: string[]
      downloaded?: number
      skipped?: number
      discarded?: number
      error?: string
    }
  } catch {
    throw new Error(stdout.trim() || "监控中心脚本无输出")
  }
}

function latestLocalFileDate(beianHao: string, userId: string): string | null {
  const files = listProductSettlementFiles(beianHao)
  const dates = files
    .map((f) => {
      const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const m = f.name.match(new RegExp(`${escaped}_(\\d{4}-\\d{2}-\\d{2})`))
      return m?.[1] ?? null
    })
    .filter((d): d is string => Boolean(d))
    .sort()
  return dates[dates.length - 1] ?? null
}

function analyzeLatestStoredFile(beianHao: string): SettlementWorkbookAnalysis | null {
  const files = listProductSettlementFiles(beianHao)
  if (files.length === 0) return null
  return analyzeStoredSettlementFile(beianHao, files[0].name)
}

export async function fetchProductSettlementFromCfmmc(
  beianHao: string,
  mode: "history" | "incremental" = "history",
): Promise<{
  ok: boolean
  filename?: string
  downloaded?: number
  skipped?: number
  discarded?: number
  analysis?: SettlementWorkbookAnalysis | null
  error?: string
}> {
  const link = readProductSettlementLink(beianHao)
  if (!link.userId || !link.password) throw new Error("请先关联监控中心账户")

  const script = path.join(process.cwd(), "scripts", "ma", "cfmmc_fetch.py")
  if (!existsSync(script)) throw new Error(`脚本不存在: ${script}`)

  const outDir = filesDir(beianHao)
  ensureDir(outDir)
  const python = findPython()
  const args = [script, "--out-dir", outDir]
  if (mode === "history") {
    args.push("--history", "--days", "65")
  } else {
    args.push("--incremental", "--days", "10")
    const since = latestLocalFileDate(beianHao, link.userId)
    if (since) args.push("--since", since)
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CFMMC_USER: link.userId,
    CFMMC_PASSWORD: link.password,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  }
  const browsers = resolvePlaywrightBrowsersPath()
  if (browsers) env.PLAYWRIGHT_BROWSERS_PATH = browsers
  else delete env.PLAYWRIGHT_BROWSERS_PATH

  const apply = (result: {
    ok: boolean
    filename?: string
    files?: string[]
    downloaded?: number
    skipped?: number
    discarded?: number
    error?: string
  }) => {
    const next = readProductSettlementLink(beianHao)
    next.lastFetchAt = new Date().toISOString()
    next.lastError = result.ok ? null : (result.error || "获取失败")
    if (result.ok) {
      next.lastFile = result.filename || next.lastFile
      next.lastFetchDate = shanghaiParts().dateKey
    }
    writeProductSettlementLink(beianHao, next)
    return result
  }

  try {
    const { stdout } = await runPythonLogged(
      python,
      args,
      env,
      mode === "history" ? 1_200_000 : 600_000,
    )
    const result = apply(parseJsonLine(stdout))
    if (!result.ok) return { ...result, analysis: readLatestAnalysis(beianHao) }
    const analysis = analyzeLatestStoredFile(beianHao)
    return {
      ok: true,
      filename: result.filename,
      downloaded: result.downloaded ?? result.files?.length ?? 0,
      skipped: result.skipped ?? 0,
      discarded: result.discarded ?? 0,
      analysis,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    apply({ ok: false, error: message })
    return { ok: false, error: message, analysis: readLatestAnalysis(beianHao) }
  }
}

function listLinkedProducts(): string[] {
  if (!existsSync(DATA_ROOT)) return []
  return readdirSync(DATA_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

export async function runDueProductSettlementCfmmcFetch(): Promise<void> {
  if (productFetchRunning) return
  const now = new Date()
  const due = listLinkedProducts().filter((beian) => {
    const link = readProductSettlementLink(beian)
    return link.enabled && link.userId && link.password && isDue(now, link.scheduleTime, link.lastFetchDate, link.lastFetchAt)
  })
  if (due.length === 0) return
  productFetchRunning = true
  try {
    for (const beian of due) {
      console.log(`[product-settlement] scheduled CFMMC fetch for ${beian}`)
      await fetchProductSettlementFromCfmmc(beian, "incremental").catch((e) => {
        console.error(`[product-settlement] fetch ${beian} failed:`, e)
      })
    }
  } finally {
    productFetchRunning = false
  }
}
