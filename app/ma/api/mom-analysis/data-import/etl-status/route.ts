import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface FileStateRow {
  last_run: string | null
  total_files: string
  ok_files: string
  error_files: string
  total_rows: string
}

interface ErrorRow {
  source_file_rel: string
  error_message: string | null
  processed_at: string | null
}

export async function GET() {
  try {
    const [stats] = await query<FileStateRow>(`
      SELECT
        MAX(processed_at)::text                                         AS last_run,
        COUNT(*)::text                                                  AS total_files,
        SUM(CASE WHEN status = 'ok'    THEN 1 ELSE 0 END)::text        AS ok_files,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::text        AS error_files,
        COALESCE(SUM(row_count), 0)::text                              AS total_rows
      FROM mom_trade_detail_file_state
    `)

    const recentErrors = await query<ErrorRow>(`
      SELECT source_file_rel, error_message, processed_at::text AS processed_at
      FROM mom_trade_detail_file_state
      WHERE status = 'error'
      ORDER BY processed_at DESC
      LIMIT 5
    `)

    return NextResponse.json({
      ok: true,
      notYetRun: !stats.last_run,
      lastRun: stats.last_run,
      totalFiles: parseInt(stats.total_files, 10),
      okFiles: parseInt(stats.ok_files, 10),
      errorFiles: parseInt(stats.error_files, 10),
      totalRows: parseInt(stats.total_rows, 10),
      recentErrors: recentErrors.map((r) => ({
        file: r.source_file_rel,
        message: r.error_message,
        at: r.processed_at,
      })),
    })
  } catch (err: unknown) {
    // Table doesn't exist yet (ETL has never run) → return not-yet-run state
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_trade_detail_file_state") || msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true,
        notYetRun: true,
        lastRun: null,
        totalFiles: 0,
        okFiles: 0,
        errorFiles: 0,
        totalRows: 0,
        recentErrors: [],
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
