/**
 * 银河期货结算邮件抓取
 * 发件人: galaxyfutures_data@vip.126.com
 * 主题: YYYYMMDD银河期货结算单-账号 / YYYYMMDD银河期货结单-账号
 * 附件: Daily Account Statement ByTrade *.TXT、*结算单*.xls、*持仓*.xls、*成交*.xls
 */

import fs from "fs"
import path from "path"
import { ImapFlow } from "imapflow"

export type YinheEmailConfig = {
  email: string
  pass: string
  imapHost: string
  imapPort: number
  sender: string
  subjectIncludes: string
  lookbackDays: number
  lastFetchAt: string | null
}

export type YinheFetchResult = {
  downloaded: string[]
  skipped: string[]
  errors: string[]
  log: string[]
  folder: string
}

const CONFIG_FILE = path.join(process.cwd(), "data", "yinhe_settlement_email_config.json")

const DEFAULT_CONFIG: YinheEmailConfig = {
  email: "",
  pass: "",
  imapHost: "imap.exmail.qq.com",
  imapPort: 993,
  sender: "galaxyfutures_data@vip.126.com",
  subjectIncludes: "银河期货",
  lookbackDays: 120,
  lastFetchAt: null,
}

export function getYinheDownloadDir(): string {
  return (
    process.env.YINHE_SETTLEMENT_DOWNLOAD_DIR ??
    path.join(
      process.env.MOM_DATA_DIR
        ? path.dirname(process.env.MOM_DATA_DIR)
        : path.join(process.cwd(), "..", "mom_data"),
      "银河期货结算单",
    )
  )
}

export function readYinheEmailConfig(): YinheEmailConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<YinheEmailConfig>
    return { ...DEFAULT_CONFIG, ...raw }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function writeYinheEmailConfig(cfg: YinheEmailConfig): void {
  const dir = path.dirname(CONFIG_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf-8")
}

const ATTACH_EXT = /\.(txt|xls|xlsx)$/i

function isYinheAttachment(filename: string): boolean {
  if (!ATTACH_EXT.test(filename)) return false
  const name = filename.toLowerCase()
  return (
    name.includes("daily account statement") ||
    name.includes("结算单") ||
    name.includes("持仓") ||
    name.includes("成交") ||
    /\d{5,}/.test(name)
  )
}

interface BodyPart {
  part: string
  filename: string
}

function collectAttachmentParts(
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
  const decoded = decodeMimeFilename(fname)
  if (decoded && isYinheAttachment(decoded)) {
    out.push({ part: pathStr || "1", filename: decoded })
  }
  if (Array.isArray(node.childNodes)) {
    node.childNodes.forEach((child: unknown, i: number) => {
      collectAttachmentParts(child, pathStr ? `${pathStr}.${i + 1}` : `${i + 1}`, out)
    })
  }
  return out
}

/** Decode RFC2047 / URL-encoded attachment filenames when present. */
function decodeMimeFilename(raw: string): string {
  if (!raw) return ""
  try {
    const rfc2047 = raw.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_m, _cs, enc, data) => {
      if (String(enc).toLowerCase() === "b") {
        return Buffer.from(String(data), "base64").toString("utf8")
      }
      const q = String(data).replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      )
      return q
    })
    if (rfc2047 !== raw) return rfc2047.trim()
  } catch {
    /* ignore */
  }
  try {
    if (/%[0-9A-Fa-f]{2}/.test(raw)) return decodeURIComponent(raw)
  } catch {
    /* ignore */
  }
  return raw.trim()
}

function subjectMatches(subject: string, cfg: YinheEmailConfig): boolean {
  const s = subject || ""
  const needle = (cfg.subjectIncludes || "银河期货").trim()
  if (needle && !s.includes(needle)) return false
  // Prefer the dated settlement subject pattern, but allow needle-only match.
  if (/银河期货结[算]?单/.test(s)) return true
  return Boolean(needle) && s.includes(needle)
}

