import { buildMomBriefingHtml, pickBriefingPoint, type BriefingNavPoint } from "@/lib/ma/mom-briefing-file"
import { FUND_DATA_PUBLIC_HTTPS_ORIGIN } from "@/lib/ma/fund-data-public"

const PAGE_PATH = "/ma/dashboard/mom-analysis/account-risk-report?tab=briefing"

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

function safePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim()
}

export async function getAccountBriefingFile(record: Record<string, string | undefined>): Promise<{
  ok: boolean
  error?: string
  date?: string
  file_name?: string
  mime?: string
  content_base64?: string
  page_url?: string
  note?: string
}> {
  const { GET } = await import("@/app/ma/api/account-risk/product-nav/route")
  const url = new URL("http://internal/ma/api/account-risk/product-nav")
  const book = (record.book || "").trim()
  const account = (record.account || "").trim()
  if (book) url.searchParams.set("book", book)
  else if (account && account !== "all") url.searchParams.set("account", account)
  const res = await GET(new Request(url))
  const json = await res.json() as { ok?: boolean; data?: unknown; error?: string }
  if (!json.ok) return { ok: false, error: json.error || "净值读取失败" }
  const points = asPoints(json.data)
  const latest = pickBriefingPoint(points, record.date)
  if (!latest) {
    const wanted = (record.date || "").trim()
    return { ok: false, error: wanted ? `没有 ${wanted} 的单账户简报` : "没有可用的单账户简报日期" }
  }
  const page = new URL(PAGE_PATH, `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}/`)
  if (book) page.searchParams.set("book", book)
  else if (account && account !== "all") page.searchParams.set("account", account)
  const pageUrl = page.toString()
  const title = "单账户风控简报"
  const html = buildMomBriefingHtml({
    points,
    latest,
    pageUrl,
    title,
    kicker: "SINGLE ACCOUNT RISK",
    fileTitle: "单账户风控简报",
  })
  const date = latest.date.slice(0, 10)
  const parts = ["单账户风控简报", safePart(record.productName || ""), safePart(account && account !== "all" ? account : "")]
    .filter(Boolean)
  const fileName = `${parts.join("-")}-${date}.html`
  return {
    ok: true,
    date,
    file_name: fileName,
    mime: "text/html",
    content_base64: Buffer.from(html, "utf8").toString("base64"),
    page_url: pageUrl,
    note: "content_base64 是这一日的单账户风控简报文件。解码后按 file_name 保存并交给用户。不要改数字，不要另写一份报告。page_url 是网站上带图表的同一页。",
  }
}
