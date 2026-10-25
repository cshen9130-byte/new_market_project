/** Calendar period helpers for AI-ball fund report generation (Asia/Shanghai). */

export type ReportPeriodKind = "weekly" | "monthly" | "quarterly"

export type ReportPeriod = { begin: string; end: string }

/** YYYY-MM-DD in Asia/Shanghai for a given instant (default: now). */
export function shanghaiYmd(asOf: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(asOf)
}

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number)
  return { y, m, d }
}

function fromYmd(ymd: string): Date {
  const { y, m, d } = parseYmd(ymd)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(ymd: string, days: number): string {
  const d = fromYmd(ymd)
  d.setUTCDate(d.getUTCDate() + days)
  return toYmd(d)
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0, 12, 0, 0))
  return toYmd(d)
}

/**
 * Most recent completed Mon-Fri trading week as of `asOf` (Shanghai calendar).
 * Week is complete only after Friday (Sat/Sun use that week's Mon-Fri;
 * Mon-Fri still in progress -> previous Mon-Fri).
 *
 * Examples (Asia/Shanghai):
 * - 2026-10-25 (Sun) -> 2026-10-19 ... 2026-10-23
 * - 2026-10-29 (Thu) -> 2026-10-19 ... 2026-10-23
 */
export function lastCompletedTradingWeek(asOf: Date = new Date()): ReportPeriod {
  const today = shanghaiYmd(asOf)
  const dow = fromYmd(today).getUTCDay()
  const daysSinceMonday = (dow + 6) % 7
  const thisMonday = addDays(today, -daysSinceMonday)
  const thisFriday = addDays(thisMonday, 4)
  if (today > thisFriday) {
    return { begin: thisMonday, end: thisFriday }
  }
  const prevMonday = addDays(thisMonday, -7)
  return { begin: prevMonday, end: addDays(prevMonday, 4) }
}

