import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { closeImapFlow, createSafeImapFlow } from "@/lib/server/imap-flow-safe"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettlementEmailConfig = {
  email: string
  pass: string
  imapHost: string
  imapPort: number
  enabled: boolean
  scheduleTime: string        // HH:MM (24h), e.g. "19:00"
  sender: string              // Filter by sender address (leave empty for legacy subject filter)
  lastFetchDate: string | null  // YYYYMMDD
  lastFetchAt: string | null    // ISO timestamp
}

export type FetchResult = {
  downloaded: string[]
  skipped: string[]
  errors: string[]
  log: string[]
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), "data", "settlement_email_config.json")

const SETTLEMENT_DIR =
  process.env.SETTLEMENT_DOWNLOAD_DIR ??
  path.join(
    process.env.MOM_DATA_DIR
      ? path.dirname(process.env.MOM_DATA_DIR)   // MOM_DATA_DIR = .../mom_data/03.投顾逐日 → go up to mom_data
      : path.join(process.cwd(), "..", "mom_data"),
    "交易结算单",
  )

const DEFAULT_CONFIG: SettlementEmailConfig = {
  email: "",
  pass: "",
  imapHost: "imap.163.com",
  imapPort: 993,
  enabled: false,
  scheduleTime: "19:00",
  sender: "",
  lastFetchDate: null,
  lastFetchAt: null,
}

const AUTO_FETCH_RETRY_INTERVAL_MS = 60 * 60 * 1000

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
}

// ─── Config I/O ──────────────────────────────────────────────────────────────

export function readConfig(): SettlementEmailConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<SettlementEmailConfig>
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeConfig(cfg: SettlementEmailConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8")
}

// ─── XLSX A3 / N5 reader ─────────────────────────────────────────────────────

/**
 * Returns { a3, n5 } from the first sheet, or null if A3 doesn't match.
 * a3: trimmed value of cell A3 (e.g. "交易结算单(盯市)")
 * n5: date string derived from cell N5 (formatted as YYYYMMDD), or "" if missing
 */
export function readSettlementCells(buf: Buffer): { a3: string; n5: string } | null {
  try {
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return null

    const cellA3 = ws["A3"]
    if (!cellA3) return null
    const a3 = String(cellA3.v ?? "").trim()
    if (!a3.includes("交易结算单") || !a3.includes("盯市")) return null

    // N5: may be a Date object (cellDates:true), a serial number, or a string
    let n5 = ""
    const cellN5 = ws["N5"]
    if (cellN5) {
      const raw = cellN5.v
      if (raw instanceof Date) {
        const y = raw.getFullYear()
        const m = String(raw.getMonth() + 1).padStart(2, "0")
        const d = String(raw.getDate()).padStart(2, "0")
        n5 = `${y}${m}${d}`
      } else if (typeof raw === "number") {
        // Excel date serial → JS Date
        const d = XLSX.SSF.parse_date_code(raw)
        if (d) n5 = `${d.y}${String(d.m).padStart(2, "0")}${String(d.d).padStart(2, "0")}`
      } else if (typeof raw === "string") {
        // Try to extract 8-digit date string, e.g. "2026/04/20" or "20260420"
        const digits = raw.replace(/\D/g, "")
        if (digits.length >= 8) n5 = digits.slice(0, 8)
      }
    }

    return { a3, n5 }
  } catch {
    return null
  }
}

/**
 * Build a stable output filename from A3 + N5.
 * e.g. "交易结算单(盯市)_20260420.xlsx"
 * Falls back to original attachment filename if N5 is empty.
 */
