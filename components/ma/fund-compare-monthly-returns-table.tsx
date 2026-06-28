"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import {
  CALENDAR_MONTHS,
  computeFullYearFromMonthly,
  computeMonthlyReturnsForYear,
  computeMonthlyWinRate,
  fmtMonthlyPct,
  monthlyPctClass,
  type NavPoint,
  yearsInRange,
} from "@/lib/fund-compare-period-returns"

interface FundInput {
  beian_hao: string
  name: string
  navPoints: NavPoint[]
}

type SortKey = "name" | "winRate" | "fullYear" | `m${number}`

interface TableRow {
  beian_hao: string
  name: string
  year: number
  monthly: (number | null)[]
  winRate: number | null
  fullYear: number | null
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors"
    >
      {label}
      <ChevronsUpDown
        className={[
          "h-3 w-3",
          active ? "text-red-500" : "text-muted-foreground/60",
          active && dir === "desc" ? "rotate-180" : "",
        ].join(" ")}
      />
    </button>
  )
}

function readSortValue(row: TableRow, key: SortKey): string | number {
  if (key === "name") return row.name
  if (key === "winRate") return row.winRate ?? Number.NEGATIVE_INFINITY
  if (key === "fullYear") return row.fullYear ?? Number.NEGATIVE_INFINITY
  const monthIndex = parseInt(key.slice(1), 10)
  return row.monthly[monthIndex] ?? Number.NEGATIVE_INFINITY
}

export function FundCompareMonthlyReturnsTable({
  funds,
  analyzed,
  fromDate,
  toDate,
}: {
  funds: FundInput[]
  analyzed: boolean
  fromDate: string
  toDate: string
}) {
  const yearOptions = useMemo(() => yearsInRange(fromDate, toDate), [fromDate, toDate])
  const [year, setYear] = useState(() => yearOptions[0] ?? new Date().getFullYear())
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    if (yearOptions.length > 0 && !yearOptions.includes(year)) {
      setYear(yearOptions[0])
    }
  }, [yearOptions, year])

  const statsCutoff = useMemo(() => {
    const yearPrefix = `${year}-`
    const dates = funds
      .flatMap((f) => f.navPoints.map((p) => p.d))
      .filter((d) => d.startsWith(yearPrefix) && d <= toDate)
      .sort()
    return dates.at(-1)?.slice(0, 10) ?? toDate
  }, [funds, year, toDate])

  const rows = useMemo((): TableRow[] => {
    return funds.map((fund) => {
      const monthly = computeMonthlyReturnsForYear(fund.navPoints, year)
      return {
        beian_hao: fund.beian_hao,
        name: fund.name,
        year,
        monthly,
        winRate: computeMonthlyWinRate(monthly),
        fullYear: computeFullYearFromMonthly(monthly),
      }
    })
  }, [funds, year])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = readSortValue(a, sortKey)
      const bv = readSortValue(b, sortKey)
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "zh-CN")
        : (av as number) - (bv as number)
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const hasData = rows.some((r) => r.monthly.some((v) => v != null))
  if (!analyzed || funds.length === 0 || !hasData) return null

  return (
    <div className="px-6 pb-6 pt-2 flex-shrink-0">
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
          <div className="text-xs text-muted-foreground">统计截止：{statsCutoff}</div>
          {yearOptions.length > 1 && (
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[960px] border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap border-r border-zinc-100 w-16">
                  年份
                </th>
                <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap border-r border-zinc-100 min-w-[120px]">
                  <SortableHeader
                    label="基金名称"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  />
                </th>
                {CALENDAR_MONTHS.map((label, i) => (
                  <th key={label} className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                    <SortableHeader
                      label={label}
                      active={sortKey === `m${i}`}
                      dir={sortDir}
                      onClick={() => toggleSort(`m${i}`)}
                    />
                  </th>
                ))}
                <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap border-l border-zinc-100">
                  <SortableHeader
                    label="胜率"
                    active={sortKey === "winRate"}
                    dir={sortDir}
                    onClick={() => toggleSort("winRate")}
                  />
                </th>
                <th className="px-2 py-2.5 text-center font-medium whitespace-nowrap">
                  <SortableHeader
                    label="全年"
                    active={sortKey === "fullYear"}
                    dir={sortDir}
                    onClick={() => toggleSort("fullYear")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, rowIndex) => (
                <tr
                  key={row.beian_hao}
                  className={rowIndex % 2 === 1 ? "bg-zinc-50/40" : "bg-white"}
                >
                  <td className="px-3 py-2.5 text-zinc-700 font-semibold border-r border-zinc-100 whitespace-nowrap">
                    {row.year}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-800 font-medium border-r border-zinc-100 truncate max-w-[160px]">
                    {row.name}
                  </td>
                  {row.monthly.map((value, mi) => (
                    <td
                      key={mi}
                      className={[
                        "px-2 py-2.5 text-center tabular-nums font-medium whitespace-nowrap",
                        monthlyPctClass(value),
                      ].join(" ")}
                    >
                      {fmtMonthlyPct(value)}
                    </td>
                  ))}
                  <td className="px-2 py-2.5 text-center tabular-nums text-zinc-700 border-l border-zinc-100 whitespace-nowrap">
                    {row.winRate != null ? `${row.winRate.toFixed(2)}%` : "—"}
                  </td>
                  <td className={[
                    "px-2 py-2.5 text-center tabular-nums font-medium whitespace-nowrap",
                    monthlyPctClass(row.fullYear),
                  ].join(" ")}>
                    {fmtMonthlyPct(row.fullYear)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
