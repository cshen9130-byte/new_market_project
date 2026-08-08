/** Roles used by the 指令 (instruction) approval workflow. */
export const INSTRUCTION_ROLES = [
  { key: "fund_manager", label: "基金经理" },
  { key: "general_manager", label: "总经理" },
  { key: "ops", label: "产品运维" },
] as const

export type InstructionRoleKey = (typeof INSTRUCTION_ROLES)[number]["key"]

export const INSTRUCTION_TYPE_OPTIONS = [
  "底层申赎类",
  "直投申赎类",
  "入/出池审批",
] as const

export type InstructionTypeOption = (typeof INSTRUCTION_TYPE_OPTIONS)[number]

export const OFFICIAL_PROCESS_NODES: Record<InstructionTypeOption, string[]> = {
  底层申赎类: ["基金经理发起", "总经理审批", "产品运维执行", "产品运维确认", "指令结束"],
  直投申赎类: ["基金经理发起", "总经理审批", "产品运维执行", "产品运维确认", "指令结束"],
  "入/出池审批": ["基金经理发起", "总经理审批", "指令结束"],
}

export function instructionRoleLabel(role: string | null | undefined): string {
  if (!role) return "未分配"
  return INSTRUCTION_ROLES.find((r) => r.key === role)?.label ?? "未分配"
}

export function isInstructionRoleKey(value: unknown): value is InstructionRoleKey {
  return typeof value === "string" && INSTRUCTION_ROLES.some((r) => r.key === value)
}

/** Display name shown in the 指令 process UI. */
export function instructionRoleDisplayName(
  permissions: { instructionRoleName?: string } | null | undefined,
  fallbackName?: string | null,
): string {
  const custom = permissions?.instructionRoleName?.trim()
  if (custom) return custom
  return (fallbackName || "").trim()
}
