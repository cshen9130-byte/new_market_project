import { getUserById } from "@/lib/server/users"

export async function requireLoggedIn(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null
  return getUserById(userId)
}

export async function requireCshen(req: Request) {
  const user = await requireLoggedIn(req)
  if (!user || user.name !== "cshen") return null
  return user
}
