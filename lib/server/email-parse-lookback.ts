/** Default IMAP lookback for fund email / 估值表 parsing (days). */
export function resolveEmailParseLookbackDays(requested?: number): number {
  if (requested != null && Number.isFinite(requested) && requested > 0) {
    return Math.min(Math.max(Math.floor(requested), 1), 730)
  }
  const env = parseInt(process.env.EMAIL_NAV_ETL_DAYS ?? "400", 10)
  return Number.isFinite(env) && env > 0 ? Math.min(env, 730) : 400
}

/** Lookback days to cover a date range plus buffer for weekends/holidays. */
export function emailLookbackDaysForDateRange(fromDate: string, bufferDays = 14): number {
  const from = new Date(`${fromDate.slice(0, 10)}T12:00:00`)
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const diff = Math.ceil((today.getTime() - from.getTime()) / 86400000) + bufferDays
  return resolveEmailParseLookbackDays(Math.max(diff, resolveEmailParseLookbackDays()))
}
