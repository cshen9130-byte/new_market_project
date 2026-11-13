import { query } from "@/lib/db"
import type {
  McpOAuthStore,
  OAuthAuthCode,
  OAuthClient,
  OAuthTokenRecord,
} from "@/lib/server/mcp-oauth"

type ClientRow = {
  client_id: string
  client_secret_hash: string | null
  client_name: string
  redirect_uris: string | string[]
  token_endpoint_auth_method: string
  grant_types: string | string[]
  response_types: string | string[]
  created_at: Date | string | number
}

type CodeRow = {
  code_hash: string
  client_id: string
  user_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  resource: string | null
  scope: string
  expires_at: Date | string | number
  consumed_at: Date | string | number | null
}

type TokenRow = {
  id: string
  access_token_hash: string
  refresh_token_hash: string | null
  client_id: string
  user_id: string
  resource: string | null
  scope: string
  access_expires_at: Date | string | number
  refresh_expires_at: Date | string | number | null
  revoked_at: Date | string | number | null
  created_at: Date | string | number
}

function asMs(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === "number") return value
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function asStringArray(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function toClient(row: ClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    clientName: row.client_name,
    redirectUris: asStringArray(row.redirect_uris),
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    grantTypes: asStringArray(row.grant_types),
    responseTypes: asStringArray(row.response_types),
    createdAt: asMs(row.created_at) ?? Date.now(),
  }
}

function toCode(row: CodeRow): OAuthAuthCode {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    userId: row.user_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    codeChallengeMethod: "S256",
    resource: row.resource,
    scope: row.scope,
    expiresAt: asMs(row.expires_at) ?? 0,
    consumedAt: asMs(row.consumed_at),
  }
}

function toToken(row: TokenRow): OAuthTokenRecord {
  return {
    id: row.id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    clientId: row.client_id,
    userId: row.user_id,
    resource: row.resource,
    scope: row.scope,
    accessExpiresAt: asMs(row.access_expires_at) ?? 0,
    refreshExpiresAt: asMs(row.refresh_expires_at),
    revokedAt: asMs(row.revoked_at),
    createdAt: asMs(row.created_at) ?? 0,
  }
}

export function createMemoryOAuthStore(): McpOAuthStore {
  const clients = new Map<string, OAuthClient>()
  const codes = new Map<string, OAuthAuthCode>()
  const tokens = new Map<string, OAuthTokenRecord>()
  return {
    async saveClient(client) {
      clients.set(client.clientId, { ...client, redirectUris: [...client.redirectUris] })
    },
    async getClient(clientId) {
      const row = clients.get(clientId)
      return row ? { ...row, redirectUris: [...row.redirectUris] } : null
    },
    async saveCode(code) {
      codes.set(code.codeHash, { ...code })
    },
    async getCodeByHash(codeHash) {
      const row = codes.get(codeHash)
      return row ? { ...row } : null
    },
    async consumeCode(codeHash, at) {
      const row = codes.get(codeHash)
      if (!row || row.consumedAt) return false
      codes.set(codeHash, { ...row, consumedAt: at })
      return true
    },
    async saveToken(token) {
      tokens.set(token.id, { ...token })
    },
    async getTokenByAccessHash(hash) {
      for (const token of tokens.values()) {
        if (token.accessTokenHash === hash) return { ...token }
      }
      return null
    },
    async getTokenByRefreshHash(hash) {
      for (const token of tokens.values()) {
        if (token.refreshTokenHash === hash) return { ...token }
      }
      return null
    },
    async revokeToken(id, at) {
      const token = tokens.get(id)
      if (token && !token.revokedAt) tokens.set(id, { ...token, revokedAt: at })
    },
  }
}

let tableReady: Promise<void> | null = null

async function ensureOAuthTables() {
  if (tableReady) return tableReady
  tableReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_secret_hash TEXT,
        client_name TEXT NOT NULL,
        redirect_uris JSONB NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
        grant_types JSONB NOT NULL,
        response_types JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        resource TEXT,
        scope TEXT NOT NULL DEFAULT 'mcp',
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
        id TEXT PRIMARY KEY,
        access_token_hash TEXT UNIQUE NOT NULL,
        refresh_token_hash TEXT UNIQUE,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        resource TEXT,
        scope TEXT NOT NULL DEFAULT 'mcp',
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await query(`CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_idx ON mcp_oauth_tokens (user_id)`)
  })().catch((error) => {
    tableReady = null
    throw error
  })
  return tableReady
}

