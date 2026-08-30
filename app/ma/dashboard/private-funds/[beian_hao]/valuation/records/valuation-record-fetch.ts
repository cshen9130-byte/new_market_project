export type ValuationRecordDetail = {
  id: number
  fundName: string | null
  valuationDate: string | null
  unitNav: number | null
  cumulativeNav: number | null
  netAsset: number | null
  holdingsCount: number | null
  attachmentFilename: string | null
  normalizedHoldings?: Array<{
    subjectCode?: string
    originalSubjectCode?: string | null
    subjectName?: string
    symbol?: string | null
    rowKind?: string | null
    assetClass?: string | null
    includeInDetail?: boolean
    includeInAnalysis?: boolean
    quantity?: number | null
    price?: number | null
    marketValue?: number | null
    marketWeight?: number | null
  }>
}

export async function fetchValuationRecordDetail(recordId: number): Promise<ValuationRecordDetail> {
  const res = await fetch(`/ma/api/ops/email-valuation-records/${recordId}?detailOnly=false`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<ValuationRecordDetail>
}

function parseAttachmentFilename(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1]
  if (encoded) return decodeURIComponent(encoded)
  const plain = /filename="([^"]+)"/i.exec(contentDisposition)?.[1]
  return plain ?? fallback
}

export async function downloadValuationAttachment(
  recordId: number,
  fallbackFilename?: string | null,
): Promise<void> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(`/ma/api/ops/email-valuation-records/${recordId}/attachment`, {
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }))
      throw new Error(body.error ?? `下载失败（HTTP ${res.status}）`)
    }
    const blob = await res.blob()
    if (!blob.size) throw new Error("下载内容为空")
    const filename = parseAttachmentFilename(
      res.headers.get("Content-Disposition"),
      fallbackFilename?.trim() || `valuation_${recordId}.xlsx`,
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.rel = "noopener"
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("下载超时，请稍后重试")
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }
}
