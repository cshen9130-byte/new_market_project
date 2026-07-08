/** Default IMAP lookback when caller passes an explicit day count (manual backfill). */
export function resolveEmailParseLookbackDays(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.min(Math.max(Math.floor(requested), 1), 730)
  }
  return resolveInitialBackfillDays()
}

/** First-time mailbox scan window (full history backfill). */
export function resolveInitialBackfillDays(): number {
  const env = parseInt(
    process.env.EMAIL_NAV_ETL_INITIAL_DAYS ?? process.env.EMAIL_NAV_ETL_DAYS ?? "400",
    10,
  )
  return Number.isFinite(env) && env > 0 ? Math.min(env, 730) : 400
}

/** Overlap before last parsed email when resuming incremental scans (weekends / late mail). */
export function resolveIncrementalOverlapDays(): number {
  const env = parseInt(process.env.EMAIL_NAV_ETL_OVERLAP_DAYS ?? "2", 10)
  return Number.isFinite(env) && env >= 0 ? Math.min(env, 14) : 2
}

/** Lookback days to cover a date range plus buffer for weekends/holidays. */
export function emailLookbackDaysForDateRange(fromDate: string, bufferDays = 14): number {
  const from = new Date(`${fromDate.slice(0, 10)}T12:00:00`)
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.ceil((today.getTime() - from.getTime()) / 86400000) + bufferDays
  return resolveEmailParseLookbackDays(Math.max(diff, resolveInitialBackfillDays()))
}
