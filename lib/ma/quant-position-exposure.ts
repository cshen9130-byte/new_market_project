/**
 * 量化组合当日持仓方向暴露.
 * Net exposure is long market value minus short market value.
 * Amounts stay in yuan until a cell rounds them to 万元.
 */

export const POSITION_SECTORS = [
  { key: "有色", label: "有色" },
  { key: "贵金属", label: "贵金属" },
  { key: "黑色", label: "黑色" },
  { key: "能源化工", label: "能化" },
  { key: "农产", label: "农产" },
  { key: "生鲜", label: "生鲜" },
  { key: "股指", label: "股指" },
  { key: "新能源", label: "新能源" },
  { key: "国债", label: "债券" },
  { key: "航运", label: "航运" },
] as const

const SECTOR_LABEL = new Map<string, string>(POSITION_SECTORS.map((s) => [s.key, s.label]))
const WAN = 10_000
const MIN_GROSS = WAN
const SPLIT_WAN = 100
const CONFLICT_ACCOUNT_WAN = 100
const CONFLICT_BOOK_WAN = 50

export type ExposureLeg = {
  id: string
  label: string
  advisor: string | null
  source: "mom" | "cfmmc"
  brokerLabel: string | null
  /** Position or settlement rows exist on the book date. */
  onBook: boolean
  latest: string | null
  longBySector: Record<string, number>
  shortBySector: Record<string, number>
  /** null when the day's sector pnl cannot be computed (no previous floating book). */
  pnlBySector: Record<string, number> | null
  dailyPnl: number | null
  equity: number | null
  riskPct: number | null
}

export type PositionExposureRow = {
  id: string
  label: string
  advisor: string | null
  source: "mom" | "cfmmc"
  brokerLabel: string | null
  nets: Record<string, number>
  longs: Record<string, number>
  shorts: Record<string, number>
  sectorPnl: Record<string, number> | null
  net: number
  gross: number
  dailyPnl: number | null
  equity: number | null
  riskPct: number | null
}

export type PositionConflict = {
  account: string
  label: string
  advisor: string | null
  sector: string
  sectorLabel: string
  accountNet: number
  bookNet: number
  sectorPnl: number | null
}

export type PositionExposure = {
  date: string | null
  sectors: { key: string; label: string }[]
  rows: PositionExposureRow[]
  total: {
    nets: Record<string, number>
    longs: Record<string, number>
    shorts: Record<string, number>
    net: number
    gross: number
    dailyPnl: number | null
  }
  conflicts: PositionConflict[]
  bullets: { title: string; text: string }[]
  footnotes: string[]
}

/** Collapse a long fund name to the product token. Short names stay as written. */
export function shortBookName(name: string | null | undefined): string | null {
  const text = (name ?? "").replace(/\s+/g, "")
  if (!text) return null
  if ([...text].length <= 8) return text
  const matched = text.match(/([\u4e00-\u9fff]{2,16})(?:\d+号)?私募/)
  if (matched?.[1]) {
    const tail = matched[1].split(/公司|管理|资产/).filter(Boolean).pop() || matched[1]
    if ([...tail].length >= 2 && [...tail].length <= 8) return tail
  }
  return text
}

export function isOptionContract(contract: string): boolean {
  const s = contract.trim().toUpperCase()
  if (!s) return false
  if (/\d[CP]\d/.test(s)) return true
  return (s.match(/-/g) ?? []).length >= 2
}

