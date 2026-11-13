import { fundDataErr, type FundDataErr } from "@/lib/server/fund-data-api"
import {
  credentialFailureDescription,
  originFromRequest,
  resolveMcpCredential,
  unauthorizedHeaders,
  type CredentialFailure,
} from "@/lib/server/mcp-oauth"
import { getMcpOAuthStore } from "@/lib/server/mcp-oauth-store"
import { getUserByApiKey, getUserById, type StoredUser } from "@/lib/server/users"

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

function failureHeaders(req: Request, reason: CredentialFailure) {
  const error = reason === "missing" ? undefined : "invalid_token" as const
  return unauthorizedHeaders(originFromRequest(req), "fund-data", error, credentialFailureDescription(reason))
}

export async function requireFundDataApiUser(req: Request): Promise<
  | { ok: true; user: Omit<StoredUser, "passwordHash"> }
  | { ok: false; status: number; body: FundDataErr; headers: Record<string, string> }
> {
  const key = readFundDataApiKey(req)
  const resolved = await resolveMcpCredential({
    rawKey: key,
    family: "fund-data",
    store: getMcpOAuthStore(),
    getUserById,
    getUserByApiKey,
  })
  if (!resolved.ok) {
    const message =
      resolved.reason === "missing"
        ? "api_key is required"
        : resolved.reason === "wrong_resource"
          ? "access token is not valid for the fund-data API"
          : "invalid api_key"
    return {
      ok: false,
      status: 401,
      body: fundDataErr(401, message),
      headers: failureHeaders(req, resolved.reason),
    }
  }
  return { ok: true, user: resolved.user }
}
