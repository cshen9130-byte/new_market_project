import { fmtIso, n, query } from "@/lib/db"
import {
  PRIVATE_FUND_BENCHMARK_OPTIONS,
  type PrivateFundBenchmarkKey,
  type PrivateFundBenchmarkOption,
} from "@/lib/ma/private-fund-benchmark-options"
import { loadCcidxCommodityIndexPrices } from "@/lib/server/ccidx-commodity-index"
import { loadCi011001RebuildPrices } from "@/lib/server/ci011001-rebuild"

type LoadableBenchmark = Exclude<PrivateFundBenchmarkOption, { key: "" }>

export function isPrivateFundBenchmarkKey(key: string): key is PrivateFundBenchmarkKey {
  return PRIVATE_FUND_BENCHMARK_OPTIONS.some((option) => option.key === key && option.key !== "")
}

function findBenchmark(key: string): LoadableBenchmark | null {
  const hit = PRIVATE_FUND_BENCHMARK_OPTIONS.find((option) => option.key === key)
  if (!hit || hit.key === "") return null
  return hit
}

export async function loadPrivateFundBenchmarkSeries(
  key: PrivateFundBenchmarkKey,
  from: string,
  to: string,
): Promise<{ label: string; data: { date: string; value: number }[] }> {
  const meta = findBenchmark(key)
  if (!meta) {
    throw new Error("无效的基准代码")
  }

  if (meta.source === "spot") {
    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT DISTINCT ON (trade_date) trade_date, close
       FROM raw_spot_daily
       WHERE symbol = $1
         AND trade_date >= $2
         AND trade_date <= $3
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC, fetched_at DESC`,
      [meta.symbol, from, to],
    )
    return {
      label: meta.label,
      data: rows
        .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
        .filter((row): row is { date: string; value: number } => row.value !== null),
    }
  }

  if (meta.source === "ccidx") {
    return {
      label: meta.label,
      data: await loadCcidxCommodityIndexPrices(from, to),
    }
  }

  if (meta.source === "ashare") {
    const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT trade_date, close
       FROM raw_ashare_index_daily
       WHERE ts_code = $1
         AND trade_date >= $2
         AND trade_date <= $3
         AND close IS NOT NULL
         AND close > 0
       ORDER BY trade_date ASC`,
      [meta.tsCode, from, to],
    )
    return {
      label: meta.label,
      data: rows
        .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
        .filter((row): row is { date: string; value: number } => row.value !== null),
    }
  }

  if (meta.source === "ci011001_rebuild") {
    return {
      label: meta.label,
      data: await loadCi011001RebuildPrices(from, to),
    }
  }

  if (meta.source === "etf") {
    const rows = await query<{ trade_date: Date | string; value: string | number | null }>(
      `SELECT trade_date, value
       FROM raw_etf_daily
       WHERE ticker = $1
         AND field = 'ORIGINALUNIT'
         AND trade_date >= $2
         AND trade_date <= $3
         AND value IS NOT NULL
         AND value > 0
       ORDER BY trade_date ASC`,
      [meta.ticker, from, to],
    )
    return {
      label: meta.label,
      data: rows
        .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.value) }))
        .filter((row): row is { date: string; value: number } => row.value !== null),
    }
  }

  const rows = await query<{ trade_date: Date | string; close: string | number | null }>(
    `SELECT trade_date, close
     FROM raw_nanhua_indices_daily
     WHERE code = $1
       AND trade_date >= $2
       AND trade_date <= $3
       AND close IS NOT NULL
       AND close > 0
     ORDER BY trade_date ASC`,
    [meta.code, from, to],
  )
  return {
    label: meta.label,
    data: rows
      .map((row) => ({ date: fmtIso(row.trade_date), value: n(row.close) }))
      .filter((row): row is { date: string; value: number } => row.value !== null),
  }
}
