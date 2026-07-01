export type DueDiligenceScheduleForm = {
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  allDay: boolean
  institution: string
  method: "online" | "onsite"
  ddType: "first" | "followup"
  personnel: string
  reminder: string
  notifyMethod: "browser" | "wechat"
  target: string
  recommender: string
  description: string
}

export type DueDiligenceSchedule = DueDiligenceScheduleForm & {
  id: string
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = "dd_calendar_schedules"

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

export function defaultScheduleForm(): DueDiligenceScheduleForm {
  const today = new Date().toISOString().slice(0, 10)
  return {
    title: "",
    startDate: today,
    startTime: "22:00",
    endDate: today,
    endTime: "23:00",
    allDay: false,
    institution: "",
    method: "online",
    ddType: "first",
    personnel: "",
    reminder: "开始前5分钟",
    notifyMethod: "browser",
    target: "",
    recommender: "",
    description: "",
  }
}

export function loadDueDiligenceSchedules(): DueDiligenceSchedule[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDueDiligenceSchedules(schedules: DueDiligenceSchedule[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules))
}

export function createDueDiligenceSchedule(form: DueDiligenceScheduleForm): DueDiligenceSchedule {
  const now = new Date().toISOString()
  return {
    ...form,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  }
}

export function scheduleMatchesDate(schedule: DueDiligenceSchedule, date: string): boolean {
  return date >= schedule.startDate && date <= schedule.endDate
}

export function scheduleDisplayTime(schedule: DueDiligenceSchedule): string {
  if (schedule.allDay) return "全天"
  return schedule.startTime.slice(0, 5)
}

export function formatScheduleDateHeader(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return date
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const weekday = WEEKDAY_LABELS[d.getDay()]
  return `${y}年${m}月${day}日 ${weekday}`
}

export function formatScheduleTimeRange(schedule: DueDiligenceSchedule): string {
  if (schedule.allDay) return `${schedule.startDate} 至 ${schedule.endDate}（全天）`
  return `${schedule.startDate} ${schedule.startTime.slice(0, 5)}至${schedule.endDate} ${schedule.endTime.slice(0, 5)}`
}

export function methodLabel(method: DueDiligenceSchedule["method"]): string {
  return method === "online" ? "线上尽调" : "实地尽调"
}

export function ddTypeLabel(ddType: DueDiligenceSchedule["ddType"]): string {
  return ddType === "first" ? "首次尽调" : "后续尽调"
}

export function notifyMethodLabel(notifyMethod: DueDiligenceSchedule["notifyMethod"]): string {
  return notifyMethod === "browser" ? "浏览器提示" : "微信推送"
}

export function scheduleDotClass(method: DueDiligenceSchedule["method"]): string {
  return method === "online" ? "bg-orange-400" : "bg-blue-500"
}

export function schedulePassesFilter(
  schedule: DueDiligenceSchedule,
  showOnline: boolean,
  showOnsite: boolean,
): boolean {
  if (schedule.method === "online") return showOnline
  return showOnsite
}
