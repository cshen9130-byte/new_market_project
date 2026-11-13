import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { StoredUser } from "@/lib/server/users"
import {
  FUND_DATA_MCP_URL,
  FUND_DATA_PUBLIC_HTTPS_ORIGIN,
  FUND_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/fund-data-public"
import {
  MOM_DATA_MCP_URL,
  MOM_DATA_PUBLIC_HTTPS_ORIGIN,
  MOM_DATA_PUBLIC_ORIGIN,
} from "@/lib/ma/mom-data-public"

export const OAUTH_ACCESS_PREFIX = "mao_at_"
export const OAUTH_REFRESH_PREFIX = "mao_rt_"
export const OAUTH_CODE_PREFIX = "mao_ac_"
export const OAUTH_CLIENT_PREFIX = "mao_cli_"
export const MA_SESSION_COOKIE = "ma_session"

export const ACCESS_TOKEN_TTL_SEC = 60 * 60
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60
export const AUTH_CODE_TTL_SEC = 10 * 60
export const SESSION_TTL_SEC = 14 * 24 * 60 * 60

export type McpResourceFamily = "fund-data" | "mom-data"

export type PublicUser = Omit<StoredUser, "passwordHash">

export type OAuthClient = {
  clientId: string
  clientSecretHash: string | null
  clientName: string
  redirectUris: string[]
  tokenEndpointAuthMethod: string
  grantTypes: string[]
  responseTypes: string[]
  createdAt: number
}

export type OAuthAuthCode = {
  codeHash: string
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: "S256"
  resource: string | null
  scope: string
  expiresAt: number
  consumedAt: number | null
}

export type OAuthTokenRecord = {
  id: string
  accessTokenHash: string
  refreshTokenHash: string | null
  clientId: string
  userId: string
  resource: string | null
  scope: string
  accessExpiresAt: number
  refreshExpiresAt: number | null
  revokedAt: number | null
  createdAt: number
}

export type McpOAuthStore = {
  saveClient: (client: OAuthClient) => Promise<void>
  getClient: (clientId: string) => Promise<OAuthClient | null>
  saveCode: (code: OAuthAuthCode) => Promise<void>
  getCodeByHash: (codeHash: string) => Promise<OAuthAuthCode | null>
  consumeCode: (codeHash: string, at: number) => Promise<boolean>
  saveToken: (token: OAuthTokenRecord) => Promise<void>
  getTokenByAccessHash: (hash: string) => Promise<OAuthTokenRecord | null>
  getTokenByRefreshHash: (hash: string) => Promise<OAuthTokenRecord | null>
  revokeToken: (id: string, at: number) => Promise<void>
}

export type CredentialFailure = "missing" | "invalid" | "expired" | "wrong_resource" | "revoked"

export type ResolvedCredential =
  | { ok: true; user: PublicUser; via: "oauth" | "api_key"; token?: OAuthTokenRecord }
  | { ok: false; reason: CredentialFailure }

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url")
}

export function randomToken(prefix: string, bytes = 24): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`
}

export function hashSecret(value: string): string {
  return sha256Hex(value)
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "hex")
    const right = Buffer.from(b, "hex")
    if (left.length !== right.length || left.length === 0) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

export function isOAuthAccessToken(value: string): boolean {
  return value.startsWith(OAUTH_ACCESS_PREFIX)
}

export function isOAuthRefreshToken(value: string): boolean {
  return value.startsWith(OAUTH_REFRESH_PREFIX)
}

export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false
  if (!/^[A-Za-z0-9._~-]+$/.test(codeVerifier)) return false
  return sha256Base64Url(codeVerifier) === codeChallenge
}

export function originFromRequest(req: Request): string {
  const url = new URL(req.url)
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host
  const host = forwardedHost.split(",")[0].trim()
  const forwardedProto = req.headers.get("x-forwarded-proto")
  const proto = (forwardedProto?.split(",")[0].trim() || url.protocol.replace(":", "")).replace(/:$/, "")
  const safeProto = proto === "https" ? "https" : "http"
  return `${safeProto}://${host}`
}

export function requestIsHttps(req: Request): boolean {
  return originFromRequest(req).startsWith("https://")
}

