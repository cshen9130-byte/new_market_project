/**
 * One-time: extract unique fund names from email_classify_export_*.csv
 * Usage: npx tsx scripts/ma/extract_unique_fund_names_from_export.ts [input.csv] [output.csv]
 */
import fs from "fs"
import path from "path"
import { normalizeFundDisplayName } from "../../lib/server/email-nav-extract"

const FUND_NAME_RE =
  /[\u4e00-\u9fffA-Za-z0-9（）()·\-—－]+(?:私募证券投资基金|私募基金|证券投资基金|投资基金)(?:[ABC]类|[ABC])?/gu

const FUND_LIKE_RE =
  /(?:\d+号|[ABC]类|FOF|一号|二号|三号|四号|五号|六号|七号|八号|九号|十号|精选|成长|对冲|量化|CTA|基石|共赢|恒盈|优选|专享|稳健|增强|轮动|文艺复兴|渊流|木盛|江月|豪鑫|九紫|泰来|核心|赤壁)/u

const FUND_EMAIL_CATEGORIES = new Set([
  "ta",
  "custodian",
  "nav",
  "valuation",
  "virtual_nav",
  "performance_fee",
  "ledger",
  "settlement",
])

const JUNK_RE =
  /有限公司|有限合伙|猎聘|入职|应聘|招聘|人事|HR|感谢应聘|推荐您|邀请您|交易确认|已为您|管理人旗下|对账单|当日交易|历史交易|私募基金管理|合伙企业|虚拟净值-|Auto-Disclosure|投资者交易|信息披露|净值表发送|系数股权|宽投资产|中投中天|入职事宜|入职状态|课程|验证邮件|欢迎使用|激活邮件/i

function isValidFundName(name: string): boolean {
  if (!name || JUNK_RE.test(name)) return false
  if (/^上海|^深圳|^北京|^广州|^杭州/.test(name) && !/\d+号|FOF|[ABC]类/.test(name)) return false

  const hasLegalSuffix = /(?:私募证券投资基金|私募基金|证券投资基金|投资基金)/.test(name)
  if (hasLegalSuffix) return true

  // Short display names used in this portfolio: must contain 号, FOF, or share class.
  if (/FOF\d*号/u.test(name)) return true
  if (/[ABC]类$/u.test(name) && /[\u4e00-\u9fffA-Za-z0-9]{2,}/u.test(name)) return true
  if (/\d+号/u.test(name) && name.length >= 4 && name.length <= 40) return true
  if (/^(?:一|二|三|四|五|六|七|八|九|十)+号$/u.test(name)) return true

  return false
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function latestExportFile(cwd: string): string {
  const files = fs
    .readdirSync(cwd)
    .filter((f) => f.startsWith("email_classify_export_") && f.endsWith(".csv"))
    .sort()
  if (files.length === 0) throw new Error("No email_classify_export_*.csv found in workspace")
  return path.join(cwd, files.at(-1)!)
}

/** Strip leading product codes like SBPV73, SH1956, NW169B, SSG947- */
function stripLeadingProductCode(s: string): string {
  let out = s.trim()
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/^[A-Z]{2,8}\d{0,6}[A-Z]?[-_—－]?\s*/i, "")
    if (next === out) break
    out = next
  }
  return out
}

/** Strip dates, product codes, brackets, custodian prefixes; extract embedded fund name. */
function canonicalizeFundName(raw: string, trusted = false): string | null {
  let s = raw.trim()
  if (!s || JUNK_RE.test(s)) return null

  s = s
    .replace(/^[（(][^）)]*[）)]\s*/u, "")
    .replace(/^\d{4}年\d{1,2}月\d{1,2}日/u, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s*/u, "")
    .replace(/^虚拟净值[-_—－]\s*/u, "")

  s = stripLeadingProductCode(s)

  const embedded = [...s.matchAll(FUND_NAME_RE)].map((m) => m[0])
  if (embedded.length > 0) {
    s = embedded.sort((a, b) => b.length - a.length)[0]
  } else if (!trusted) {
    s = stripLeadingProductCode(s).replace(/^国泰海通/u, "")
  }

  s = normalizeFundDisplayName(s.trim())
  s = stripLeadingProductCode(s)
  if (!s || s.length < 2 || JUNK_RE.test(s)) return null
  if (trusted) return s
  if (!isValidFundName(s)) return null
  return s
}

