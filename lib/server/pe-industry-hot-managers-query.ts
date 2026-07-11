import { query } from "@/lib/db"
import type {
  PeIndustryHotManagerRow,
  PeIndustryHotManagersData,
  PeIndustryHotManagerSeries,
  PeIndustryStaffMetric,
  PeIndustryStaffTrendPoint,
} from "@/lib/pe-industry-data"

const SEC_MANAGER_FILTER = `(m.org_type LIKE '%私募证券%' OR m.org_type LIKE '%私募资产配置%')`

const STAFF_EXPR = `COALESCE(h.full_time_staff_count, h.staff_count)`
const PRACTITIONER_EXPR = `COALESCE(h.fund_practitioner_count, h.fund_manager_count)`

function staffColumn(metric: PeIndustryStaffMetric): string {
  return metric === "practitioner" ? PRACTITIONER_EXPR : STAFF_EXPR
}

function toMonth(value: string | Date): string {
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
  return raw.slice(0, 7)
}

function nn(value: string | number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await query<{ exists: boolean }>(
    `SELECT to_regclass('public.${name}') IS NOT NULL AS exists`,
  )
  return rows[0]?.exists === true
}

export async function loadPeIndustryHotManagers(
  metric: PeIndustryStaffMetric = "full_time",
): Promise<PeIndustryHotManagersData | null> {
  if (!(await tableExists("amac_manager_metrics_history"))) return null
  if (!(await tableExists("amac_managers"))) return null

  const staffCol = staffColumn(metric)

  const snapshotDates = await query<{ snapshot_date: string }>(
    `SELECT DISTINCT snapshot_date::text AS snapshot_date
     FROM amac_manager_metrics_history
     ORDER BY snapshot_date DESC
     LIMIT 12`,
  )
  if (snapshotDates.length === 0) return null

  const latestDate = snapshotDates[0].snapshot_date
  const previousDate = snapshotDates.length >= 2 ? snapshotDates[1].snapshot_date : null

  const trendRows = await query<{
    month: string
    total_staff: string
    avg_staff: string
    manager_count: string
  }>(
    `WITH deduped AS (
       SELECT DISTINCT ON (h.registration_no, h.snapshot_date)
         h.registration_no,
         h.snapshot_date,
         ${staffCol} AS staff_count
       FROM amac_manager_metrics_history h
       JOIN amac_managers m ON m.registration_no = h.registration_no
       WHERE ${SEC_MANAGER_FILTER}
         AND ${staffCol} IS NOT NULL
       ORDER BY h.registration_no, h.snapshot_date, h.captured_at DESC
     )
     SELECT to_char(date_trunc('month', snapshot_date), 'YYYY-MM') AS month,
            SUM(staff_count)::text AS total_staff,
            ROUND(AVG(staff_count)::numeric, 1)::text AS avg_staff,
            COUNT(*)::text AS manager_count
     FROM deduped
     GROUP BY date_trunc('month', snapshot_date)
     ORDER BY date_trunc('month', snapshot_date) ASC`,
  )

  const industryTrend: PeIndustryStaffTrendPoint[] = trendRows.map((row) => ({
    month: row.month,
    totalStaff: nn(row.total_staff) ?? 0,
    avgStaff: nn(row.avg_staff) ?? 0,
    managerCount: nn(row.manager_count) ?? 0,
  }))

  let hotManagers: PeIndustryHotManagerRow[] = []
  if (previousDate) {
    const hotRows = await query<{
      manager_name: string
      registration_no: string
      mgmt_scale_range: string | null
      active_fund_count: string | null
      staff_current: string
      staff_previous: string | null
      staff_delta: string | null
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (h.registration_no)
           h.registration_no,
           h.manager_name,
           h.mgmt_scale_range,
           h.active_fund_count,
           ${staffCol} AS staff_count
         FROM amac_manager_metrics_history h
         JOIN amac_managers m ON m.registration_no = h.registration_no
         WHERE ${SEC_MANAGER_FILTER}
           AND h.snapshot_date = $1::date
           AND ${staffCol} IS NOT NULL
         ORDER BY h.registration_no, h.captured_at DESC
       ),
       previous AS (
         SELECT DISTINCT ON (h.registration_no)
           h.registration_no,
           ${staffCol} AS staff_count
         FROM amac_manager_metrics_history h
         JOIN amac_managers m ON m.registration_no = h.registration_no
         WHERE ${SEC_MANAGER_FILTER}
           AND h.snapshot_date = $2::date
           AND ${staffCol} IS NOT NULL
         ORDER BY h.registration_no, h.captured_at DESC
       )
       SELECT l.manager_name,
              l.registration_no,
              COALESCE(l.mgmt_scale_range, '-') AS mgmt_scale_range,
              l.active_fund_count::text,
              l.staff_count::text AS staff_current,
              p.staff_count::text AS staff_previous,
              (l.staff_count - p.staff_count)::text AS staff_delta
       FROM latest l
       LEFT JOIN previous p ON p.registration_no = l.registration_no
       WHERE l.staff_count IS NOT NULL
       ORDER BY (l.staff_count - COALESCE(p.staff_count, l.staff_count)) DESC,
                l.staff_count DESC,
                l.manager_name ASC
       LIMIT 50`,
      [latestDate, previousDate],
    )

    hotManagers = hotRows.map((row) => {
      const current = nn(row.staff_current) ?? 0
      const previous = nn(row.staff_previous)
      const delta = nn(row.staff_delta)
      const growthPct =
        previous != null && previous > 0 && delta != null
          ? Math.round((delta / previous) * 1000) / 10
          : null
      return {
        managerName: row.manager_name ?? "",
        registrationNo: row.registration_no,
        mgmtScale: row.mgmt_scale_range ?? "-",
        activeFundCount: nn(row.active_fund_count),
        staffCurrent: current,
        staffPrevious: previous,
        staffDelta: delta,
        staffGrowthPct: growthPct,
      }
    })
  } else {
    const currentRows = await query<{
      manager_name: string
      registration_no: string
      mgmt_scale_range: string | null
      active_fund_count: string | null
      staff_current: string
    }>(
      `SELECT DISTINCT ON (h.registration_no)
         h.manager_name,
         h.registration_no,
         COALESCE(h.mgmt_scale_range, '-') AS mgmt_scale_range,
         h.active_fund_count::text,
         ${staffCol}::text AS staff_current
       FROM amac_manager_metrics_history h
       JOIN amac_managers m ON m.registration_no = h.registration_no
       WHERE ${SEC_MANAGER_FILTER}
         AND h.snapshot_date = $1::date
         AND ${staffCol} IS NOT NULL
       ORDER BY h.registration_no, h.captured_at DESC, ${staffCol} DESC
       LIMIT 50`,
      [latestDate],
    )
    hotManagers = currentRows.map((row) => ({
      managerName: row.manager_name ?? "",
      registrationNo: row.registration_no,
      mgmtScale: row.mgmt_scale_range ?? "-",
      activeFundCount: nn(row.active_fund_count),
      staffCurrent: nn(row.staff_current) ?? 0,
      staffPrevious: null,
      staffDelta: null,
      staffGrowthPct: null,
    }))
  }

  const topRegNos = hotManagers.slice(0, 10).map((row) => row.registrationNo)
  let managerSeries: PeIndustryHotManagerSeries[] = []

  if (topRegNos.length > 0) {
    const seriesRows = await query<{
      registration_no: string
      manager_name: string
      month: string
      staff: string
    }>(
      `WITH deduped AS (
         SELECT DISTINCT ON (h.registration_no, h.snapshot_date)
           h.registration_no,
           h.manager_name,
           h.snapshot_date,
           ${staffCol} AS staff_count
         FROM amac_manager_metrics_history h
         JOIN amac_managers m ON m.registration_no = h.registration_no
         WHERE ${SEC_MANAGER_FILTER}
           AND h.registration_no = ANY($1::text[])
           AND ${staffCol} IS NOT NULL
         ORDER BY h.registration_no, h.snapshot_date, h.captured_at DESC
       )
       SELECT registration_no,
              manager_name,
              to_char(date_trunc('month', snapshot_date), 'YYYY-MM') AS month,
              staff_count::text AS staff
       FROM deduped
       ORDER BY registration_no, snapshot_date ASC`,
      [topRegNos],
    )

    const byReg = new Map<string, PeIndustryHotManagerSeries>()
    for (const row of seriesRows) {
      const existing = byReg.get(row.registration_no)
      const point = { month: row.month, staff: nn(row.staff) ?? 0 }
      if (existing) {
        existing.points.push(point)
      } else {
        byReg.set(row.registration_no, {
          registrationNo: row.registration_no,
          managerName: row.manager_name ?? "",
          points: [point],
        })
      }
    }
    managerSeries = topRegNos
      .map((regNo) => byReg.get(regNo))
      .filter((series): series is PeIndustryHotManagerSeries => series != null)
  }

  return {
    updatedAt: toMonth(latestDate),
    metric,
    industryTrend,
    hotManagers,
    managerSeries,
  }
}
