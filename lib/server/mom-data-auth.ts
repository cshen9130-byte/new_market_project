import { canAccessMomDataApi } from "@/lib/permissions"
import { readFundDataApiKey } from "@/lib/server/fund-data-auth"
import { momDataErr, type MomDataErr } from "@/lib/server/mom-data-api"
import { getUserByApiKey, getUserByMomApiKey, type StoredUser } from "@/lib/server/users"

export type MomDataUser = Omit<StoredUser, "passwordHash">

export async function requireMomDataApiUser(req: Request): Promise<
  | { ok: true; user: MomDataUser }
  | { ok: false; status: number; body: MomDataErr }
> {
  const key = readFundDataApiKey(req)
  if (!key) {
    return { ok: false, status: 401, body: momDataErr(401, "api_key is required") }
  }
  const user = await getUserByMomApiKey(key)
  if (!user) {
    const fundUser = await getUserByApiKey(key)
    const msg = fundUser
      ? "invalid api_key; the fund-data key cannot be used on the MOM data API"
      : "invalid api_key"
    return { ok: false, status: 401, body: momDataErr(401, msg) }
  }
  if (!canAccessMomDataApi(user)) {
    return {
      ok: false,
      status: 403,
      body: momDataErr(403, "this account is not allowed to call the MOM data API"),
    }
  }
  return { ok: true, user }
}