/** Merge share-class variants and minor spelling variants. */
function dedupeKey(name: string): string {
  return name
    .replace(/[ABC]类$/u, "")
    .replace(/私募$/u, "")
    .replace(/\s+/g, "")
    .replace(/^国泰海通/u, "")
    .toLowerCase()
}

function sourcePriority(source: string): number {
  if (source === "fof_mother") return 4
  if (source === "fof_sub") return 3
  if (source === "fund_name") return 2
  return 1
}

function displayScore(name: string, mentions: number, maxSourcePriority: number): number {
  let score = mentions * 10 + maxSourcePriority * 1000
  if (/[ABC]类$/u.test(name)) score += 50
  if (/^\d{4}年/.test(name) || /^[A-Z0-9]{4,}/i.test(name)) score -= 500
  if (/^[（(]/.test(name)) score -= 500
  if (name.length < 8) score -= 20
  return score
}

function main() {
  const cwd = process.cwd()
  const inputPath = process.argv[2] ? path.resolve(cwd, process.argv[2]) : latestExportFile(cwd)
  const outputPath = process.argv[3]
    ? path.resolve(cwd, process.argv[3])
    : path.join(cwd, "email_unique_fund_names.csv")

  const text = fs.readFileSync(inputPath, "utf-8").replace(/^\uFEFF/, "")
  const lines = text.split(/\r?\n/).filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx = {
    subject: headers.indexOf("subject"),
    category: headers.indexOf("category"),
    mother: headers.indexOf("fof_mother_fund_name"),
    sub: headers.indexOf("fof_sub_fund_name"),
    fund: headers.indexOf("fund_name"),
  }

  type Variant = { name: string; source: string; mentions: number }
  const groups = new Map<string, Variant[]>()

  function add(raw: string, source: string) {
    const trusted = source === "fof_mother" || source === "fof_sub"
    const name = canonicalizeFundName(raw, trusted)
    if (!name) return
    const key = dedupeKey(name)
    if (!key) return
    const list = groups.get(key) ?? []
    const existing = list.find((v) => v.name === name && v.source === source)
    if (existing) {
      existing.mentions += 1
    } else {
      list.push({ name, source, mentions: 1 })
    }
    groups.set(key, list)
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const category = (cols[idx.category] ?? "").trim()

    for (const [col, tag] of [
      [idx.mother, "fof_mother"],
      [idx.sub, "fof_sub"],
    ] as const) {
      const v = cols[col]?.trim()
      if (v) add(v, tag)
    }

    if (FUND_EMAIL_CATEGORIES.has(category)) {
      const v = cols[idx.fund]?.trim()
      if (v) add(v, "fund_name")

      const subject = cols[idx.subject] ?? ""
      for (const m of subject.matchAll(FUND_NAME_RE)) add(m[0], "subject")
    }
  }

  const rows = [...groups.entries()]
    .map(([key, variants]) => {
      const totalMentions = variants.reduce((s, v) => s + v.mentions, 0)
      const sources = [...new Set(variants.map((v) => v.source))].sort()
      const maxSourcePriority = Math.max(...variants.map((v) => sourcePriority(v.source)))
      const canonical = variants
        .slice()
        .sort(
          (a, b) =>
            displayScore(b.name, b.mentions, sourcePriority(b.source))
            - displayScore(a.name, a.mentions, sourcePriority(a.source)),
        )[0].name
      const aliases = [...new Set(variants.map((v) => v.name))]
        .filter((n) => n !== canonical)
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
      return { key, canonical, aliases, sources, totalMentions }
    })
    .sort((a, b) => a.canonical.localeCompare(b.canonical, "zh-CN"))

  const outLines = [
    "fund_name,aliases,sources,email_mentions",
    ...rows.map((r) =>
      [
        csvEscape(r.canonical),
        csvEscape(r.aliases.join(" | ")),
        csvEscape(r.sources.join(";")),
        String(r.totalMentions),
      ].join(","),
    ),
  ]
  fs.writeFileSync(outputPath, `\uFEFF${outLines.join("\n")}\n`, "utf-8")

  console.log(`Input:  ${inputPath}`)
  console.log(`Output: ${outputPath}`)
  console.log(`Unique fund names: ${rows.length}`)
}

main()