export function normalizeResourceUrl(raw: string): string {
  try {
    const url = new URL(raw.trim())
    url.hash = ""
    url.hostname = url.hostname.toLowerCase()
    let path = url.pathname.replace(/\/+$/, "")
    if (!path) path = ""
    url.pathname = path
    url.search = ""
    return url.toString()
  } catch {
    return raw.trim().replace(/\/+$/, "")
  }
}

const FUND_RESOURCE_SUFFIXES = ["/ma/api/fund-data", "/ma/api/fund-data/mcp"]
const MOM_RESOURCE_SUFFIXES = [
  "/ma/api/mom-data",
  "/ma/api/mom-data/mcp",
  "/ma/api/account-risk",
  "/ma/api/account-risk/data",
]

function pathOf(resource: string): string {
  try {
    return new URL(normalizeResourceUrl(resource)).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return ""
  }
}

export function resourceFamily(resource: string | null | undefined): McpResourceFamily | "unknown" | "any" {
  if (!resource) return "any"
  const path = pathOf(resource)
  if (FUND_RESOURCE_SUFFIXES.some((suffix) => path === suffix || path.startsWith(`${suffix}/`))) return "fund-data"
  if (MOM_RESOURCE_SUFFIXES.some((suffix) => path === suffix || path.startsWith(`${suffix}/`))) return "mom-data"
  return "unknown"
}

export function resourceMatchesFamily(resource: string | null | undefined, family: McpResourceFamily): boolean {
  const kind = resourceFamily(resource)
  return kind === "any" || kind === family
}

export function knownMcpResources(): string[] {
  return [
    FUND_DATA_MCP_URL,
    `${FUND_DATA_PUBLIC_HTTPS_ORIGIN}/ma/api/fund-data/mcp`,
    MOM_DATA_MCP_URL,
    `${MOM_DATA_PUBLIC_HTTPS_ORIGIN}/ma/api/mom-data/mcp`,
  ]
}

export function isAllowedAuthorizeResource(resource: string | null | undefined): boolean {
  if (!resource) return true
  return resourceFamily(resource) !== "unknown"
}

export function authorizationServerMetadata(issuer: string) {
  const base = issuer.replace(/\/+$/, "")
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    userinfo_endpoint: `${base}/oauth/userinfo`,
    scopes_supported: ["mcp", "openid", "profile"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    resource_indicators_supported: true,
  }
}

export function protectedResourceMetadata(origin: string, resourcePath: string) {
  const base = origin.replace(/\/+$/, "")
  const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`
  return {
    resource: `${base}${path}`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  }
}

export function wwwAuthenticateHeader(
  origin: string,
  family: McpResourceFamily,
  error?: "invalid_token" | "invalid_request",
  description?: string,
): string {
  const path = family === "mom-data" ? "/ma/api/mom-data/mcp" : "/ma/api/fund-data/mcp"
  const metadata = `${origin.replace(/\/+$/, "")}/.well-known/oauth-protected-resource${path}`
  const realm = family === "mom-data" ? "MA MOM Data MCP" : "MA Fund Data MCP"
  const parts = [`Bearer realm="${realm}"`, `resource_metadata="${metadata}"`]
  if (error) parts.push(`error="${error}"`)
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`)
  return parts.join(", ")
}

export function unauthorizedHeaders(
  origin: string,
  family: McpResourceFamily,
  error?: "invalid_token" | "invalid_request",
  description?: string,
): Record<string, string> {
  return {
    "WWW-Authenticate": wwwAuthenticateHeader(origin, family, error, description),
    "Access-Control-Expose-Headers": "WWW-Authenticate",
  }
}

export const OAUTH_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
}

export function oauthCorsResponse(status = 204, body: unknown = null, extra?: Record<string, string>) {
  const headers = { ...OAUTH_CORS, ...(extra || {}) }
  if (body == null) return new Response(null, { status, headers })
  return Response.json(body, { status, headers })
}

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "file:" || url.protocol === "vbscript:") {
    return false
  }
  if (url.protocol === "https:") return true
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase()
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]"
  }
  // Native / desktop custom schemes, e.g. workbuddy://oauth/callback
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol)
}

