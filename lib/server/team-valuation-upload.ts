import { createHash } from "crypto"
import { extractValuationFromBuffer } from "@/lib/server/email-valuation-attachment"
import {
  upsertEmailValuationRecords,
  type EmailValuationInsert,
} from "@/lib/server/email-valuation-pg"
import { refreshValuationPipelineForTouchedFunds } from "@/lib/server/valuation-cache-refresh"

const MANUAL_CRAWL_ACCOUNT = "team_manual_upload"
const MAX_FILES = 100
const MAX_FILE_BYTES = 15 * 1024 * 1024

export type TeamValuationUploadResult =
  | { saved: number; failed: string[] }
  | { error: "missing_fields" | "too_many_files" | "invalid_files" }

function manualEmailUid(beian_hao: string, filename: string, buffer: Buffer): string {
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 16)
  return `${beian_hao}_${hash}_${filename}`
}

export async function uploadTeamValuationFiles(options: {
  beian_hao: string
  product_name: string
  files: File[]
}): Promise<TeamValuationUploadResult> {
  const beian_hao = options.beian_hao.trim().toUpperCase()
  const product_name = options.product_name.trim()
  if (!beian_hao || !product_name) return { error: "missing_fields" }

  const files = options.files.filter((file) => /\.xlsx?$/i.test(file.name))
  if (files.length === 0) return { error: "invalid_files" }
  if (files.length > MAX_FILES) return { error: "too_many_files" }

  const sentAt = new Date().toISOString()
  const subject = `${beian_hao}_${product_name}_manual_upload`
  const inserts: EmailValuationInsert[] = []
  const failed: string[] = []

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      failed.push(`${file.name}: 文件过大`)
      continue
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const extracted = extractValuationFromBuffer(buffer, file.name, subject)
      if (!extracted) {
        failed.push(`${file.name}: 无法解析估值表`)
        continue
      }

      // Bind to the product the operator selected so 估值表分析 can resolve by beian_hao.
      // Extracted codes from the workbook can differ (share-class / custodian codes).
      inserts.push({
        crawlEmailAccount: MANUAL_CRAWL_ACCOUNT,
        emailUid: manualEmailUid(beian_hao, file.name, buffer),
        sentAt,
        subject,
        senderEmail: "",
        attachmentFilename: file.name,
        productCode: beian_hao,
        fundName: extracted.fundName ?? product_name,
        valuationDate: extracted.valuationDate,
        unitNav: extracted.unitNav,
        cumulativeNav: extracted.cumulativeNav,
        custodyBalance: extracted.custodyBalance,
        netAssetValue: extracted.netAssetValue,
        paidInCapital: extracted.paidInCapital,
        totalAsset: extracted.totalAsset,
        totalLiability: extracted.totalLiability,
        custodian: extracted.custodian,
        netAsset: extracted.netAssetValue,
        underlyingHoldings: extracted.underlyingHoldings,
        holdingsCount: extracted.holdingsCount,
        source: "manual_upload",
        summary: extracted.analysis.summary,
        holdings: extracted.analysis.portfolio_data,
      })
    } catch {
      failed.push(`${file.name}: 解析失败`)
    }
  }

  if (inserts.length === 0) {
    return failed.length > 0 ? { saved: 0, failed } : { error: "invalid_files" }
  }

  const result = await upsertEmailValuationRecords(inserts)

  // Product 估值表 page reads *_latest tables + precomputed cache. Email ETL
  // refreshes those after parse; manual upload must do the same or data stays invisible.
  if (result.recordsSaved > 0) {
    const touchedCodes = new Set<string>([beian_hao])
    for (const row of inserts) {
      const code = row.productCode?.trim().toUpperCase()
      if (code) touchedCodes.add(code)
    }
    await refreshValuationPipelineForTouchedFunds(
      [...touchedCodes].map((productCode) => ({ productCode, fundName: product_name })),
    )
  }

  return { saved: result.recordsSaved, failed }
}
