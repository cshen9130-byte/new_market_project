/**
 * ima点睛 rows for one 周度回顾(股票) week.
 * The board lists managers, not products, so these rows keep the published
 * number on the sheet's 口径: 近一周超额 on a 指增 sheet, 近一周收益率 elsewhere.
 * 今年以来 is not 近一年.
 */

import { readFile } from "fs/promises"
import * as XLSX from "xlsx"
import { getKnowledgeBaseFile } from "@/lib/server/knowledge-base"
import { loadExternalRankWeekFiles } from "@/lib/server/external-rank-week"
import {
  emptyXiaohePeriods,
  imaDisplayName,
  parseImaRankGrid,
  xiaoheNameKey,
  xiaoheOcrComparable,
  xiaoheStrategyBucket,
  type ImaRankRow,
  type XiaoheOcrRow,
} from "@/lib/ma/xiaohe-weekly-rows"
import { WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS } from "@/lib/weekly-review-data-status"
import {
  metricModeForBucket,
  type FundMetrics,
} from "@/lib/server/jy-weekly-review"
import type { XiaoheWeeklyRow } from "@/lib/server/xiaohe-weekly-rows"

function asOcr(row: ImaRankRow): XiaoheOcrRow {
  return {
    product: imaDisplayName(row),
    manager: row.manager,
    strategy: row.strategy,
    ret: { ...emptyXiaohePeriods(), ret_1w: row.ret1w },
    excess1w: row.excess1w,
  }
}

function metricsFromPublished(name: string, bucket: string, row: ImaRankRow): FundMetrics {
  const mode = metricModeForBucket(bucket)
  const blank = emptyXiaohePeriods()
  const body = xiaoheOcrComparable(asOcr(row))
  return {
    beian_hao: "",
    name,
    bucket,
    mode,
    ret: mode === "absolute" ? { ...body.ret } : { ...blank },
    excess: mode === "excess" ? { ...blank, ret_1w: body.excess.ret_1w } : { ...blank },
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

async function readImaRows(weekEnd: string): Promise<ImaRankRow[]> {
  const files = await loadExternalRankWeekFiles(weekEnd, "ima")
  const out: ImaRankRow[] = []
  for (const file of files) {
    try {
      const stored = await getKnowledgeBaseFile(file.path)
      const data = await readFile(stored.absolutePath)
      const workbook = XLSX.read(data, { type: "buffer", cellDates: true })
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (!sheet) continue
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          blankrows: false,
        })
        out.push(...parseImaRankGrid(grid))
      }
    } catch (err) {
      console.error("[ima-weekly] file skipped:", file.name, err)
    }
  }
  return out
}

export async function loadImaWeeklyRows(weekEnd: string): Promise<XiaoheWeeklyRow[]> {
  const seen = new Set<string>()
  const out: XiaoheWeeklyRow[] = []
  for (const row of await readImaRows(weekEnd)) {
    const bucket = xiaoheStrategyBucket(row.strategy)
    if (!bucket || WEEKLY_REVIEW_STATUS_HIDDEN_BUCKETS.has(bucket)) continue
    const mode = metricModeForBucket(bucket)
    if (mode === "excess" && row.excess1w == null) continue
    if (mode === "absolute" && row.ret1w == null) continue
    const name = imaDisplayName(row)
    const nameKey = xiaoheNameKey(name)
    if (!nameKey || seen.has(`${bucket}\0${nameKey}`)) continue
    seen.add(`${bucket}\0${nameKey}`)
    out.push({
      bucket,
      metrics: metricsFromPublished(name, bucket, row),
      fromDatabase: false,
      nameKey,
    })
  }
  return out
}