export function redirectUriAllowedForClient(client: OAuthClient, redirectUri: string): boolean {
  return client.redirectUris.some((allowed) => allowed === redirectUri)
}

export function safeOAuthContinuePath(raw: string | null | undefined): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value.startsWith("/oauth/authorize")) return null
  if (value.startsWith("//") || value.includes("://") || value.includes("\\") || value.includes("..")) return null
  if (value.includes("\n") || value.includes("\r")) return null
  return value
}

type SessionPayload = { uid: string; exp: number; iat: number; v: 1 }

let cachedSecret: Buffer | null = null

export function resetOAuthSecretCache() {
  cachedSecret = null
}

function storageDir(): string {
  return process.env.MARKET_DASHBOARD_STORAGE_DIR || process.env.MOM_CACHE_DIR || process.cwd()
}

function readOrCreateSecretFile(): Buffer {
  const dir = storageDir()
  const file = join(dir, ".ma-oauth-secret")
  try {
    const existing = readFileSync(file, "utf8").trim()
    if (existing) return createHash("sha256").update(existing).digest()
  } catch {
    // create below
  }
  try {
    mkdirSync(dir, { recursive: true })
    const generated = randomBytes(48).toString("base64url")
    writeFileSync(file, generated, { encoding: "utf8", mode: 0o600 })
    return createHash("sha256").update(generated).digest()
  } catch {
    // last resort: process-local only (tokens/sessions will not survive restart)
    return createHash("sha256").update(`dev-only:${dir}`).digest()
  }
}

export function oauthSigningSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  const env = process.env.MA_OAUTH_SECRET || process.env.REPORT_DOWNLOAD_SECRET
  cachedSecret = env ? createHash("sha256").update(env).digest() : readOrCreateSecretFile()
  return cachedSecret
}

export function signSession(userId: string, now = Date.now(), ttlSec = SESSION_TTL_SEC): string {
  const payload: SessionPayload = {
    uid: userId,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSec,
    v: 1,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = createHmac("sha256", oauthSigningSecret()).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function verifySession(cookie: string | null | undefined, now = Date.now()): { uid: string } | null {
  if (!cookie) return null
  const [body, sig] = cookie.split(".")
  if (!body || !sig) return null
  const expected = createHmac("sha256", oauthSigningSecret()).update(body).digest("base64url")
  const left = Buffer.from(sig)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload
    if (payload.v !== 1 || !payload.uid || payload.exp * 1000 <= now) return null
    return { uid: payload.uid }
  } catch {
    return null
  }
}

export function sessionCookieHeader(value: string, https: boolean, maxAge = SESSION_TTL_SEC): string {
  const parts = [
    `${MA_SESSION_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ]
  if (https) parts.push("Secure")
  return parts.join("; ")
}

export function clearSessionCookieHeader(https: boolean): string {
  const parts = [`${MA_SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
  if (https) parts.push("Secure")
  return parts.join("; ")
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || ""
  const parts = header.split(";")
  for (const part of parts) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1)
  }
  return null
}

export function sessionFromRequest(req: Request): { uid: string } | null {
  return verifySession(readCookie(req, MA_SESSION_COOKIE))
}

export type AuthorizeInput = {
  responseType: string | null
  clientId: string | null
  redirectUri: string | null
  state: string | null
  scope: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  resource: string | null
}

export function readAuthorizeInput(source: URLSearchParams | FormData): AuthorizeInput {
  const get = (key: string) => {
    const value = source.get(key)
    return typeof value === "string" ? value : value == null ? null : String(value)
  }
  return {
    responseType: get("response_type"),
    clientId: get("client_id"),
    redirectUri: get("redirect_uri"),
    state: get("state"),
    scope: get("scope"),
    codeChallenge: get("code_challenge"),
    codeChallengeMethod: get("code_challenge_method"),
    resource: get("resource"),
  }
}

export type AuthorizeRequest = {
  client: OAuthClient
  redirectUri: string
  state: string | null
  scope: string
  codeChallenge: string
  resource: string | null
  family: McpResourceFamily | "any"
}

export type AuthorizePrepareResult =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; status: number; error: string; description: string; redirectTo: string | null }

