import { associationKey, type InvestmentNoteAssociation, type InvestmentNoteExtractedProduct } from "@/lib/ma/investment-notes"
import {
  matchFundsFromExtracted,
  pickHighConfidenceFundMatch,
  type ExtractedFundElements,
  type FundMatchCandidate,
} from "@/lib/server/fund-contract-element-extract"
import { findElementExtractJobsForMaterials } from "@/lib/server/fund-element-extract-jobs"
import { listInvestmentNoteMaterialExtractLinks } from "@/lib/server/investment-note-materials"
import { getServerInvestmentNote } from "@/lib/server/investment-notes"
import { searchTrackingFunds } from "@/lib/server/fund-picker-search"

export type InvestmentNoteExtractedProductsResult = {
  products: InvestmentNoteExtractedProduct[]
  pendingCount: number
}

const EMPTY_ELEMENTS: ExtractedFundElements = {
  fund_name: null,
  register_number: null,
  advisor: null,
  fund_manager: null,
  inception_date: null,
  puton_date: null,
  custodian: null,
  open_day: null,
  is_temporary_open: null,
  fee_purchase: null,
  add_amount: null,
  fee_redeem: null,
  precautious_line: null,
  closed_period: null,
  stop_line: null,
  fee_manage_rate: null,
  fee_trust: null,
  fee_manage: null,
  fee_admin_service: null,
  fee_pay: null,
  risk_level: null,
  lock_period_desc: null,
  fee_pay_formula: null,
}

function associationFromExtracted(item: InvestmentNoteExtractedProduct): InvestmentNoteAssociation {
  return {
    category: "私募基金",
    name: item.name,
    recordNo: item.recordNo,
  }
}

function productKey(item: Pick<InvestmentNoteExtractedProduct, "name" | "recordNo">): string {
  return associationKey(associationFromExtracted({ ...item, sourceFile: "", confidence: "extracted" }))
}

function compactName(value: string): string {
  return value.replace(/[（）()【】\[\]\s·\-—_]/g, "").replace(/投资笔记$/u, "")
}

function namesOverlap(a: string, b: string): boolean {
  const left = compactName(a)
  const right = compactName(b)
  if (left.length < 6 || right.length < 6) return false
  return left.includes(right) || right.includes(left)
}

function addProduct(
  target: Map<string, InvestmentNoteExtractedProduct>,
  item: InvestmentNoteExtractedProduct,
) {
  const name = item.name.trim()
  const recordNo = item.recordNo.trim()
  if (!name && !recordNo) return
  const next: InvestmentNoteExtractedProduct = {
    name: name || recordNo,
    recordNo,
    sourceFile: (item.sourceFile || "").trim(),
    confidence: item.confidence || "extracted",
  }
  const key = productKey(next)
  const existing = target.get(key)
  if (!existing) {
    target.set(key, next)
    return
  }
  const rank = { applied: 3, matched: 2, extracted: 1 } as const
  const nextRank = rank[next.confidence || "extracted"]
  const existingRank = rank[existing.confidence || "extracted"]
  if (nextRank > existingRank) {
    target.set(key, next)
    return
  }
  if (!existing.sourceFile && next.sourceFile) {
    target.set(key, { ...existing, sourceFile: next.sourceFile })
  }
}

function productsFromMatchedFund(
  fund: FundMatchCandidate,
  sourceFile: string,
  confidence: InvestmentNoteExtractedProduct["confidence"],
): InvestmentNoteExtractedProduct {
  return {
    name: fund.product_name.trim() || fund.beian_hao,
    recordNo: fund.beian_hao.trim(),
    sourceFile,
    confidence,
  }
}

