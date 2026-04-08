import bcrypt from "bcryptjs"
import { query } from "@/lib/db"

export type StoredUser = {
  id: string
  email: string
  name: string
  role: "admin" | "user"
  passwordHash: string
}

type DbRow = {
  id: string
  email: string
  name: string
  role: "admin" | "user"
  password_hash: string
}

function rowToUser(row: DbRow): StoredUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, passwordHash: row.password_hash }
}

// Singleton init promise — safe against concurrent requests and hot reloads
let initPromise: Promise<void> | null = null

function ensureTable(): Promise<void> {
  if (!initPromise) initPromise = _initTable().catch((e) => { initPromise = null; throw e })
  return initPromise
}

async function _initTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await _seedIfEmpty()
}

async function _seedIfEmpty() {
  const rows = await query<{ count: string }>(`SELECT COUNT(*) AS count FROM auth_users`)
  const count = parseInt(rows[0]?.count ?? "0", 10)
  if (count > 0) return

  // Attempt one-time migration from legacy JSON file
  try {
    const { promises: fs } = await import("fs")
    const nodePath = await import("path")
    const candidates = [
      nodePath.join(process.cwd(), "data", "users.json"),
      nodePath.join(process.cwd(), "..", "data", "users.json"),
    ]
    for (const file of candidates) {
      try {
        const raw = await fs.readFile(file, "utf8")
        const users: StoredUser[] = JSON.parse(raw)
        if (Array.isArray(users) && users.length > 0) {
          for (const u of users) {
            await query(
              `INSERT INTO auth_users (id, email, name, role, password_hash)
               VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
              [u.id, u.email, u.name, u.role, u.passwordHash],
            )
          }
          return
        }
      } catch {}
    }
  } catch {}

  // Seed default admin from env
  const adminName = process.env.ADMIN_DEFAULT_NAME || "cshen"
  const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || "cshen@example.com"
  const adminPwd = process.env.ADMIN_DEFAULT_PASSWORD || "wygmmlhhhh8"
  const hash = await bcrypt.hash(adminPwd, 10)
  await query(
    `INSERT INTO auth_users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)`,
    [Math.random().toString(36).slice(2, 11), adminEmail, adminName, "admin", hash],
  )

  // Seed extra users from env (JSON array of { name, email, password, role? })
  try {
    if (process.env.SEED_EXTRA_USERS) {
      const extra: Array<{ name: string; email: string; password: string; role?: "admin" | "user" }> = JSON.parse(
        process.env.SEED_EXTRA_USERS,
      )
      for (const e of extra) {
        if (!e?.email || !e?.name || !e?.password) continue
        const h = await bcrypt.hash(e.password, 10)
        await query(
          `INSERT INTO auth_users (id, email, name, role, password_hash)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
          [Math.random().toString(36).slice(2, 11), e.email, e.name, e.role ?? "user", h],
        )
      }
    }
  } catch {}
}

export async function listUsers(): Promise<Omit<StoredUser, "passwordHash">[]> {
  await ensureTable()
  const rows = await query<DbRow>(`SELECT id, email, name, role FROM auth_users ORDER BY created_at`)
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, role: r.role }))
}

export async function getUserById(id: string): Promise<Omit<StoredUser, "passwordHash"> | null> {
  if (!id) return null
  await ensureTable()
  const rows = await query<DbRow>(`SELECT id, email, name, role FROM auth_users WHERE id = $1`, [id])
  if (rows.length === 0) return null
  const r = rows[0]
  return { id: r.id, email: r.email, name: r.name, role: r.role }
}

export async function getAll(): Promise<StoredUser[]> {
  await ensureTable()
  const rows = await query<DbRow>(
    `SELECT id, email, name, role, password_hash FROM auth_users ORDER BY created_at`,
  )
  return rows.map(rowToUser)
}

export async function addUser(input: { email: string; name: string; password: string; role?: "admin" | "user" }) {
  await ensureTable()
  const role = input.role ?? "user"
  const existing = await query<{ id: string }>(`SELECT id FROM auth_users WHERE email = $1`, [input.email])
  if (existing.length > 0) throw new Error("邮箱已存在")
  const hash = await bcrypt.hash(input.password, 10)
  const id = Math.random().toString(36).slice(2, 11)
  await query(
    `INSERT INTO auth_users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)`,
    [id, input.email, input.name, role, hash],
  )
  return { id, email: input.email, name: input.name, role }
}

export async function updateUser(
  id: string,
  updates: Partial<{ email: string; name: string; password: string; role: "admin" | "user" }>,
) {
  await ensureTable()
  const rows = await query<DbRow>(
    `SELECT id FROM auth_users WHERE id = $1`,
    [id],
  )
  if (rows.length === 0) throw new Error("用户不存在")

  if ("email" in updates && updates.email) {
    const dup = await query<{ id: string }>(
      `SELECT id FROM auth_users WHERE email = $1 AND id != $2`,
      [updates.email, id],
    )
    if (dup.length > 0) throw new Error("邮箱已存在")
    await query(`UPDATE auth_users SET email = $1 WHERE id = $2`, [updates.email, id])
  }
  if ("name" in updates && updates.name) {
    await query(`UPDATE auth_users SET name = $1 WHERE id = $2`, [updates.name, id])
  }
  if ("role" in updates && updates.role) {
    await query(`UPDATE auth_users SET role = $1 WHERE id = $2`, [updates.role, id])
  }
  if ("password" in updates && updates.password) {
    const hash = await bcrypt.hash(updates.password, 10)
    await query(`UPDATE auth_users SET password_hash = $1 WHERE id = $2`, [hash, id])
  }

  const updated = await query<DbRow>(`SELECT id, email, name, role FROM auth_users WHERE id = $1`, [id])
  const r = updated[0]
  return { id: r.id, email: r.email, name: r.name, role: r.role }
}

export async function deleteUser(id: string) {
  await ensureTable()
  await query(`DELETE FROM auth_users WHERE id = $1`, [id])
}

export async function verifyLogin(identifier: string, password: string) {
  await ensureTable()
  const rows = await query<DbRow>(
    `SELECT id, email, name, role, password_hash FROM auth_users WHERE email = $1 OR name = $1`,
    [identifier],
  )
  if (rows.length === 0) return null
  const user = rowToUser(rows[0])
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return null
  const { passwordHash, ...rest } = user
  return rest
}
