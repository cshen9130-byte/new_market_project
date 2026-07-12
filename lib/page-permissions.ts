import type { PagePermissions } from "@/lib/auth"

export const PERM_COLUMNS: { key: keyof PagePermissions; label: string; hint?: string }[] = [
  { key: "ma", label: "MA 市场监控" },
  { key: "classic", label: "分析看板（传统风格）" },
  { key: "mom", label: "MOM 分析" },
  { key: "aiKnowledge", label: "AI 知识库" },
  { key: "aiResearcher", label: "AI 研究员" },
  { key: "pfOperations", label: "私募基金-运维" },
  { key: "pfInvestmentPool", label: "私募基金-投资（投资池）", hint: "勾选后可访问投资概览、在管产品、FOF底层、资料列表" },
]

export function buildPermissionsSnapshot(source: PagePermissions | undefined): PagePermissions {
  const result: PagePermissions = {}
  for (const col of PERM_COLUMNS) {
    result[col.key] = !!source?.[col.key]
  }
  return result
}
