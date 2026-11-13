/**
 *   npx tsx --test lib/server/mcp-oauth.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { canUseMcpArea, accountToolsFor, type McpAccount } from "@/lib/server/mcp-account-access"
import {
  handleTokenGrant,
  isAllowedRedirectUri,
  issueAuthorizationCode,
  issueTokenPair,
  prepareAuthorize,
  registerClient,
  resetOAuthSecretCache,
  resolveMcpCredential,
  resourceFamily,
  resourceMatchesFamily,
  safeOAuthContinuePath,
  sha256Base64Url,
  signSession,
  verifyPkceS256,
  verifySession,
  type PublicUser,
} from "@/lib/server/mcp-oauth"
import { createMemoryOAuthStore } from "@/lib/server/mcp-oauth-store"

const now = Date.UTC(2026, 10, 13, 1, 30, 0)

function user(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "user-1",
    email: "analyst@example.com",
    name: "分析员",
    role: "user",
    permissions: { ma: true, pfInvestmentAlt: true },
    ...overrides,
  }
}

function verifier(): { verifier: string; challenge: string } {
  const value = "a".repeat(43)
  return { verifier: value, challenge: sha256Base64Url(value) }
}

test("PKCE S256 accepts the matching verifier and rejects a wrong one", () => {
  const { verifier: v, challenge } = verifier()
  assert.equal(verifyPkceS256(v, challenge), true)
  assert.equal(verifyPkceS256("b".repeat(43), challenge), false)
  assert.equal(verifyPkceS256("short", challenge), false)
})

test("resource family treats http and https MCP URLs as the same API", () => {
  assert.equal(resourceFamily("http://8.154.33.143/ma/api/fund-data/mcp"), "fund-data")
  assert.equal(resourceFamily("https://8.154.33.143/ma/api/fund-data/mcp/"), "fund-data")
  assert.equal(resourceFamily("https://8.154.33.143/ma/api/mom-data/mcp"), "mom-data")
  assert.equal(resourceFamily("http://8.154.33.143/ma/api/account-risk/data"), "mom-data")
  assert.equal(resourceFamily("https://evil.example/ma/api/fund-data/mcp"), "fund-data")
  assert.equal(resourceFamily("https://8.154.33.143/other"), "unknown")
  assert.equal(resourceMatchesFamily(null, "fund-data"), true)
  assert.equal(resourceMatchesFamily("https://8.154.33.143/ma/api/mom-data/mcp", "fund-data"), false)
})

test("safeOAuthContinuePath only allows the authorize path", () => {
  assert.equal(safeOAuthContinuePath("/oauth/authorize?client_id=x"), "/oauth/authorize?client_id=x")
  assert.equal(safeOAuthContinuePath("//evil.example"), null)
  assert.equal(safeOAuthContinuePath("https://evil.example"), null)
  assert.equal(safeOAuthContinuePath("/login"), null)
  assert.equal(safeOAuthContinuePath("/oauth/authorize/../../admin"), null)
})

test("session cookie round-trips a user id and rejects tampering or expiry", () => {
  process.env.MA_OAUTH_SECRET = "test-secret-do-not-use-in-prod"
  resetOAuthSecretCache()
  const token = signSession("user-1", now)
  assert.deepEqual(verifySession(token, now + 1000), { uid: "user-1" })
  assert.equal(verifySession(token.slice(0, -2) + "aa", now + 1000), null)
  assert.equal(verifySession(token, now + 15 * 24 * 60 * 60 * 1000), null)
})

test("redirect URI allow-list accepts https, loopback http, and native schemes", () => {
  assert.equal(isAllowedRedirectUri("https://www.workbuddy.cn/oauth/callback"), true)
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:8787/callback"), true)
  assert.equal(isAllowedRedirectUri("workbuddy://oauth/callback"), true)
  assert.equal(isAllowedRedirectUri("http://evil.example/callback"), false)
  assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false)
})

test("authorization code + PKCE issues a token bound to that user", async () => {
  const store = createMemoryOAuthStore()
  const users = new Map([["user-1", user()]])
  const getUserById = async (id: string) => users.get(id) ?? null
  const registered = await registerClient(store, {
    client_name: "WorkBuddy",
    redirect_uris: ["http://127.0.0.1:8787/cb"],
  }, now)
  assert.equal(registered.ok, true)
  if (!registered.ok) return
  const { verifier: v, challenge } = verifier()
  const prepared = await prepareAuthorize(store, {
    responseType: "code",
    clientId: String(registered.body.client_id),
    redirectUri: "http://127.0.0.1:8787/cb",
    state: "xyz",
    scope: "mcp",
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    resource: "https://8.154.33.143/ma/api/fund-data/mcp",
  })
  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  const redirect = await issueAuthorizationCode(store, prepared.request, "user-1", now)
  const code = new URL(redirect).searchParams.get("code")
  assert.ok(code)
  const granted = await handleTokenGrant(
    store,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "http://127.0.0.1:8787/cb",
      client_id: String(registered.body.client_id),
      code_verifier: v,
    }),
    null,
    now + 1000,
  )
  assert.equal(granted.ok, true)
  if (!granted.ok) return
  const resolved = await resolveMcpCredential({
    rawKey: granted.tokens.access_token,
    family: "fund-data",
    store,
    getUserById,
    getUserByApiKey: async () => null,
    now: now + 2000,
  })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(resolved.via, "oauth")
  assert.equal(resolved.user.id, "user-1")
  assert.equal(resolved.user.email, "analyst@example.com")
})

test("anonymous, invalid, expired, and reused credentials are rejected", async () => {
  const store = createMemoryOAuthStore()
  const getUserById = async () => user()
  const missing = await resolveMcpCredential({
    rawKey: "",
    family: "fund-data",
    store,
    getUserById,
    getUserByApiKey: async () => null,
  })
  assert.deepEqual(missing, { ok: false, reason: "missing" })

  const invalid = await resolveMcpCredential({
    rawKey: "mao_at_not-a-real-token",
    family: "fund-data",
    store,
    getUserById,
    getUserByApiKey: async () => {
      throw new Error("must not fall through to the API key lookup")
    },
  })
  assert.deepEqual(invalid, { ok: false, reason: "invalid" })

  const tokens = await issueTokenPair(
    store,
    { clientId: "cli", userId: "user-1", resource: "https://8.154.33.143/ma/api/fund-data/mcp", scope: "mcp" },
    now,
  )
  const expired = await resolveMcpCredential({
    rawKey: tokens.access_token,
    family: "fund-data",
    store,
    getUserById,
    getUserByApiKey: async () => null,
    now: now + 2 * 60 * 60 * 1000,
  })
  assert.deepEqual(expired, { ok: false, reason: "expired" })

  const registered = await registerClient(store, {
    client_name: "WorkBuddy",
    redirect_uris: ["http://127.0.0.1:8787/cb"],
  }, now)
  assert.equal(registered.ok, true)
  if (!registered.ok) return
  const { verifier: v, challenge } = verifier()
  const prepared = await prepareAuthorize(store, {
    responseType: "code",
    clientId: String(registered.body.client_id),
    redirectUri: "http://127.0.0.1:8787/cb",
    state: null,
    scope: "mcp",
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    resource: "https://8.154.33.143/ma/api/fund-data/mcp",
  })
  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  const redirect = await issueAuthorizationCode(store, prepared.request, "user-1", now)
  const code = new URL(redirect).searchParams.get("code") || ""
  const first = await handleTokenGrant(
    store,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:8787/cb",
      client_id: String(registered.body.client_id),
      code_verifier: v,
    }),
    null,
    now + 1000,
  )
  assert.equal(first.ok, true)
  const second = await handleTokenGrant(
    store,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://127.0.0.1:8787/cb",
      client_id: String(registered.body.client_id),
      code_verifier: v,
    }),
    null,
    now + 2000,
  )
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.error, "invalid_grant")
})

test("a fund-data token cannot be used on the MOM MCP", async () => {
  const store = createMemoryOAuthStore()
  const tokens = await issueTokenPair(
    store,
    { clientId: "cli", userId: "user-1", resource: "https://8.154.33.143/ma/api/fund-data/mcp", scope: "mcp" },
    now,
  )
  const resolved = await resolveMcpCredential({
    rawKey: tokens.access_token,
    family: "mom-data",
    store,
    getUserById: async () => user(),
    getUserByApiKey: async () => null,
    now: now + 1000,
  })
  assert.deepEqual(resolved, { ok: false, reason: "wrong_resource" })
})

test("API keys still resolve when the bearer token is not an OAuth token", async () => {
  const store = createMemoryOAuthStore()
  const apiUser = user({ id: "key-user" })
  const resolved = await resolveMcpCredential({
    rawKey: "mf_0123456789abcdef0123456789abcdef01234567",
    family: "fund-data",
    store,
    getUserById: async () => {
      throw new Error("API keys must not use the OAuth user lookup")
    },
    getUserByApiKey: async (key) => (key.startsWith("mf_") ? apiUser : null),
    now,
  })
  assert.equal(resolved.ok, true)
  if (!resolved.ok) return
  assert.equal(resolved.via, "api_key")
  assert.equal(resolved.user.id, "key-user")
})

test("a user without a page permission cannot use that MCP area", () => {
  const account = user({ permissions: { ma: true } }) as McpAccount
  assert.equal(canUseMcpArea(account, "knowledge"), false)
  assert.equal(canUseMcpArea(account, "researcher"), false)
  assert.equal(canUseMcpArea(account, "managed"), false)
  const names = accountToolsFor(account).map((tool) => tool.name)
  assert.equal(names.includes("kb_ask"), false)
  assert.equal(names.includes("ai_researcher_compare"), false)
  assert.equal(names.includes("managed_products_list"), false)

  const allowed = user({
    permissions: { ma: true, aiKnowledge: true, aiResearcher: true, pfInvestmentPool: true, pfInvestmentAlt: true },
  }) as McpAccount
  assert.equal(canUseMcpArea(allowed, "knowledge"), true)
  assert.equal(canUseMcpArea(allowed, "researcher"), true)
  assert.equal(canUseMcpArea(allowed, "managed"), true)
  const allowedNames = accountToolsFor(allowed).map((tool) => tool.name)
  assert.equal(allowedNames.includes("kb_ask"), true)
  assert.equal(allowedNames.includes("ai_researcher_compare"), true)
  assert.equal(allowedNames.includes("managed_products_list"), true)
})

test("admin accounts can use every MCP area even without the individual flags", () => {
  const admin = user({ role: "admin", permissions: {} }) as McpAccount
  assert.equal(canUseMcpArea(admin, "knowledge"), true)
  assert.equal(canUseMcpArea(admin, "researcher"), true)
  assert.equal(canUseMcpArea(admin, "tracking"), true)
  assert.equal(canUseMcpArea(admin, "managed"), true)
})

test("refresh tokens rotate and the previous refresh token is rejected", async () => {
  const store = createMemoryOAuthStore()
  await registerClient(store, {
    client_name: "WorkBuddy",
    redirect_uris: ["http://127.0.0.1:8787/cb"],
  }, now)
  // registerClient generates a random id; issue a pair against a known client instead
  await store.saveClient({
    clientId: "cli-refresh",
    clientSecretHash: null,
    clientName: "WorkBuddy",
    redirectUris: ["http://127.0.0.1:8787/cb"],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    createdAt: now,
  })
  const first = await issueTokenPair(
    store,
    { clientId: "cli-refresh", userId: "user-1", resource: "https://8.154.33.143/ma/api/mom-data/mcp", scope: "mcp" },
    now,
  )
  const refreshed = await handleTokenGrant(
    store,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: "cli-refresh",
    }),
    null,
    now + 1000,
  )
  assert.equal(refreshed.ok, true)
  if (!refreshed.ok) return
  assert.notEqual(refreshed.tokens.refresh_token, first.refresh_token)
  const reused = await handleTokenGrant(
    store,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: "cli-refresh",
    }),
    null,
    now + 2000,
  )
  assert.equal(reused.ok, false)
})
