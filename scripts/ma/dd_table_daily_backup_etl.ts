/**
 * Nightly due diligence table backup ETL.
 *
 * Creates a daily snapshot of due_diligence_team_table and keeps the last 3
 * daily backups (plus separate pre_reset backups retained by the server lib).
 *
 * Usage (via nightly_etl.py):
 *   npx tsx scripts/ma/dd_table_daily_backup_etl.ts
 */

import {
  ensureScriptDatabaseEnv,
  configureEtlDbTimeout,
} from "@/lib/server/load-project-env"

// Must run before importing lib/db (pool is created at module load).
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  try {
    const { createDailyDueDiligenceTableBackup } = await import(
      "@/lib/server/due-diligence-table"
    )
    console.error("[dd_table_daily_backup_etl] creating daily backup…")
    const backup = await createDailyDueDiligenceTableBackup("nightly_etl")
    if (!backup) {
      console.error("[dd_table_daily_backup_etl] skipped: table empty or missing")
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "empty" }))
      process.exit(0)
    }

    console.error(
      `[dd_table_daily_backup_etl] saved id=${backup.id} rows=${backup.rowCount} at=${backup.createdAt}`,
    )
    console.log(
      JSON.stringify({
        ok: true,
        skipped: false,
        id: backup.id,
        kind: backup.kind,
        rowCount: backup.rowCount,
        createdAt: backup.createdAt,
        createdBy: backup.createdBy,
        sourceUpdatedAt: backup.sourceUpdatedAt,
        sourceUpdatedBy: backup.sourceUpdatedBy,
      }),
    )
    process.exit(0)
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message || (e as { code?: string }).code || String(e)
        : String(e)
    console.error(`[dd_table_daily_backup_etl] failed: ${message}`)
    console.log(JSON.stringify({ ok: false, error: message }))
    process.exit(1)
  }
}

void main()