export function buildOutputFilename(cells: { a3: string; n5: string }, fallback: string): string {
  // Sanitise A3 for use as a filename segment (strip path-unsafe chars)
  const a3safe = cells.a3.replace(/[\\/:*?"<>|]/g, "")
  if (cells.n5) return `${a3safe}_${cells.n5}.xlsx`
  // If no date from N5, keep the original name
  return fallback.toLowerCase().endsWith(".xlsx") ? fallback : `${fallback}.xlsx`
}

// ─── IMAP body part collector ────────────────────────────────────────────────

interface BodyPart {
  part: string
  filename: string
}

function collectXlsxParts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  pathStr = "",
  out: BodyPart[] = [],
): BodyPart[] {
  const fname: string =
    node.dispositionParameters?.filename ??
    node.dispositionParameters?.name ??
    node.parameters?.name ??
    ""
  const disp: string = (node.disposition ?? "").toLowerCase()

  if (fname && (disp === "attachment" || fname) && fname.toLowerCase().endsWith(".xlsx")) {
    out.push({ part: pathStr || "1", filename: fname })
  }

  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectXlsxParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

// ─── Main fetch function ──────────────────────────────────────────────────────

export async function fetchSettlementFiles(): Promise<FetchResult> {
  const cfg = readConfig()
  if (!cfg.email || !cfg.pass) throw new Error("未配置邮箱账号或密码")

  const dlDir = SETTLEMENT_DIR
  if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true })

  const client = createSafeImapFlow({
    host: cfg.imapHost || "imap.163.com",
    port: cfg.imapPort || 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.pass },
    logger: false,
    label: cfg.email,
  })

  const downloaded: string[] = []
  const skipped: string[] = []
  const errors: string[] = []
  const log: string[] = []

  try {
    await client.connect()
    await client.mailboxOpen("INBOX")

    // Look back 3 days to catch after-hours / next-morning delivery
    const since = new Date()
    since.setDate(since.getDate() - 3)

    const senderFilter = (cfg.sender ?? "").trim().toLowerCase()

    // Always search by date only — server-side FROM search is unreliable on some IMAP servers.
    // We do sender matching client-side from the envelope instead.
    const allUids = await client.search({ since })
    log.push(`收件箱最近3天共 ${allUids.length} 封邮件`)
    if (senderFilter) log.push(`发件人过滤: ${senderFilter}`)

    for (const uid of allUids) {
      // Always fetch envelope: needed for both sender check and subject fallback
      const envMsg = await client.fetchOne(String(uid), { envelope: true })
      const envelope = (envMsg as { envelope?: { subject?: string; from?: { address?: string }[] } }).envelope

      // Sender filter: if configured, skip emails from other senders
      if (senderFilter) {
        const fromAddresses = (envelope?.from ?? []).map((f) => (f.address ?? "").toLowerCase())
        const matchesSender = fromAddresses.some((addr) => addr.includes(senderFilter) || senderFilter.includes(addr))
        if (!matchesSender) continue
        log.push(`匹配发件人: ${fromAddresses.join(", ")} | 主题: ${envelope?.subject ?? "(无主题)"}`)
      } else {
        // Legacy fallback: require subject to match YYYYMMDD_<digits>_交易结算单
        const subj: string = envelope?.subject ?? ""
        if (!subj.includes("交易结算单") || !/\d{8}_\d+_交易结算单/.test(subj)) continue
      }

      // Fetch body structure to find xlsx attachments
      const bodyMsg = await client.fetchOne(String(uid), { bodyStructure: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structure = (bodyMsg as any).bodyStructure
      if (!structure) continue

      const parts = collectXlsxParts(structure)
      if (parts.length === 0) {
        log.push(`  → 无 xlsx 附件，跳过`)
        continue
      }
      log.push(`  → 找到 ${parts.length} 个 xlsx 附件`)

      for (const { part, filename } of parts) {
        try {
          const dl = await client.download(String(uid), part)
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
          const buf = Buffer.concat(chunks)

          // A3 cell is the sole content gate: must contain both 交易结算单 and 盯市
          const cells = readSettlementCells(buf)
          if (!cells) {
            log.push(`  → ${filename}: A3 不含"交易结算单(盯市)"，跳过`)
            skipped.push(filename)
            continue
          }

          const outName = buildOutputFilename(cells, filename)
          log.push(`  → ${filename}: A3="${cells.a3}" N5="${cells.n5}" → 保存为 ${outName}`)
          const outPath = path.join(dlDir, outName)
          // Skip if already downloaded
          if (fs.existsSync(outPath)) {
            skipped.push(`${outName} (已存在)`)
            continue
          }
          fs.writeFileSync(outPath, buf)
          downloaded.push(outName)
        } catch (e) {
          errors.push(`${filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } finally {
    await closeImapFlow(client)
  }

  // Record last fetch
  const now = new Date()
  writeConfig({
    ...cfg,
    lastFetchDate: downloaded.length > 0 ? formatLocalDate(now) : cfg.lastFetchDate,
    lastFetchAt: now.toISOString(),
  })

  return { downloaded, skipped, errors, log }
}

// ─── Scheduler trigger (called every minute from instrumentation) ─────────────

export async function runDueSettlementFetch(): Promise<void> {
  const cfg = readConfig()
  if (!cfg.enabled || !cfg.email || !cfg.pass) return

  const now = new Date()
  const [schedH, schedM] = (cfg.scheduleTime || "19:00").split(":").map(Number)

  const todayStr = formatLocalDate(now)
  if (cfg.lastFetchDate === todayStr) return // already fetched today

  if (now.getHours() < schedH || (now.getHours() === schedH && now.getMinutes() < schedM)) return

  const lastFetchAt = cfg.lastFetchAt ? new Date(cfg.lastFetchAt) : null
  if (lastFetchAt && !Number.isNaN(lastFetchAt.getTime()) && formatLocalDate(lastFetchAt) === todayStr) {
    // Retry later if the scheduled check ran before the settlement email arrived.
    if (now.getTime() - lastFetchAt.getTime() < AUTO_FETCH_RETRY_INTERVAL_MS) return
  }

  await fetchSettlementFiles()
}

// ─── List downloaded files ────────────────────────────────────────────────────

export type DownloadedFile = {
  name: string
  size: number
  mtime: string  // ISO timestamp
}

export function listDownloadedFiles(): { files: DownloadedFile[]; folder: string } {
  const cfg = readConfig()
  const folder = SETTLEMENT_DIR

  if (!fs.existsSync(folder)) return { files: [], folder }

  const entries = fs.readdirSync(folder, { withFileTypes: true })
  const files: DownloadedFile[] = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".xlsx"))
    .map((e) => {
      const stat = fs.statSync(path.join(folder, e.name))
      return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))

  return { files, folder }
}
