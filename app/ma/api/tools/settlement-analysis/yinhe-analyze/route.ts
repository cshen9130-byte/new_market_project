import { NextResponse } from "next/server"
import { fetchYinheSettlementEmails } from "@/lib/server/yinhe-settlement-email"
import { runYinheSettlementETL } from "@/lib/server/yinhe-settlement-etl"
import { runYinheDBAnalysis } from "@/lib/server/yinhe-db-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Fetch Galaxy Futures settlement emails → ETL → analysis JSON.
 * Query: ?skipFetch=1 to analyze existing downloaded files / DB only.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const skipFetch = url.searchParams.get("skipFetch") === "1"
    const lookbackRaw = url.searchParams.get("lookbackDays")
    const lookbackDays = lookbackRaw ? Number(lookbackRaw) : undefined

    const fetchResult = skipFetch
      ? null
      : await fetchYinheSettlementEmails(
          Number.isFinite(lookbackDays) ? { lookbackDays } : undefined,
        )

    const etl = await runYinheSettlementETL()
    const analysis = await runYinheDBAnalysis()

    return NextResponse.json({
      ...analysis,
      meta: {
        fetch: fetchResult
          ? {
              downloaded: fetchResult.downloaded.length,
              skipped: fetchResult.skipped.length,
              errors: fetchResult.errors,
              log: fetchResult.log.slice(-30),
              folder: fetchResult.folder,
            }
          : null,
        etl: {
          days: etl.days,
          accountUpserts: etl.accountUpserts,
          tradeRows: etl.tradeRows,
          positionRows: etl.positionRows,
          closedRows: etl.closedRows,
          warnings: etl.warnings.slice(0, 20),
        },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "银河期货邮件分析失败。"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
