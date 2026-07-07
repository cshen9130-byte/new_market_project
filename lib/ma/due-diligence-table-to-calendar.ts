import type { DueDiligenceTableRow } from "./due-diligence-table"
import type { DueDiligenceSchedule, DueDiligenceScheduleForm } from "./due-diligence-schedules"
import {
  createDueDiligenceSchedule,
  loadDueDiligenceSchedules,
  saveDueDiligenceSchedules,
} from "./due-diligence-schedules"

export type ExtractToCalendarResult = {
  added: number
  skipped: number
  noDate: number
}

export function parseTableDate(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const slash = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
  if (slash) {
    const [, y, m, d] = slash
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return null
}

/** Convert ISO date (YYYY-MM-DD) to table display format, e.g. 2026/6/29 */
export function formatTableDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-")
  return `${y}/${Number(m)}/${Number(d)}`
}

const WEEKDAY_LABELS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]

/** Returns 星期x label for a table date string, or null if invalid/empty. */
export function tableDateWeekdayLabel(raw: string): string | null {
  const iso = parseTableDate(raw)
  if (!iso) return null
  return WEEKDAY_LABELS[new Date(`${iso}T12:00:00`).getDay()]
}

export function parseTableMethod(raw: string): DueDiligenceScheduleForm["method"] {
  const s = raw.trim()
  if (/实地|线下|现场|onsite/i.test(s)) return "onsite"
  return "online"
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + (m ?? 0) + 60
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`
}

function buildScheduleTitle(row: DueDiligenceTableRow): string {
  const primary = row.fundCompany || row.investmentManager || row.representativeProduct
  if (primary) return `${primary} 尽调`
  if (row.ddTarget.trim()) return `${row.ddTarget.trim()} 尽调`
  return "尽调"
}

function buildScheduleDescription(row: DueDiligenceTableRow): string {
  const parts: string[] = []
  const strategy = [row.strategyLevel1, row.strategyLevel2, row.strategyLevel3].filter(Boolean).join(" / ")
  if (strategy) parts.push(`策略：${strategy}`)
  if (row.representativeProduct.trim()) parts.push(`代表产品：${row.representativeProduct.trim()}`)
  if (row.otherInfo.trim()) parts.push(row.otherInfo.trim())
  if (row.ddConclusion.trim()) parts.push(`尽调结论：${row.ddConclusion.trim()}`)
  return parts.join("\n")
}

export function tableRowToScheduleForm(row: DueDiligenceTableRow): DueDiligenceScheduleForm | null {
  const startDate = parseTableDate(row.ddDate)
  if (!startDate) return null

  const timeRaw = row.ddTime.trim()
  let allDay = false
  let startTime = "09:00"
  let endTime = "10:00"

  const timeMatch = timeRaw.match(/^(\d{1,2}):(\d{2})$/)
  if (timeMatch) {
    startTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`
    endTime = addHour(startTime)
  } else if (!timeRaw) {
    allDay = true
  }

  return {
    title: buildScheduleTitle(row),
    startDate,
    startTime,
    endDate: startDate,
    endTime,
    allDay,
    institution: row.fundCompany.trim(),
    method: parseTableMethod(row.ddMethod),
    ddType: "first",
    personnel: row.ddPersonnel.trim(),
    reminder: "开始前5分钟",
    notifyMethod: "browser",
    target: row.ddTarget.trim(),
    recommender: row.recommender.trim(),
    description: buildScheduleDescription(row),
  }
}

export function countExtractableRows(
  rows: DueDiligenceTableRow[],
  existingSchedules: DueDiligenceSchedule[] = loadDueDiligenceSchedules(),
): {
  withDate: number
  alreadySynced: number
} {
  const syncedIds = new Set(
    existingSchedules
      .map((s) => s.sourceTableRowId)
      .filter((id): id is string => Boolean(id)),
  )
  let withDate = 0
  let alreadySynced = 0
  for (const row of rows) {
    if (!parseTableDate(row.ddDate)) continue
    withDate++
    if (syncedIds.has(row.id)) alreadySynced++
  }
  return { withDate, alreadySynced }
}

export function extractTableRowsToCalendar(
  rows: DueDiligenceTableRow[],
  existingSchedules: DueDiligenceSchedule[] = loadDueDiligenceSchedules(),
): ExtractToCalendarResult & { schedules: DueDiligenceSchedule[] } {
  const existing = existingSchedules
  const syncedIds = new Set(
    existing.map((s) => s.sourceTableRowId).filter((id): id is string => Boolean(id)),
  )

  let added = 0
  let skipped = 0
  let noDate = 0
  const next: DueDiligenceSchedule[] = [...existing]

  for (const row of rows) {
    if (syncedIds.has(row.id)) {
      skipped++
      continue
    }
    const form = tableRowToScheduleForm(row)
    if (!form) {
      noDate++
      continue
    }
    const schedule = createDueDiligenceSchedule(form)
    schedule.sourceTableRowId = row.id
    next.push(schedule)
    syncedIds.add(row.id)
    added++
  }

  saveDueDiligenceSchedules(next)
  return { added, skipped, noDate, schedules: next }
}
