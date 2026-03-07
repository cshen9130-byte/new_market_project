import { promises as fs } from "fs"
import path from "path"
import bcrypt from "bcryptjs"
import { getServerStoragePath } from "@/lib/server/storage"

export type StoredUser = {
  id: string
  email: string
  name: string
  role: "admin" | "user"
  passwordHash: string
}

const legacyDataDir = path.join(process.cwd(), "data")
const legacyUsersFile = path.join(legacyDataDir, "users.json")

function getUsersDir() {
  return getServerStoragePath("auth")
}

function getUsersFile() {
  return path.join(getUsersDir(), "users.json")
}

async function ensureDir() {
  try {
    await fs.mkdir(getUsersDir(), { recursive: true })
  } catch {}
}

async function migrateLegacyUsersIfNeeded(usersFile: string) {
  try {
    await fs.access(usersFile)
    return
  } catch {}

  try {
    await fs.access(legacyUsersFile)
  } catch {
    return
  }

  const raw = await fs.readFile(legacyUsersFile, "utf8")
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error("旧用户数据格式不合法")
  }

  await fs.writeFile(usersFile, JSON.stringify(parsed, null, 2), "utf8")
}

async function seedIfMissing() {
  await ensureDir()
  const usersFile = getUsersFile()
  await migrateLegacyUsersIfNeeded(usersFile)
  try {
    await fs.access(usersFile)
  } catch {
    const adminName = process.env.ADMIN_DEFAULT_NAME || "cshen"
    const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || "cshen@example.com"
    const adminPwd = process.env.ADMIN_DEFAULT_PASSWORD || "wygmmlhhhh8"
    const hash = await bcrypt.hash(adminPwd, 10)
    const seed: StoredUser[] = [
      {
        id: Math.random().toString(36).slice(2, 11),
        email: adminEmail,
        name: adminName,
        role: "admin",
        passwordHash: hash,
      },
    ]
    // Optionally seed extra users from env (JSON array)
    try {
      if (process.env.SEED_EXTRA_USERS) {
        const extra: Array<{ name: string; email: string; password: string; role?: "admin" | "user" }> = JSON.parse(
          process.env.SEED_EXTRA_USERS,
        )
        for (const e of extra) {
          if (!e?.email || !e?.name || !e?.password) continue
          if (seed.some((u) => u.email === e.email)) continue
          const h = await bcrypt.hash(e.password, 10)
          seed.push({
            id: Math.random().toString(36).slice(2, 11),
            email: e.email,
            name: e.name,
            role: e.role ?? "user",
            passwordHash: h,
          })
        }
      }
    } catch {}
    await fs.writeFile(usersFile, JSON.stringify(seed, null, 2), "utf8")
  }
}

export async function listUsers(): Promise<Omit<StoredUser, "passwordHash">[]> {
  await seedIfMissing()
  const usersFile = getUsersFile()
  const raw = await fs.readFile(usersFile, "utf8")
  const parsed: StoredUser[] = JSON.parse(raw)
  return parsed.map(({ passwordHash, ...rest }) => rest)
}

export async function getAll(): Promise<StoredUser[]> {
  await seedIfMissing()
  const usersFile = getUsersFile()
  const raw = await fs.readFile(usersFile, "utf8")
  return JSON.parse(raw) as StoredUser[]
}

export async function writeAll(users: StoredUser[]) {
  await ensureDir()
  const usersFile = getUsersFile()
  await fs.writeFile(usersFile, JSON.stringify(users, null, 2), "utf8")
}

export async function addUser(input: { email: string; name: string; password: string; role?: "admin" | "user" }) {
  const role = input.role ?? "user"
  const users = await getAll()
  if (users.find((u) => u.email === input.email)) {
    throw new Error("邮箱已存在")
  }
  const hash = await bcrypt.hash(input.password, 10)
  const newUser: StoredUser = {
    id: Math.random().toString(36).slice(2, 11),
    email: input.email,
    name: input.name,
    role,
    passwordHash: hash,
  }
  users.push(newUser)
  await writeAll(users)
  const { passwordHash, ...rest } = newUser
  return rest
}

export async function updateUser(
  id: string,
  updates: Partial<{ email: string; name: string; password: string; role: "admin" | "user" }>,
) {
  const users = await getAll()
  const idx = users.findIndex((u) => u.id === id)
  if (idx === -1) throw new Error("用户不存在")
  if (updates.email && users.some((u, i) => u.email === updates.email && i !== idx)) {
    throw new Error("邮箱已存在")
  }
  const current = users[idx]
  const next: StoredUser = {
    ...current,
    ...("email" in updates ? { email: updates.email! } : {}),
    ...("name" in updates ? { name: updates.name! } : {}),
    ...("role" in updates ? { role: updates.role! } : {}),
    ...("password" in updates && updates.password
      ? { passwordHash: await bcrypt.hash(updates.password, 10) }
      : {}),
  }
  users[idx] = next
  await writeAll(users)
  const { passwordHash, ...rest } = next
  return rest
}

export async function deleteUser(id: string) {
  const users = await getAll()
  const next = users.filter((u) => u.id !== id)
  await writeAll(next)
}

export async function verifyLogin(identifier: string, password: string) {
  const users = await getAll()
  const user = users.find((u) => u.email === identifier || u.name === identifier)
  if (!user) return null
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) return null
  const { passwordHash, ...rest } = user
  return rest
}
