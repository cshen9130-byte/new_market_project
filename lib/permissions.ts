import type { PagePermissions, User } from "@/lib/auth"
import type { InstructionRoleKey } from "@/lib/ma/instruction-roles"

export function isAdmin(user: User | null | undefined): boolean {
  return user?.role === "admin"
}

export function getInstructionRole(user: User | null | undefined): InstructionRoleKey | "" {
  const role = user?.permissions?.instructionRole
  if (role === "fund_manager" || role === "general_manager" || role === "ops") return role
  return ""
}

export function hasMaScopedPermission(
  user: User | null | undefined,
  key: keyof PagePermissions,
): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.[key] === true
}

export function canAccessAiKnowledge(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.aiKnowledge === true
}

export function canAccessAiResearcher(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.aiResearcher === true
}

export function canAccessPfOperations(user: User | null | undefined): boolean {
  return hasMaScopedPermission(user, "pfOperations")
}

/** 可进入私募基金「投资」页签 */
export function canAccessInvestmentTab(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.ma === true
}

/** 投资页内：跟踪池、直投池等（投资池以外） */
export function canAccessPfInvestmentTracking(user: User | null | undefined): boolean {
  return canAccessInvestmentTab(user)
}

/** 投资页内：投资池（投资概览、在管产品、FOF底层、资料列表） */
export function canAccessPfInvestmentPool(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.pfInvestmentPool === true
}

const INVESTMENT_POOL_GROUP_LABEL = "投资池"

export function filterInvestmentSidebarGroups<T extends { label: string }>(
  user: User | null | undefined,
  groups: T[],
): T[] {
  const showPool = canAccessPfInvestmentPool(user)
  const showTrackingDirect = canAccessPfInvestmentTracking(user)
  return groups.filter((group) => {
    if (group.label === INVESTMENT_POOL_GROUP_LABEL) return showPool
    return showTrackingDirect
  })
}

export function isAllowedInvestmentSideItem(
  user: User | null | undefined,
  sideKey: string,
): boolean {
  const poolKeys = new Set(["inv-overview", "inv-active", "inv-fof", "inv-docs"])
  if (poolKeys.has(sideKey)) return canAccessPfInvestmentPool(user)
  return canAccessPfInvestmentTracking(user)
}

export function isAllowedOperationsSideItem(user: User | null | undefined): boolean {
  return canAccessPfOperations(user)
}
