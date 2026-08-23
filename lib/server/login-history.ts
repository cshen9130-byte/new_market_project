import { publicQuery } from "@/lib/db"

export type LoginHistoryRow = {
  id: number
  logged_at: string
  success: boolean
  user_id: string | null
  name: string | null
  email: string | null
  identifier: string
  ip: string | null
  user_agent: string | null
  fail_reason: string | null
}

type RecordLoginInput = {
  success: boolean
  identifier: string
  ip?: string | null
  userAgent?: string | null
  failReason?: string | null
  user?: { id: string; name: string; email: string } | null
}

const IDENTIFIER_MAX = 200
const USER_AGENT_MAX = 500
const FAIL_REASON_MAX = 80

let initPromise: Promise<void> | null = null

function clip(value: string | null | undefined, max: number): string | null {
  const text = (value || "").trim()
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

function ensureTable(): Promise<void> {
  if (!initPromise) {
    initPromise = _initTable().catch((err) => {
      initPromise = null
      throw err
    })
  }
  return initPromise
}

async function _initTable() {
  await publicQuery(`
    CREATE TABLE IF NOT EXISTS public.auth_login_history (
      id          BIGSERIAL PRIMARY KEY,
      logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      success     BOOLEAN NOT NULL,
      user_id     TEXT,
      name        TEXT,
      email       TEXT,
      identifier  TEXT NOT NULL DEFAULT '',
      ip          TEXT,
      user_agent  TEXT,
      fail_reason TEXT
    )
  `)
  await publicQuery(`
    CREATE INDEX IF NOT EXISTS auth_login_history_logged_at_idx
      ON public.auth_login_history (logged_at DESC)
  `)
  await publicQuery(`
    CREATE INDEX IF NOT EXISTS auth_login_history_name_logged_at_idx
      ON public.auth_login_history (name, logged_at DESC)
  `)
}

async function lookupUserByIdentifier(identifier: string) {
  const key = identifier.trim()
  if (!key) return null
  const res = await publicQuery(
    `SELECT id, name, email
       FROM public.auth_users
      WHERE email = $1 OR name = $1
      LIMIT 1`,
    [key],
  )
  const row = res.rows[0] as { id: string; name: string; email: string } | undefined
  return row ?? null
}

export async function recordLoginAttempt(input: RecordLoginInput): Promise<void> {
  await ensureTable()
  const identifier = clip(input.identifier, IDENTIFIER_MAX) || ""
  let user = input.user ?? null
  if (!user && identifier) {
    try {
      user = await lookupUserByIdentifier(identifier)
    } catch {
      user = null
    }
  }
  await publicQuery(
    `INSERT INTO public.auth_login_history
       (success, user_id, name, email, identifier, ip, user_agent, fail_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.success,
      user?.id ?? null,
      user?.name ?? null,
      user?.email ?? null,
      identifier,
      clip(input.ip, 80),
      clip(input.userAgent, USER_AGENT_MAX),
      input.success ? null : clip(input.failReason, FAIL_REASON_MAX),
    ],
  )
}

export async function listLoginHistory(input?: {
  days?: number
  limit?: number
}): Promise<LoginHistoryRow[]> {
  await ensureTable()
  const days = Math.min(Math.max(input?.days ?? 7, 1), 365)
  const limit = Math.min(Math.max(input?.limit ?? 200, 1), 1000)
  const res = await publicQuery(
    `SELECT id, logged_at, success, user_id, name, email, identifier, ip, user_agent, fail_reason
       FROM public.auth_login_history
      WHERE logged_at >= NOW() - make_interval(days => $1)
      ORDER BY logged_at DESC
      LIMIT $2`,
    [days, limit],
  )
  return res.rows as LoginHistoryRow[]
}
