import { fundDataErr, type FundDataErr } from "@/lib/server/fund-data-api"
import { getUserByApiKey, type StoredUser } from "@/lib/server/users"

export function readFundDataApiKey(req: Request): string {
  const header = String(req.headers.get("x-api-key") || "").trim()
  if (header) return header
  const auth = String(req.headers.get("authorization") || "").trim()
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim()
  try {
    return new URL(req.url).searchParams.get("api_key")?.trim() || ""
  } catch {
    return ""
  }
}

export async function requireFundDataApiUser(req: Request): Promise<
  | { ok: true; user: Omit<StoredUser, "passwordHash"> }
  | { ok: false; status: number; body: FundDataErr }
> {
  const key = readFundDataApiKey(req)
  if (!key) {
    return { ok: false, status: 401, body: fundDataErr(401, "api_key is required") }
  }
  const user = await getUserByApiKey(key)
  if (!user) {
    return { ok: false, status: 401, body: fundDataErr(401, "invalid api_key") }
  }
  return { ok: true, user }
}
