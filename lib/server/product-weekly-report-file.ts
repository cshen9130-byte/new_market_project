import { accountCanUseMom } from "@/lib/ma/account-dashboard"
import { FUND_DATA_PUBLIC_HTTPS_ORIGIN } from "@/lib/ma/fund-data-public"
import { pickProductWeeklyReport } from "@/lib/ma/product-weekly-report-pick"
import { readAccountDashboard } from "@/lib/server/account-dashboard-store"
import {
  enrichAutoWeeklyListItems,
  listAutoWeeklyReportsForDisplay,
  readAutoWeeklyReportFile,
} from "@/lib/server/auto-weekly-reports"
import type { McpAccount } from "@/lib/server/mcp-account-access"

const PAGE_URL = `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}/ma/dashboard/private-funds?tab=reports&side=rpt-weekly`
const FILE_CAP = 7_000_000

export async function getProductWeeklyReportFile(
  account: McpAccount,
  record: Record<string, string | undefined>,
): Promise<{
  error_code: number
  msg: string
  data: unknown
}> {
  const query = (record.q || record.product || record.name || record.reg_code || "").trim()
  if (!query) {
    return { error_code: 1, msg: "请提供产品名或备案号", data: null }
  }
  const prefs = await readAccountDashboard(account.id, accountCanUseMom(account), {
    name: account.name,
    email: account.email,
  })
  const rows = await enrichAutoWeeklyListItems(
    listAutoWeeklyReportsForDisplay(prefs.weeklyReportTemplate),
  )
  const picked = pickProductWeeklyReport(rows, query, record.week_end)
  if (picked.status === "empty") {
    return { error_code: 1, msg: `产品周报里没有「${query}」`, data: { page_url: PAGE_URL } }
  }
  if (picked.status === "ambiguous") {
    return {
      error_code: 1,
      msg: "名称对应多只产品，请改用更完整的名称或备案号",
      data: { products: picked.products, page_url: PAGE_URL },
    }
  }
  if (picked.status === "missing_week") {
    return {
      error_code: 1,
      msg: "这一周没有该产品的周报",
      data: { weeks: picked.weeks, page_url: PAGE_URL },
    }
  }
  const format = record.format === "png" ? "png" : "pdf"
  const file = readAutoWeeklyReportFile(picked.row.reportId, format)
  if (file.buffer.length > FILE_CAP) {
    return { error_code: 3, msg: "周报文件过大，请到网站产品周报页下载", data: { page_url: PAGE_URL } }
  }
  const row = picked.row
  return {
    error_code: 0,
    msg: "ok",
    data: {
      product_name: row.product_name,
      beian_hao: row.beian_hao,
      title: row.title,
      week_start: row.weekStart,
      week_end: row.weekEnd,
      template_name: row.templateName,
      weeks: picked.weeks,
      format,
      file_name: file.fileName,
      mime: file.contentType,
      content_base64: file.buffer.toString("base64"),
      page_url: PAGE_URL,
      note: "content_base64 是产品周报页上的 PDF 或 PNG。按 file_name 保存后交给用户。不要打开文件重算，不要另写报告。",
    },
  }
}
