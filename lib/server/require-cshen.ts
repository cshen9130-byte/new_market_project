import { getUserById } from "@/lib/server/users"

export async function requireCshen(req: Request) {
  const userId = String(req.headers.get("x-market-user-id") || "").trim()
  if (!userId) return null
  const user = await getUserById(userId)
  if (!user || user.name !== "cshen") return null
  return user
}
