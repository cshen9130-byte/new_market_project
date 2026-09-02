import type { PagePermissions } from "@/lib/auth"
import {
  normalizeInstructionRoles,
  type InstructionRoleKey,
} from "@/lib/ma/instruction-roles"

export const PERM_COLUMNS: { key: keyof PagePermissions; label: string; hint?: string }[] = [
  { key: "ma", label: "MA 市场监控" },
  { key: "classic", label: "分析看板（传统风格）" },
  { key: "mom", label: "MOM 分析" },
  { key: "aiKnowledge", label: "AI 知识库" },
  { key: "aiResearcher", label: "AI 研究员" },
  { key: "pfOperations", label: "私募基金-运维" },
  { key: "pfInvestmentPool", label: "私募基金-投资（投资池）", hint: "勾选后可访问投资概览、在管产品、FOF底层、资料列表" },
  { key: "pfTraderManage", label: "盘手管理", hint: "勾选后可在运维团队数据中关联产品与 MOM 账户" },
  { key: "pfCompareAccount", label: "修改对比账户", hint: "勾选后可在产品页账户对比中切换对比账户" },
]

export function buildPermissionsSnapshot(source: PagePermissions | undefined): PagePermissions {
  const result: PagePermissions = {}
  for (const col of PERM_COLUMNS) {
    result[col.key] = !!source?.[col.key]
  }
  // Preserve non-boolean instruction workflow fields when saving page permissions.
  const roles = normalizeInstructionRoles(source)
  if (roles.length > 0) {
    result.instructionRoles = roles
    result.instructionRole = roles[0]
  }
  if (source?.instructionRoleName) {
    result.instructionRoleName = source.instructionRoleName
  }
  return result
}

export function withInstructionAssignment(
  source: PagePermissions | undefined,
  roles: InstructionRoleKey[],
  roleName: string,
): PagePermissions {
  const normalized = normalizeInstructionRoles({ instructionRoles: roles })
  return {
    ...buildPermissionsSnapshot(source),
    instructionRoles: normalized,
    instructionRole: normalized[0] ?? "",
    instructionRoleName: roleName,
  }
}
