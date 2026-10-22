import { query } from "@/lib/db"
import {
  sanitizeAccountDashboardPrefs,
  type AccountDashboardPrefs,
} from "@/lib/ma/account-dashboard"

let ready: Promise<void> | null = null

function ensureColumn(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const columns = await query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'auth_users'
            AND column_name = 'dashboard_prefs'`,
      )
      if (columns.length === 0) {
        await query(`ALTER TABLE auth_users ADD COLUMN dashboard_prefs JSONB NOT NULL DEFAULT '{}'`)
      }
    })().catch((error) => {
      ready = null
      throw error
    })
  }
  return ready
}

export async function readAccountDashboard(userId: string, allowMom: boolean): Promise<AccountDashboardPrefs> {
  await ensureColumn()
  const rows = await query<{ dashboard_prefs: unknown }>(
    `SELECT dashboard_prefs FROM auth_users WHERE id = $1`,
    [userId],
  )
  return sanitizeAccountDashboardPrefs(rows[0]?.dashboard_prefs, allowMom)
}

export async function writeAccountDashboard(
  userId: string,
  raw: unknown,
  allowMom: boolean,
): Promise<AccountDashboardPrefs> {
  await ensureColumn()
  const prefs = sanitizeAccountDashboardPrefs(raw, allowMom)
  await query(
    `UPDATE auth_users SET dashboard_prefs = $2::jsonb WHERE id = $1`,
    [userId, JSON.stringify(prefs)],
  )
  return prefs
}