export async function resolveExtractedProductCandidates(
  raw: Array<{ name?: string | null; recordNo?: string | null }>,
  sourceFile = "",
): Promise<InvestmentNoteExtractedProduct[]> {
  const out = new Map<string, InvestmentNoteExtractedProduct>()
  for (const item of raw) {
    const name = String(item.name || "").trim()
    const recordNo = String(item.recordNo || "").trim()
    if (!name && !recordNo) continue
    const extracted: ExtractedFundElements = {
      ...EMPTY_ELEMENTS,
      fund_name: name || null,
      register_number: recordNo || null,
    }
    try {
      const matched = await matchFundsFromExtracted(extracted, { fileName: sourceFile || name })
      const picked = pickHighConfidenceFundMatch(extracted, matched, { fileName: sourceFile || name })
      if (picked) {
        addProduct(out, productsFromMatchedFund(picked, sourceFile, "matched"))
        continue
      }
      for (const fund of matched.slice(0, 5)) {
        addProduct(out, productsFromMatchedFund(fund, sourceFile, "matched"))
      }
      if (matched.length === 0) {
        addProduct(out, {
          name: name || recordNo,
          recordNo,
          sourceFile,
          confidence: "extracted",
        })
      }
    } catch {
      addProduct(out, {
        name: name || recordNo,
        recordNo,
        sourceFile,
        confidence: "extracted",
      })
    }
  }
  return Array.from(out.values())
}

async function suggestFundsFromTitle(title: string): Promise<InvestmentNoteExtractedProduct[]> {
  const cleaned = title.replace(/投资笔记$/u, "").trim()
  if (cleaned.length < 8 || cleaned === "无标题") return []
  try {
    const rows = await searchTrackingFunds(cleaned, 8)
    return rows
      .filter((row) => namesOverlap(row.product_name, cleaned))
      .slice(0, 6)
      .map((row) => productsFromMatchedFund(row, "", "matched"))
  } catch {
    return []
  }
}

export async function collectExtractedProductsForNote(
  noteId: string,
  userId: string,
): Promise<InvestmentNoteExtractedProductsResult> {
  const note = getServerInvestmentNote(noteId, userId)
  if (!note) throw new Error("笔记不存在")

  const materials = listInvestmentNoteMaterialExtractLinks(note.id)
  const jobs = await findElementExtractJobsForMaterials({
    jobIds: materials.map((item) => item.extractJobId ?? 0),
    contentHashes: materials.map((item) => item.contentHash ?? ""),
    filenames: materials.map((item) => item.name),
  })

  const jobById = new Map(jobs.map((job) => [job.id, job]))
  const usedJobIds = new Set<number>()
  const products = new Map<string, InvestmentNoteExtractedProduct>()
  let pendingCount = 0

  const consumeJob = (
    job: (typeof jobs)[number] | undefined,
    sourceFile: string,
  ) => {
    if (!job || usedJobIds.has(job.id)) return
    usedJobIds.add(job.id)
    if (job.status === "queued" || job.status === "extracting") {
      pendingCount += 1
    }
    const fileName = sourceFile || job.original_filename
    if (job.beian_hao || job.product_name) {
      addProduct(products, {
        name: (job.product_name || job.beian_hao || "").trim(),
        recordNo: (job.beian_hao || "").trim(),
        sourceFile: fileName,
        confidence: job.status === "applied" ? "applied" : "matched",
      })
    }
    for (const fund of job.matched_funds ?? []) {
      addProduct(
        products,
        productsFromMatchedFund(
          fund,
          fileName,
          job.beian_hao === fund.beian_hao ? "applied" : "matched",
        ),
      )
    }
    const extractedName = job.extracted_json?.fund_name?.trim() || ""
    const extractedCode = job.extracted_json?.register_number?.trim() || ""
    if (extractedName || extractedCode) {
      addProduct(products, {
        name: extractedName || extractedCode,
        recordNo: extractedCode,
        sourceFile: fileName,
        confidence: "extracted",
      })
    }
  }

  for (const material of materials) {
    const byId = material.extractJobId ? jobById.get(material.extractJobId) : undefined
    consumeJob(byId, material.name)
  }
  for (const job of jobs) {
    consumeJob(job, job.original_filename)
  }

  for (const item of note.extractedProducts ?? []) {
    addProduct(products, {
      name: item.name,
      recordNo: item.recordNo,
      sourceFile: item.sourceFile || "",
      confidence: item.confidence || "extracted",
    })
  }

  if (products.size === 0 && pendingCount === 0 && materials.length > 0) {
    for (const item of await suggestFundsFromTitle(note.title)) {
      addProduct(products, item)
    }
  }

  return {
    products: Array.from(products.values()),
    pendingCount,
  }
}