function withErrorParams(redirectUri: string, error: string, description: string, state: string | null): string {
  const url = new URL(redirectUri)
  url.searchParams.set("error", error)
  url.searchParams.set("error_description", description)
  if (state) url.searchParams.set("state", state)
  return url.toString()
}

export async function prepareAuthorize(
  store: McpOAuthStore,
  input: AuthorizeInput,
): Promise<AuthorizePrepareResult> {
  const redirectUri = input.redirectUri?.trim() || ""
  const state = input.state
  const redirectOk = redirectUri ? isAllowedRedirectUri(redirectUri) : false

  if (!input.clientId) {
    return { ok: false, status: 400, error: "invalid_request", description: "client_id is required", redirectTo: null }
  }
  const client = await store.getClient(input.clientId)
  if (!client) {
    return { ok: false, status: 400, error: "invalid_client", description: "unknown client_id", redirectTo: null }
  }
  if (!redirectUri || !redirectOk || !redirectUriAllowedForClient(client, redirectUri)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      description: "redirect_uri is missing or not registered for this client",
      redirectTo: null,
    }
  }
  if (input.responseType !== "code") {
    return {
      ok: false,
      status: 400,
      error: "unsupported_response_type",
      description: "response_type must be code",
      redirectTo: withErrorParams(redirectUri, "unsupported_response_type", "response_type must be code", state),
    }
  }
  if (!input.codeChallenge || input.codeChallengeMethod !== "S256") {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      description: "PKCE S256 code_challenge is required",
      redirectTo: withErrorParams(redirectUri, "invalid_request", "PKCE S256 code_challenge is required", state),
    }
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      description: "code_challenge is invalid",
      redirectTo: withErrorParams(redirectUri, "invalid_request", "code_challenge is invalid", state),
    }
  }
  if (!isAllowedAuthorizeResource(input.resource)) {
    return {
      ok: false,
      status: 400,
      error: "invalid_target",
      description: "resource must be the fund-data or MOM MCP URL",
      redirectTo: withErrorParams(redirectUri, "invalid_target", "resource must be the fund-data or MOM MCP URL", state),
    }
  }

  const family = resourceFamily(input.resource)
  return {
    ok: true,
    request: {
      client,
      redirectUri,
      state,
      scope: (input.scope || "mcp").trim() || "mcp",
      codeChallenge: input.codeChallenge,
      resource: input.resource ? normalizeResourceUrl(input.resource) : null,
      family: family === "unknown" ? "any" : family,
    },
  }
}

export async function issueAuthorizationCode(
  store: McpOAuthStore,
  request: AuthorizeRequest,
  userId: string,
  now = Date.now(),
): Promise<string> {
  const code = randomToken(OAUTH_CODE_PREFIX, 24)
  await store.saveCode({
    codeHash: hashSecret(code),
    clientId: request.client.clientId,
    userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: "S256",
    resource: request.resource,
    scope: request.scope,
    expiresAt: now + AUTH_CODE_TTL_SEC * 1000,
    consumedAt: null,
  })
  const url = new URL(request.redirectUri)
  url.searchParams.set("code", code)
  if (request.state) url.searchParams.set("state", request.state)
  return url.toString()
}

export function denyAuthorizeRedirect(request: AuthorizeRequest): string {
  return withErrorParams(request.redirectUri, "access_denied", "The user denied the authorization request", request.state)
}

async function authenticateClient(
  store: McpOAuthStore,
  params: { clientId?: string | null; clientSecret?: string | null },
  header: string | null,
): Promise<OAuthClient | null> {
  let clientId = params.clientId?.trim() || ""
  let clientSecret = params.clientSecret ?? ""
  if (header?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8")
      const idx = decoded.indexOf(":")
      if (idx >= 0) {
        clientId = decodeURIComponent(decoded.slice(0, idx))
        clientSecret = decodeURIComponent(decoded.slice(idx + 1))
      }
    } catch {
      return null
    }
  }
  if (!clientId) return null
  const client = await store.getClient(clientId)
  if (!client) return null
  if (client.clientSecretHash) {
    if (!clientSecret) return null
    if (!safeEqualHex(client.clientSecretHash, hashSecret(clientSecret))) return null
  }
  return client
}

