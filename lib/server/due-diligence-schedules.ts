import { query } from "@/lib/db"
import type { DueDiligenceSchedule } from "@/lib/ma/due-diligence-schedules"

export type DueDiligenceSchedulesSnapshot = {
  schedules: DueDiligenceSchedule[]
  updatedAt: string
  updatedBy: string
}

const TEAM_ROW_ID = "team"

let initPromise: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = _ensureTable().catch((e) => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

async function _ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS due_diligence_team_schedules (
      id          TEXT PRIMARY KEY,
      schedules   JSONB NOT NULL DEFAULT '[]',
      updated_by  TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

function sanitizeSchedule(raw: unknown): DueDiligenceSchedule | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Partial<DueDiligenceSchedule>
  if (typeof s.id !== "string" || !s.id.trim()) return null
  if (typeof s.title !== "string") return null
  if (typeof s.startDate !== "string" || !s.startDate.trim()) return null
  const now = new Date().toISOString()
  return {
    title: s.title,
    startDate: s.startDate,
    startTime: typeof s.startTime === "string" ? s.startTime : "09:00",
    endDate: typeof s.endDate === "string" ? s.endDate : s.startDate,
    endTime: typeof s.endTime === "string" ? s.endTime : "10:00",
    allDay: Boolean(s.allDay),
    institution: typeof s.institution === "string" ? s.institution : "",
    method: s.method === "onsite" ? "onsite" : "online",
    ddType: s.ddType === "followup" ? "followup" : "first",
    personnel: typeof s.personnel === "string" ? s.personnel : "",
    reminder: typeof s.reminder === "string" ? s.reminder : "开始前5分钟",
    notifyMethod: s.notifyMethod === "wechat" ? "wechat" : "browser",
    target: typeof s.target === "string" ? s.target : "",
    recommender: typeof s.recommender === "string" ? s.recommender : "",
    description: typeof s.description === "string" ? s.description : "",
    id: s.id,
    createdAt: typeof s.createdAt === "string" ? s.createdAt : now,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : now,
    sourceTableRowId:
      typeof s.sourceTableRowId === "string" && s.sourceTableRowId.trim()
        ? s.sourceTableRowId.trim()
        : undefined,
  }
}

function sanitizeSchedules(value: unknown): DueDiligenceSchedule[] {
  if (!Array.isArray(value)) return []
  return value.map(sanitizeSchedule).filter((s): s is DueDiligenceSchedule => s !== null)
}

async function migrateFromLegacyFile(): Promise<DueDiligenceSchedulesSnapshot | null> {
  try {
    const { existsSync, readFileSync } = await import("fs")
    const path = await import("path")
    const { getServerStoragePath } = await import("@/lib/server/storage")
    const file = path.join(getServerStoragePath("due-diligence-schedules"), "team-schedules.json")
    if (!existsSync(file)) return null
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<DueDiligenceSchedulesSnapshot>
    const schedules = sanitizeSchedules(parsed.schedules)
    if (schedules.length === 0) return null
    return {
      schedules,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      updatedBy: typeof parsed.updatedBy === "string" ? parsed.updatedBy : "migration",
    }
  } catch {
    return null
  }
}

async function readSnapshot(): Promise<DueDiligenceSchedulesSnapshot | null> {
  await ensureTable()
  const rows = await query<{
    schedules: unknown
    updated_by: string
    updated_at: Date | string
  }>(
    `SELECT schedules, updated_by, updated_at
       FROM due_diligence_team_schedules
      WHERE id = $1
      LIMIT 1`,
    [TEAM_ROW_ID],
  )
  if (rows.length === 0) return null
  const schedules = sanitizeSchedules(rows[0].schedules)
  const updatedAt = rows[0].updated_at
  return {
    schedules,
    updatedAt:
      typeof updatedAt === "string"
        ? new Date(updatedAt).toISOString()
        : updatedAt.toISOString(),
    updatedBy: rows[0].updated_by || "",
  }
}

async function writeSnapshot(snapshot: DueDiligenceSchedulesSnapshot): Promise<void> {
  await ensureTable()
  await query(
    `INSERT INTO due_diligence_team_schedules (id, schedules, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, $4::timestamptz)
     ON CONFLICT (id)
     DO UPDATE SET
       schedules = EXCLUDED.schedules,
       updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      TEAM_ROW_ID,
      JSON.stringify(snapshot.schedules),
      snapshot.updatedBy,
      snapshot.updatedAt,
    ],
  )
}

export async function getServerDueDiligenceSchedules(): Promise<DueDiligenceSchedulesSnapshot> {
  const existing = await readSnapshot()
  if (existing) return existing

  const migrated = await migrateFromLegacyFile()
  if (migrated) {
    await writeSnapshot(migrated)
    return migrated
  }

  const empty: DueDiligenceSchedulesSnapshot = {
    schedules: [],
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  }
  await writeSnapshot(empty)
  return empty
}

export async function saveServerDueDiligenceSchedules(
  schedules: DueDiligenceSchedule[],
  userName: string,
): Promise<DueDiligenceSchedulesSnapshot> {
  const sanitized = sanitizeSchedules(schedules)
  const snapshot: DueDiligenceSchedulesSnapshot = {
    schedules: sanitized,
    updatedAt: new Date().toISOString(),
    updatedBy: userName || "unknown",
  }
  await writeSnapshot(snapshot)
  return snapshot
}
