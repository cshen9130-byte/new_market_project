import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import { ImapFlow } from "imapflow"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettlementEmailConfig = {
  email: string
  pass: string
  imapHost: string
  imapPort: number
  enabled: boolean
  scheduleTime: string        // HH:MM (24h), e.g. "19:00"
  lastFetchDate: string | null  // YYYYMMDD
  lastFetchAt: string | null    // ISO timestamp
}

export type FetchResult = {
  downloaded: string[]
  skipped: string[]
  errors: string[]
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

// ─── XLSX A3 check ───────────────────────────────────────────────────────────

function isSettlementDingshi(buf: Buffer): boolean {
  try {
    const wb = XLSX.read(buf, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) return false
    const cell = ws["A3"]
    if (!cell) return false
    const val = String(cell.v ?? "").trim()
    // Accept both full-width （盯市） and half-width (盯市)
    return val.includes("交易结算单") && val.includes("盯市")
  } catch {
    return false
  }
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

  const client = new ImapFlow({
    host: cfg.imapHost || "imap.163.com",
    port: cfg.imapPort || 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.pass },
    logger: false,
  })

  const downloaded: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  await client.connect()
  try {
    await client.mailboxOpen("INBOX")

    // Look back 2 days to catch after-hours / next-morning delivery
    const since = new Date()
    since.setDate(since.getDate() - 2)

    const allUids = await client.search({ since })

    for (const uid of allUids) {
      // First: cheap envelope fetch to filter by subject
      const envelope = await client.fetchOne(String(uid), { envelope: true })
      const subj: string = (envelope as { envelope?: { subject?: string } }).envelope?.subject ?? ""

      // Pattern: YYYYMMDD_<digits>_交易结算单
      if (!subj.includes("交易结算单") || !/\d{8}_\d+_交易结算单/.test(subj)) continue

      // Second: fetch body structure to find xlsx attachments
      const bodyMsg = await client.fetchOne(String(uid), { bodyStructure: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structure = (bodyMsg as any).bodyStructure
      if (!structure) continue

      const parts = collectXlsxParts(structure)
      if (parts.length === 0) continue

      for (const { part, filename } of parts) {
        try {
          const dl = await client.download(String(uid), part)
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
          const buf = Buffer.concat(chunks)

          if (!isSettlementDingshi(buf)) {
            skipped.push(filename)
            continue
          }

          const outPath = path.join(dlDir, filename)
          fs.writeFileSync(outPath, buf)
          downloaded.push(filename)
        } catch (e) {
          errors.push(`${filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } finally {
    await client.logout()
  }

  // Record last fetch
  const now = new Date()
  writeConfig({
    ...cfg,
    lastFetchDate: downloaded.length > 0 ? formatLocalDate(now) : cfg.lastFetchDate,
    lastFetchAt: now.toISOString(),
  })

  return { downloaded, skipped, errors }
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