export type IssuedTokens = {
  access_token: string
  refresh_token: string
  token_type: "Bearer"
  expires_in: number
  scope: string
  resource?: string
}

export async function issueTokenPair(
  store: McpOAuthStore,
  input: { clientId: string; userId: string; resource: string | null; scope: string },
  now = Date.now(),
): Promise<IssuedTokens> {
  const accessToken = randomToken(OAUTH_ACCESS_PREFIX, 32)
  const refreshToken = randomToken(OAUTH_REFRESH_PREFIX, 32)
  await store.saveToken({
    id: randomToken("mao_tid_", 12),
    accessTokenHash: hashSecret(accessToken),
    refreshTokenHash: hashSecret(refreshToken),
    clientId: input.clientId,
    userId: input.userId,
    resource: input.resource,
    scope: input.scope,
    accessExpiresAt: now + ACCESS_TOKEN_TTL_SEC * 1000,
    refreshExpiresAt: now + REFRESH_TOKEN_TTL_SEC * 1000,
    revokedAt: null,
    createdAt: now,
  })
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    scope: input.scope,
    ...(input.resource ? { resource: input.resource } : {}),
  }
}

export type TokenGrantResult =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; status: number; error: string; description: string }

export async function handleTokenGrant(
  store: McpOAuthStore,
  params: URLSearchParams,
  authorizationHeader: string | null,
  now = Date.now(),
): Promise<TokenGrantResult> {
  const grantType = params.get("grant_type")
  const client = await authenticateClient(
    store,
    { clientId: params.get("client_id"), clientSecret: params.get("client_secret") },
    authorizationHeader,
  )
  if (!client) {
    return { ok: false, status: 401, error: "invalid_client", description: "client authentication failed" }
  }

  if (grantType === "authorization_code") {
    const code = params.get("code")?.trim() || ""
    const redirectUri = params.get("redirect_uri")?.trim() || ""
    const verifier = params.get("code_verifier")?.trim() || ""
    if (!code || !redirectUri || !verifier) {
      return { ok: false, status: 400, error: "invalid_request", description: "code, redirect_uri and code_verifier are required" }
    }
    const record = await store.getCodeByHash(hashSecret(code))
    if (!record || record.clientId !== client.clientId || record.redirectUri !== redirectUri) {
      return { ok: false, status: 400, error: "invalid_grant", description: "authorization code is invalid" }
    }
    if (record.consumedAt) {
      return { ok: false, status: 400, error: "invalid_grant", description: "authorization code has already been used" }
    }
    if (record.expiresAt <= now) {
      return { ok: false, status: 400, error: "invalid_grant", description: "authorization code has expired" }
    }
    if (!verifyPkceS256(verifier, record.codeChallenge)) {
      return { ok: false, status: 400, error: "invalid_grant", description: "PKCE verification failed" }
    }
    const consumed = await store.consumeCode(record.codeHash, now)
    if (!consumed) {
      return { ok: false, status: 400, error: "invalid_grant", description: "authorization code has already been used" }
    }
    const resourceParam = params.get("resource")
    const resource = resourceParam ? normalizeResourceUrl(resourceParam) : record.resource
    if (record.resource && resource && normalizeResourceUrl(record.resource) !== resource) {
      return { ok: false, status: 400, error: "invalid_target", description: "resource does not match the authorization request" }
    }
    const tokens = await issueTokenPair(
      store,
      { clientId: client.clientId, userId: record.userId, resource: resource || record.resource, scope: record.scope },
      now,
    )
    return { ok: true, tokens }
  }

  if (grantType === "refresh_token") {
    const refresh = params.get("refresh_token")?.trim() || ""
    if (!isOAuthRefreshToken(refresh)) {
      return { ok: false, status: 400, error: "invalid_request", description: "refresh_token is required" }
    }
    const record = await store.getTokenByRefreshHash(hashSecret(refresh))
    if (!record || record.clientId !== client.clientId) {
      return { ok: false, status: 400, error: "invalid_grant", description: "refresh_token is invalid" }
    }
    if (record.revokedAt) {
      return { ok: false, status: 400, error: "invalid_grant", description: "refresh_token has been revoked" }
    }
    if (!record.refreshExpiresAt || record.refreshExpiresAt <= now) {
      return { ok: false, status: 400, error: "invalid_grant", description: "refresh_token has expired" }
    }
    await store.revokeToken(record.id, now)
    const tokens = await issueTokenPair(
      store,
      { clientId: client.clientId, userId: record.userId, resource: record.resource, scope: record.scope },
      now,
    )
    return { ok: true, tokens }
  }

  return { ok: false, status: 400, error: "unsupported_grant_type", description: "grant_type must be authorization_code or refresh_token" }
}

