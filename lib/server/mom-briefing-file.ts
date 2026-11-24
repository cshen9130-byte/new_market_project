import { buildMomBriefingHtml, pickBriefingPoint, type BriefingNavPoint } from "@/lib/ma/mom-briefing-file"
import { FUND_DATA_PUBLIC_HTTPS_ORIGIN } from "@/lib/ma/fund-data-public"
import { momDataErr, momDataOk, type MomDataEnvelope } from "@/lib/server/mom-data-api"

const PAGE_URL = `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}/ma/dashboard/mom-analysis/risk-report?tab=briefing`

function asPoints(value: unknown): BriefingNavPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const date = String(row.date || "").slice(0, 10)
    const nav = Number(row.nav)
    const cumCapital = Number(row.cumCapital ?? 0)
    const dailyReturn = Number(row.dailyReturn ?? 0)
    if (!date || !Number.isFinite(nav)) return []
    return [{ date, nav, cumCapital, dailyReturn }]
  })
}

export async function getMomBriefingFile(record: Record<string, string | undefined>): Promise<MomDataEnvelope<unknown>> {
  const { GET } = await import("@/app/ma/api/mom-analysis/product-nav/route")
  const res = await GET(new Request("http://internal/ma/api/mom-analysis/product-nav"))
  const json = await res.json() as { ok?: boolean; data?: unknown; error?: string }
  if (!json.ok) return momDataErr(3, json.error || "净值读取失败")
  const points = asPoints(json.data)
  const latest = pickBriefingPoint(points, record.date)
  if (!latest) {
    const wanted = (record.date || "").trim()
    return momDataErr(1, wanted ? `没有 ${wanted} 的 MOM 简报` : "没有可用的 MOM 简报日期")
  }
  const html = buildMomBriefingHtml({ points, latest, pageUrl: PAGE_URL })
  const date = latest.date.slice(0, 10)
  const fileName = `MOM风控简报-${date}.html`
  return momDataOk({
    date,
    file_name: fileName,
    mime: "text/html",
    content_base64: Buffer.from(html, "utf8").toString("base64"),
    page_url: PAGE_URL,
    note: "content_base64 是这一日的 MOM 风控简报文件。解码后按 file_name 保存并交给用户。不要改数字，不要另写一份报告。page_url 是网站上带图表的同一页。",
  })
}
