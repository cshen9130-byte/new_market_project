/** Shared shapes for the 外部私募业绩排行 week view. No server imports. */

export const EXTERNAL_RANK_FOLDER = "外部私募业绩排行"

export type ExternalRankWeekRow = {
  rank: number
  strategy: string
  class_key: string
  manager: string
  product: string | null
  aum: string | null
  nav_date: string | null
  /** Decimal return, 0.12 = 12%. */
  ytd: number | null
  ytd_drawdown: number | null
  ret_1w: number | null
  sheet: string
}

export type ExternalRankWeekFile = {
  path: string
  name: string
  size: number
  updated_at: string
  parsed: boolean
  error: string | null
  title: string
  as_of: string | null
  window_label: string | null
  classes: string[]
  matched_by: "as_of" | "filename" | "both"
  row_count: number
  truncated: boolean
  rows: ExternalRankWeekRow[]
}

export type ExternalRankWeekGroup = {
  strategy: string
  row_count: number
  file_count: number
}

export type ExternalRankDetectedWeek = {
  week_start: string
  week_end: string
  file_count: number
}

export type ExternalRankWeekPreview = {
  folder: string
  week_start: string
  week_end: string
  scanned: number
  files: ExternalRankWeekFile[]
  groups: ExternalRankWeekGroup[]
  weeks: ExternalRankDetectedWeek[]
}
