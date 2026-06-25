import type { PagePermissions } from "@/lib/auth"

export const PERM_COLUMNS: { key: keyof PagePermissions; label: string; hint?: string }[] = [
  { key: "ma", label: "MA 市场监控" },
  { key: "classic", label: "分析看板（传统风格）" },
  { key: "mom", label: "MOM 分析" },
  { key: "aiKnowledge", label: "AI 知识库" },
  { key: "pfOperations", label: "私募基金-运维" },
  {
    key: "pfInvestmentAlt",
    label: "私募基金-投资（不含投资池）",
    hint: "仍可进投资页，仅隐藏投资池",
  },
]

export function buildPermissionsSnapshot(source: PagePermissions | undefined): PagePermissions {
  const result: PagePermissions = {}
  for (const col of PERM_COLUMNS) {
    result[col.key] = !!source?.[col.key]
  }
  return result
}
