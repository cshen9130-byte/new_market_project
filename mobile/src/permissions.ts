import type { User } from "@/types"

export function isAdmin(user: User | null | undefined): boolean {
  return String(user?.role || "").toLowerCase() === "admin"
}


/** Same as website investment pool (managed / FOF / MOM underlying). */
export function canAccessPfInvestmentPool(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.pfInvestmentPool === true
}

/** Same as website MOM risk module. */
export function canAccessMom(user: User | null | undefined): boolean {
  if (!user) return false
  if (isAdmin(user)) return true
  return user.permissions?.mom === true
}