function groupInt(n: number): string {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function fmtWanCell(yuan: number): string {
  if (!Number.isFinite(yuan) || Math.abs(yuan) < WAN) return "—"
  const n = Math.round(yuan / WAN)
  if (n === 0) return "—"
  return `${n > 0 ? "+" : "-"}${groupInt(n)}`
}

export function fmtGrossCell(yuan: number): string {
  if (!Number.isFinite(yuan)) return "—"
  return groupInt(Math.round(yuan / WAN))
}

export function fmtYuanCell(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return "—"
  const n = Math.round(yuan)
  if (n === 0) return "0"
  return `${n > 0 ? "+" : "-"}${groupInt(n)}`
}

function fmtWan1(yuan: number): string {
  const wan = yuan / WAN
  const sign = wan > 0 ? "+" : wan < 0 ? "-" : ""
  return `${sign}${Math.abs(wan).toFixed(1)}万`
}

function fmtWanIntSigned(yuan: number): string {
  const n = Math.round(yuan / WAN)
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  return `${sign}${groupInt(n)}万`
}

/**
 * Sector net as a percent of this account's gross book.
 * The sign is the net's sign. A book that is N times larger, with the same mix, shows the same percents.
 * Cells under 1 万 stay blank, matching the yuan view.
 */
export function fmtBookShare(net: number, gross: number): string {
  if (!Number.isFinite(net) || !Number.isFinite(gross) || !(gross > 0) || Math.abs(net) < WAN) return "—"
  const pct = (net / gross) * 100
  const digits = Math.abs(pct) >= 1 ? 1 : 2
  const text = Math.abs(pct).toFixed(digits)
  if (Number(text) === 0) return "—"
  const sign = pct > 0 ? "+" : "-"
  return `${sign}${text}%`
}

function sectorLabel(key: string): string {
  return SECTOR_LABEL.get(key) ?? key
}

function sumRecord(rec: Record<string, number> | undefined): number {
  if (!rec) return 0
  let n = 0
  for (const v of Object.values(rec)) n += v
  return n
}

function emptyTotal(): PositionExposure["total"] {
  return { nets: {}, longs: {}, shorts: {}, net: 0, gross: 0, dailyPnl: null }
}

function rowFromLeg(leg: ExposureLeg): PositionExposureRow {
  const keys = new Set([...Object.keys(leg.longBySector), ...Object.keys(leg.shortBySector)])
  const nets: Record<string, number> = {}
  const longs: Record<string, number> = {}
  const shorts: Record<string, number> = {}
  let net = 0
  let gross = 0
  for (const key of keys) {
    const longMv = leg.longBySector[key] ?? 0
    const shortMv = leg.shortBySector[key] ?? 0
    if (longMv) longs[key] = longMv
    if (shortMv) shorts[key] = shortMv
    const sectorNet = longMv - shortMv
    if (sectorNet) nets[key] = sectorNet
    net += sectorNet
    gross += longMv + shortMv
  }
  return {
    id: leg.id,
    label: leg.label,
    advisor: leg.advisor,
    source: leg.source,
    brokerLabel: leg.brokerLabel,
    nets,
    longs,
    shorts,
    sectorPnl: leg.pnlBySector,
    net,
    gross,
    dailyPnl: leg.dailyPnl,
    equity: leg.equity,
    riskPct: leg.riskPct,
  }
}

function accountTag(row: PositionExposureRow): string {
  const pnl = fmtYuanCell(row.dailyPnl)
  if (row.advisor && row.dailyPnl != null) return `${row.label}（${row.advisor}，${pnl}）`
  if (row.advisor) return `${row.label}（${row.advisor}）`
  if (row.dailyPnl != null) return `${row.label}（${pnl}）`
  return row.label
}

function topSectors(
  pnl: Record<string, number> | null,
  sign: "loss" | "gain",
  limit: number,
): { key: string; pnl: number }[] {
  if (!pnl) return []
  const rows = Object.entries(pnl)
    .filter(([, v]) => Math.abs(v) >= 1000 && (sign === "loss" ? v < 0 : v > 0))
    .map(([key, value]) => ({ key, pnl: value }))
  rows.sort((a, b) => (sign === "loss" ? a.pnl - b.pnl : b.pnl - a.pnl))
  return rows.slice(0, limit)
}

function buildConflicts(rows: PositionExposureRow[]): PositionConflict[] {
  const conflicts: PositionConflict[] = []
  for (const sector of POSITION_SECTORS) {
    const book = rows.reduce((sum, row) => sum + (row.nets[sector.key] ?? 0), 0)
    const bookWan = Math.round(book / WAN)
    if (Math.abs(bookWan) < CONFLICT_BOOK_WAN) continue
    for (const row of rows) {
      const net = row.nets[sector.key] ?? 0
      const wan = Math.round(net / WAN)
      if (Math.abs(wan) < CONFLICT_ACCOUNT_WAN) continue
      if (Math.sign(wan) === Math.sign(bookWan)) continue
      const sectorPnl = row.sectorPnl == null ? null : (row.sectorPnl[sector.key] ?? 0)
      conflicts.push({
        account: row.id,
        label: row.label,
        advisor: row.advisor,
        sector: sector.key,
        sectorLabel: sector.label,
        accountNet: net,
        bookNet: book,
        sectorPnl,
      })
    }
  }
  conflicts.sort((a, b) => Math.abs(b.accountNet) - Math.abs(a.accountNet))
  return conflicts.slice(0, 8)
}

function buildBullets(rows: PositionExposureRow[], totalPnl: number | null): PositionExposure["bullets"] {
  const bullets: PositionExposure["bullets"] = []
  const splits: string[] = []
  for (const sector of POSITION_SECTORS) {
    let longRow: PositionExposureRow | null = null
    let longWan = 0
    let shortRow: PositionExposureRow | null = null
    let shortWan = 0
    for (const row of rows) {
      const wan = Math.round((row.nets[sector.key] ?? 0) / WAN)
      if (wan >= SPLIT_WAN && wan > longWan) {
        longWan = wan
        longRow = row
      }
      if (wan <= -SPLIT_WAN && wan < shortWan) {
        shortWan = wan
        shortRow = row
      }
    }
    if (longRow && shortRow) {
      splits.push(`${sector.label}：多 ${longRow.label} +${groupInt(longWan)}万 vs 空 ${shortRow.label} -${groupInt(Math.abs(shortWan))}万`)
    }
  }
  bullets.push({
    title: "方向分歧",
    text: splits.length
      ? `${splits.join("；")}。`
      : "各板块没有同时出现超过 100 万的多头和空头。",
  })

  const known = rows.filter((row) => row.dailyPnl != null)
  if (!known.length || totalPnl == null) {
    bullets.push({ title: "当日盈亏归因", text: "当日盈亏还没有入账。" })
  } else {
    const worst = known.reduce((a, b) => ((a.dailyPnl ?? 0) <= (b.dailyPnl ?? 0) ? a : b))
    const best = known.reduce((a, b) => ((a.dailyPnl ?? 0) >= (b.dailyPnl ?? 0) ? a : b))
    const clauses = [`量化组合 ${rows.length} 户合计 ${fmtYuanCell(totalPnl)} 元`]
    if ((worst.dailyPnl ?? 0) < 0) {
      const parts = topSectors(worst.sectorPnl, "loss", 3)
      const from = parts.length
        ? `主要来自 ${parts.map((p) => `${sectorLabel(p.key)} ${fmtWan1(p.pnl)}`).join("、")}`
        : ""
      clauses.push(`最大亏损户 ${accountTag(worst)}${from}`)
    }
    if (best !== worst && (best.dailyPnl ?? 0) > 0) {
      const parts = topSectors(best.sectorPnl, "gain", 6)
      const from = parts.length
        ? `来自 ${parts.map((p) => `${sectorLabel(p.key)} ${fmtWan1(p.pnl)}`).join("、")}`
        : ""
      clauses.push(`最大盈利户 ${accountTag(best)}${from}`)
    }
    bullets.push({ title: "当日盈亏归因", text: `${clauses.join("。")}。` })

    if ((worst.dailyPnl ?? 0) < 0 && worst.sectorPnl) {
      const losing = POSITION_SECTORS
        .map((sector) => ({
          key: sector.key,
          net: worst.nets[sector.key] ?? 0,
          pnl: worst.sectorPnl?.[sector.key] ?? 0,
        }))
        .filter((sector) => sector.pnl < 0 && Math.abs(Math.round(sector.net / WAN)) >= CONFLICT_ACCOUNT_WAN)
        .sort((a, b) => a.pnl - b.pnl)
      if (losing.length) {
        const bits = losing.map((sector) => `${sectorLabel(sector.key)}（净 ${fmtWanIntSigned(sector.net)}）`)
        bullets.push({
          title: "方向错配",
          text: `净方向与当日板块盈亏对照。${worst.label} 亏损最重、且净暴露超过 100 万的板块是 ${bits.join("、")}。这些是次日要跟踪的方向风险。`,
        })
      }
    }
  }
  return bullets
}

function externalFootnote(row: PositionExposureRow): string {
  const who = [row.advisor, row.brokerLabel].filter((name, i, all) => name && all.indexOf(name) === i)
  let head = `外部成员：${row.label}`
  if (who.length) head += `（${who.join("，")}）`
  head += "为单账户风控模块账户（非 MOM 母基金）"
  const parts: string[] = []
  if (row.equity != null) parts.push(`权益 ${fmtGrossCell(row.equity)} 万`)
  if (row.riskPct != null) parts.push(`风险度 ${row.riskPct.toFixed(1)}%`)
  parts.push(`毛敞口 ${fmtGrossCell(row.gross)} 万`)
  if (row.dailyPnl != null) parts.push(`当日 ${fmtYuanCell(row.dailyPnl)} 元`)
  return `${head}，${parts.join("，")}。`
}

export function buildPositionExposure(input: {
  date: string | null
  accounts: ExposureLeg[]
}): PositionExposure {
  const sectors = POSITION_SECTORS.map((sector) => ({ key: sector.key, label: sector.label }))
  if (!input.date) {
    return {
      date: null,
      sectors,
      rows: [],
      total: emptyTotal(),
      conflicts: [],
      bullets: [],
      footnotes: ["核算表里还没有量化账户持仓。"],
    }
  }

  const rows: PositionExposureRow[] = []
  const flat: string[] = []
  const stale: string[] = []
  const missing: string[] = []
  for (const leg of input.accounts) {
    if (!leg.onBook && leg.latest !== input.date) {
      if (leg.latest) stale.push(`${leg.label}（最新 ${leg.latest}）`)
      else missing.push(leg.label)
      continue
    }
    const gross = sumRecord(leg.longBySector) + sumRecord(leg.shortBySector)
    if (gross < MIN_GROSS) {
      flat.push(leg.label)
      continue
    }
    rows.push(rowFromLeg(leg))
  }

  const total = emptyTotal()
  let pnlKnown = false
  for (const row of rows) {
    total.net += row.net
    total.gross += row.gross
    if (row.dailyPnl != null) {
      pnlKnown = true
      total.dailyPnl = (total.dailyPnl ?? 0) + row.dailyPnl
    }
    for (const [key, value] of Object.entries(row.nets)) total.nets[key] = (total.nets[key] ?? 0) + value
    for (const [key, value] of Object.entries(row.longs)) total.longs[key] = (total.longs[key] ?? 0) + value
    for (const [key, value] of Object.entries(row.shorts)) total.shorts[key] = (total.shorts[key] ?? 0) + value
  }
  if (!pnlKnown) total.dailyPnl = null

  const footnotes: string[] = []
  if (flat.length) footnotes.push(`已剔除空仓户：${flat.join("、")}。`)
  if (stale.length) footnotes.push(`持仓日不是 ${input.date}：${stale.join("、")}。`)
  if (missing.length) footnotes.push(`无持仓记录：${missing.join("、")}。`)
  for (const row of rows) {
    if (row.source === "cfmmc") footnotes.push(externalFootnote(row))
  }
  if (rows.some((row) => row.source === "cfmmc" && row.sectorPnl != null)) {
    footnotes.push("外部账户的板块当日盈亏是两日持仓浮动水平差，只含持仓浮动变动，不含平仓盈亏。")
  }
  if (rows.some((row) => row.source === "cfmmc" && row.sectorPnl == null)) {
    footnotes.push("外部账户缺少上一交易日持仓，板块当日盈亏未计算。")
  }
  const missingPnl = rows.filter((row) => row.dailyPnl == null)
  if (missingPnl.length && rows.some((row) => row.dailyPnl != null)) {
    footnotes.push(`当日盈亏合计未含 ${missingPnl.map((row) => row.label).join("、")}（结算盈亏未入账）。`)
  }
  const other = total.nets["其他"] ?? 0
  if (fmtWanCell(other) !== "—") footnotes.push(`另有未归类合约，组合净暴露 ${fmtWanCell(other)} 万。`)
  footnotes.push("「—」表示该板块无持仓，或净暴露不足 1 万元。板块映射：黑色含 RB/HC/I/JM/J/SM/SF/FG；能化含 L/PP/MA/TA/EB/EG/RU/NR/BR/V/PX/SH 等；农产含 M/Y/P/C/CF/RM/SR/UR 等；生鲜含 JD/AP/CJ/LH。")

  return {
    date: input.date,
    sectors,
    rows,
    total,
    conflicts: buildConflicts(rows),
    bullets: rows.length ? buildBullets(rows, total.dailyPnl) : [],
    footnotes,
  }
}