export async function registerClient(
  store: McpOAuthStore,
  body: Record<string, unknown>,
  now = Date.now(),
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string; description: string }> {
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map((item) => String(item)) : []
  if (redirectUris.length === 0 || redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
    return { ok: false, status: 400, error: "invalid_redirect_uri", description: "redirect_uris must be https, loopback http, or a native app URI" }
  }
  const clientId = randomToken(OAUTH_CLIENT_PREFIX, 18)
  const clientName = String(body.client_name || "WorkBuddy").slice(0, 120)
  const authMethod = String(body.token_endpoint_auth_method || "none")
  const grantTypes = Array.isArray(body.grant_types)
    ? body.grant_types.map(String)
    : ["authorization_code", "refresh_token"]
  const responseTypes = Array.isArray(body.response_types) ? body.response_types.map(String) : ["code"]
  await store.saveClient({
    clientId,
    clientSecretHash: null,
    clientName,
    redirectUris,
    tokenEndpointAuthMethod: authMethod || "none",
    grantTypes,
    responseTypes,
    createdAt: now,
  })
  return {
    ok: true,
    body: {
      client_id: clientId,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
      client_secret_expires_at: 0,
    },
  }
}

export async function resolveAccessToken(
  store: McpOAuthStore,
  accessToken: string,
  family: McpResourceFamily,
  getUserById: (id: string) => Promise<PublicUser | null>,
  now = Date.now(),
): Promise<ResolvedCredential> {
  if (!isOAuthAccessToken(accessToken)) return { ok: false, reason: "invalid" }
  const record = await store.getTokenByAccessHash(hashSecret(accessToken))
  if (!record) return { ok: false, reason: "invalid" }
  if (record.revokedAt) return { ok: false, reason: "revoked" }
  if (record.accessExpiresAt <= now) return { ok: false, reason: "expired" }
  if (!resourceMatchesFamily(record.resource, family)) return { ok: false, reason: "wrong_resource" }
  const user = await getUserById(record.userId)
  if (!user) return { ok: false, reason: "invalid" }
  return { ok: true, user, via: "oauth", token: record }
}

export async function resolveMcpCredential(options: {
  rawKey: string
  family: McpResourceFamily
  store: McpOAuthStore
  getUserById: (id: string) => Promise<PublicUser | null>
  getUserByApiKey: (key: string) => Promise<PublicUser | null>
  now?: number
}): Promise<ResolvedCredential> {
  const key = options.rawKey.trim()
  if (!key) return { ok: false, reason: "missing" }
  if (isOAuthAccessToken(key)) {
    return resolveAccessToken(options.store, key, options.family, options.getUserById, options.now)
  }
  const user = await options.getUserByApiKey(key)
  if (!user) return { ok: false, reason: "invalid" }
  return { ok: true, user, via: "api_key" }
}

export function credentialFailureDescription(reason: CredentialFailure): string {
  switch (reason) {
    case "missing":
      return "access token or api_key is required"
    case "expired":
      return "access token has expired"
    case "revoked":
      return "access token has been revoked"
    case "wrong_resource":
      return "access token is not valid for this MCP server"
    default:
      return "access token is invalid"
  }
}

/** Documented public origins. HTTP remains the historic default; HTTPS is preferred for WorkBuddy OAuth. */
export const DOC_HTTP_ORIGIN = FUND_DATA_PUBLIC_ORIGIN
export const DOC_HTTPS_ORIGIN = FUND_DATA_PUBLIC_HTTPS_ORIGIN
export const DOC_HTTP_MOM_ORIGIN = MOM_DATA_PUBLIC_ORIGIN
export const DOC_HTTPS_MOM_ORIGIN = MOM_DATA_PUBLIC_HTTPS_ORIGIN