/** Previous completed calendar month (never the in-progress month). */
export function lastCompletedMonth(asOf: Date = new Date()): ReportPeriod {
  const { y, m } = parseYmd(shanghaiYmd(asOf))
  const year = m === 1 ? y - 1 : y
  const month = m === 1 ? 12 : m - 1
  return {
    begin: `${year}-${String(month).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, month),
  }
}

/** Most recent completed calendar quarter. */
export function lastCompletedQuarter(asOf: Date = new Date()): ReportPeriod {
  const asOfStr = shanghaiYmd(asOf)
  const { y, m } = parseYmd(asOfStr)
  const thisQ = Math.floor((m - 1) / 3)
  const qEnd = lastDayOfMonth(y, thisQ * 3 + 3)
  const q = asOfStr >= qEnd ? thisQ : thisQ - 1
  const year = q < 0 ? y - 1 : y
  const qIndex = q < 0 ? 3 : q
  const startMonth = qIndex * 3 + 1
  return {
    begin: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, startMonth + 2),
  }
}

export function defaultReportPeriod(kind: ReportPeriodKind, asOf: Date = new Date()): ReportPeriod {
  if (kind === "weekly") return lastCompletedTradingWeek(asOf)
  if (kind === "monthly") return lastCompletedMonth(asOf)
  return lastCompletedQuarter(asOf)
}

/** Parse explicit dates from user text; returns null if none found. */
export function parseExplicitReportPeriod(text: string): ReportPeriod | null {
  const cleaned = text.trim()
  const rangeFull = cleaned.match(
    /(20\d{2})[.\-\/年](\d{1,2})[.\-\/月](\d{1,2})日?\s*(?:[~～\-—至到]|到)\s*(20\d{2})?[.\-\/年]?(\d{1,2})[.\-\/月]?(\d{1,2})日?/,
  )
  if (rangeFull) {
    const y1 = rangeFull[1]
    const m1 = rangeFull[2].padStart(2, "0")
    const d1 = rangeFull[3].padStart(2, "0")
    const y2 = rangeFull[4] || y1
    const m2 = rangeFull[5].padStart(2, "0")
    const d2 = rangeFull[6].padStart(2, "0")
    const begin = `${y1}-${m1}-${d1}`
    const end = `${y2}-${m2}-${d2}`
    if (begin <= end) return { begin, end }
  }
  const monthOnly = cleaned.match(/(20\d{2})[.\-\/年](\d{1,2})月?(?![\d日])/)
  if (monthOnly && /月报|月度/.test(cleaned)) {
    const y = Number(monthOnly[1])
    const m = Number(monthOnly[2])
    return {
      begin: `${y}-${String(m).padStart(2, "0")}-01`,
      end: lastDayOfMonth(y, m),
    }
  }
  return null
}

/** Monday (ISO) of the calendar week containing `ymd` (UTC noon math). */
export function isoWeekBegin(ymd: string): string {
  const d = fromYmd(ymd)
  const dow = d.getUTCDay() // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7
  return addDays(ymd, -daysSinceMonday)
}

export type NavRange = { start?: string | null; end?: string | null }

/**
 * Clamp a 「最新」 report period into the product NAV window.
 * Weekly: prefer last completed Mon–Fri fully inside [navStart, navEnd];
 * if the candidate week straddles navEnd, walk earlier weeks; finally clip end.
 * Monthly/quarterly: walk earlier complete periods, then clip to navEnd.
 */
export function clampLatestReportPeriodToNav(
  kind: ReportPeriodKind,
  period: ReportPeriod,
  nav: NavRange,
): ReportPeriod {
  const navStart = nav.start || null
  const navEnd = nav.end || null
  if (!navEnd && !navStart) return period

  let begin = period.begin
  let end = period.end

  if (kind === "weekly") {
    for (let i = 0; i < 52; i += 1) {
      if (navEnd && end > navEnd) {
        begin = addDays(begin, -7)
        end = addDays(end, -7)
        continue
      }
      break
    }
    if (navEnd && end > navEnd) {
      begin = isoWeekBegin(navEnd)
      end = navEnd
    }
  } else if (kind === "monthly") {
    for (let i = 0; i < 24; i += 1) {
      if (navEnd && end > navEnd) {
        const { y, m } = parseYmd(begin)
        const year = m === 1 ? y - 1 : y
        const month = m === 1 ? 12 : m - 1
        begin = `${year}-${String(month).padStart(2, "0")}-01`
        end = lastDayOfMonth(year, month)
        continue
      }
      break
    }
    if (navEnd && end > navEnd) {
      const { y, m } = parseYmd(navEnd)
      begin = `${y}-${String(m).padStart(2, "0")}-01`
      end = navEnd
    }
  } else {
    for (let i = 0; i < 16; i += 1) {
      if (navEnd && end > navEnd) {
        const { y, m } = parseYmd(begin)
        const thisQ = Math.floor((m - 1) / 3)
        const q = thisQ - 1
        const year = q < 0 ? y - 1 : y
        const qIndex = q < 0 ? 3 : q
        const startMonth = qIndex * 3 + 1
        begin = `${year}-${String(startMonth).padStart(2, "0")}-01`
        end = lastDayOfMonth(year, startMonth + 2)
        continue
      }
      break
    }
    if (navEnd && end > navEnd) {
      end = navEnd
    }
  }

  if (navStart && begin < navStart) begin = navStart
  if (navEnd && end > navEnd) end = navEnd
  if (begin > end && navEnd) {
    if (kind === "weekly") return { begin: isoWeekBegin(navEnd), end: navEnd }
    if (kind === "monthly") {
      const { y, m } = parseYmd(navEnd)
      return { begin: `${y}-${String(m).padStart(2, "0")}-01`, end: navEnd }
    }
    return { begin: navStart && navStart > addDays(navEnd, -90) ? navStart : begin, end: navEnd }
  }
  return { begin, end }
}
