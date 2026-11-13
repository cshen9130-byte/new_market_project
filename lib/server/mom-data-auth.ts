import { canAccessMomDataApi } from "@/lib/permissions"
import { readFundDataApiKey } from "@/lib/server/fund-data-auth"
import {
  credentialFailureDescription,
  originFromRequest,
  resolveMcpCredential,
  unauthorizedHeaders,
  type CredentialFailure,
} from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"
import { momDataErr, type MomDataErr } from "@/lib/server/mom-data-api"
import { getUserByApiKey, getUserById, getUserByMomApiKey, type StoredUser } from "@/lib/server/users"

export type MomDataUser = Omit<StoredUser, "passwordHash">

function failureHeaders(req: Request, reason: CredentialFailure) {
  const error = reason === "missing" ? undefined : "invalid_token" as const
  return unauthorizedHeaders(originFromRequest(req), "mom-data", error, credentialFailureDescription(reason))
}

export async function requireMomDataApiUser(req: Request): Promise<
  | { ok: true; user: MomDataUser }
  | { ok: false; status: number; body: MomDataErr; headers?: Record<string, string> }
> {
  const key = readFundDataApiKey(req)
  const resolved = await resolveMcpCredential({
    rawKey: key,
    family: "mom-data",
    store: getMcpOAuthStore(),
    getUserById,
    getUserByApiKey: getUserByMomApiKey,
  })
  if (!resolved.ok) {
    if (resolved.reason === "missing") {
      return {
        ok: false,
        status: 401,
        body: momDataErr(401, "api_key is required"),
        headers: failureHeaders(req, resolved.reason),
      }
    }
    if (resolved.reason === "wrong_resource") {
      return {
        ok: false,
        status: 401,
        body: momDataErr(401, "access token is not valid for the MOM data API"),
        headers: failureHeaders(req, resolved.reason),
      }
    }
    // Preserve the old hint when a fund-data API key is sent to the MOM API.
    const fundUser = key ? await getUserByApiKey(key) : null
    const msg = fundUser
      ? "invalid api_key; the fund-data key cannot be used on the MOM data API"
      : "invalid api_key"
    return {
      ok: false,
      status: 401,
      body: momDataErr(401, msg),
      headers: failureHeaders(req, resolved.reason),
    }
  }
  if (!canAccessMomDataApi(resolved.user)) {
    return {
      ok: false,
      status: 403,
      body: momDataErr(403, "this account is not allowed to call the MOM data API"),
    }
  }
  return { ok: true, user: resolved.user }
}