export function createPostgresOAuthStore(): McpOAuthStore {
  return {
    async saveClient(client) {
      await ensureOAuthTables()
      await query(
        `INSERT INTO mcp_oauth_clients (
          client_id, client_secret_hash, client_name, redirect_uris,
          token_endpoint_auth_method, grant_types, response_types, created_at
        ) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,to_timestamp($8/1000.0))
        ON CONFLICT (client_id) DO UPDATE SET
          client_secret_hash = EXCLUDED.client_secret_hash,
          client_name = EXCLUDED.client_name,
          redirect_uris = EXCLUDED.redirect_uris,
          token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
          grant_types = EXCLUDED.grant_types,
          response_types = EXCLUDED.response_types`,
        [
          client.clientId,
          client.clientSecretHash,
          client.clientName,
          JSON.stringify(client.redirectUris),
          client.tokenEndpointAuthMethod,
          JSON.stringify(client.grantTypes),
          JSON.stringify(client.responseTypes),
          client.createdAt,
        ],
      )
    },
    async getClient(clientId) {
      await ensureOAuthTables()
      const rows = await query<ClientRow>(`SELECT * FROM mcp_oauth_clients WHERE client_id = $1`, [clientId])
      return rows[0] ? toClient(rows[0]) : null
    },
    async saveCode(code) {
      await ensureOAuthTables()
      await query(
        `INSERT INTO mcp_oauth_codes (
          code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method,
          resource, scope, expires_at, consumed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),$10)`,
        [
          code.codeHash,
          code.clientId,
          code.userId,
          code.redirectUri,
          code.codeChallenge,
          code.codeChallengeMethod,
          code.resource,
          code.scope,
          code.expiresAt,
          code.consumedAt ? new Date(code.consumedAt).toISOString() : null,
        ],
      )
    },
    async getCodeByHash(codeHash) {
      await ensureOAuthTables()
      const rows = await query<CodeRow>(`SELECT * FROM mcp_oauth_codes WHERE code_hash = $1`, [codeHash])
      return rows[0] ? toCode(rows[0]) : null
    },
    async consumeCode(codeHash, at) {
      await ensureOAuthTables()
      const rows = await query<{ code_hash: string }>(
        `UPDATE mcp_oauth_codes
         SET consumed_at = to_timestamp($2/1000.0)
         WHERE code_hash = $1 AND consumed_at IS NULL
         RETURNING code_hash`,
        [codeHash, at],
      )
      return rows.length > 0
    },
    async saveToken(token) {
      await ensureOAuthTables()
      await query(
        `INSERT INTO mcp_oauth_tokens (
          id, access_token_hash, refresh_token_hash, client_id, user_id, resource, scope,
          access_expires_at, refresh_expires_at, revoked_at, created_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          to_timestamp($8/1000.0),
          $9,
          $10,
          to_timestamp($11/1000.0)
        )`,
        [
          token.id,
          token.accessTokenHash,
          token.refreshTokenHash,
          token.clientId,
          token.userId,
          token.resource,
          token.scope,
          token.accessExpiresAt,
          token.refreshExpiresAt ? new Date(token.refreshExpiresAt).toISOString() : null,
          token.revokedAt ? new Date(token.revokedAt).toISOString() : null,
          token.createdAt,
        ],
      )
    },
    async getTokenByAccessHash(hash) {
      await ensureOAuthTables()
      const rows = await query<TokenRow>(`SELECT * FROM mcp_oauth_tokens WHERE access_token_hash = $1`, [hash])
      return rows[0] ? toToken(rows[0]) : null
    },
    async getTokenByRefreshHash(hash) {
      await ensureOAuthTables()
      const rows = await query<TokenRow>(`SELECT * FROM mcp_oauth_tokens WHERE refresh_token_hash = $1`, [hash])
      return rows[0] ? toToken(rows[0]) : null
    },
    async revokeToken(id, at) {
      await ensureOAuthTables()
      await query(
        `UPDATE mcp_oauth_tokens SET revoked_at = to_timestamp($2/1000.0) WHERE id = $1 AND revoked_at IS NULL`,
        [id, at],
      )
    },
  }
}

let defaultStore: McpOAuthStore | null = null

export function getMcpOAuthStore(): McpOAuthStore {
  if (!defaultStore) defaultStore = createPostgresOAuthStore()
  return defaultStore
}

export function setMcpOAuthStoreForTests(store: McpOAuthStore | null) {
  defaultStore = store
}