export async function fetchYinheSettlementEmails(
  options?: { lookbackDays?: number },
): Promise<YinheFetchResult> {
  const cfg = readYinheEmailConfig()
  if (!cfg.email || !cfg.pass) {
    throw new Error("未配置银河期货结算邮箱账号或授权码，请先在本页保存邮箱配置。")
  }

  const dlDir = getYinheDownloadDir()
  if (!fs.existsSync(dlDir)) fs.mkdirSync(dlDir, { recursive: true })

  const lookback = options?.lookbackDays ?? cfg.lookbackDays ?? 120
  const client = new ImapFlow({
    host: cfg.imapHost || "imap.exmail.qq.com",
    port: cfg.imapPort || 993,
    secure: true,
    auth: { user: cfg.email, pass: cfg.pass },
    logger: false,
  })

  const downloaded: string[] = []
  const skipped: string[] = []
  const errors: string[] = []
  const log: string[] = []

  await client.connect()
  try {
    await client.mailboxOpen("INBOX")

    const since = new Date()
    since.setDate(since.getDate() - Math.max(1, lookback))

    const senderFilter = (cfg.sender ?? "").trim().toLowerCase()
    const allUids = await client.search({ since })
    log.push(`收件箱最近 ${lookback} 天共 ${allUids.length} 封邮件`)
    if (senderFilter) log.push(`发件人过滤: ${senderFilter}`)

    for (const uid of allUids) {
      const envMsg = await client.fetchOne(String(uid), { envelope: true })
      const envelope = (
        envMsg as {
          envelope?: { subject?: string; from?: { address?: string }[]; date?: Date }
        }
      ).envelope
      const subject = envelope?.subject ?? ""
      const fromAddresses = (envelope?.from ?? []).map((f) => (f.address ?? "").toLowerCase())

      if (senderFilter) {
        const matchesSender = fromAddresses.some(
          (addr) => addr.includes(senderFilter) || senderFilter.includes(addr),
        )
        if (!matchesSender) continue
      }

      if (!subjectMatches(subject, cfg)) continue

      log.push(`匹配邮件: ${fromAddresses.join(", ")} | ${subject}`)

      const bodyMsg = await client.fetchOne(String(uid), { bodyStructure: true })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const structure = (bodyMsg as any).bodyStructure
      if (!structure) continue

      const parts = collectAttachmentParts(structure)
      if (parts.length === 0) {
        log.push(`  → 无匹配附件，跳过`)
        continue
      }
      log.push(`  → 找到 ${parts.length} 个附件`)

      // Prefer date from subject (YYYYMMDD…) for stable folder names
      const dateMatch = subject.match(/(\d{8})/)
      const dateTag = dateMatch?.[1] ?? "unknown"

      for (const { part, filename } of parts) {
        try {
          const dl = await client.download(String(uid), part)
          const chunks: Buffer[] = []
          for await (const chunk of dl.content) chunks.push(Buffer.from(chunk))
          const buf = Buffer.concat(chunks)

          const safeName = filename.replace(/[\\/:*?"<>|]/g, "_")
          const outName = `${dateTag}__${safeName}`
          const outPath = path.join(dlDir, outName)
          if (fs.existsSync(outPath) && fs.statSync(outPath).size === buf.length) {
            skipped.push(`${outName} (已存在)`)
            continue
          }
          fs.writeFileSync(outPath, buf)
          downloaded.push(outName)
          log.push(`  → 保存 ${outName} (${buf.length} bytes)`)
        } catch (e) {
          errors.push(`${filename}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } finally {
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
  }

  writeYinheEmailConfig({ ...cfg, lastFetchAt: new Date().toISOString() })
  return { downloaded, skipped, errors, log, folder: dlDir }
}

export function listYinheDownloadedFiles(): { files: { name: string; size: number; mtime: string }[]; folder: string } {
  const folder = getYinheDownloadDir()
  if (!fs.existsSync(folder)) return { files: [], folder }
  const files = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && ATTACH_EXT.test(e.name))
    .map((e) => {
      const stat = fs.statSync(path.join(folder, e.name))
      return { name: e.name, size: stat.size, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
  return { files, folder }
}
