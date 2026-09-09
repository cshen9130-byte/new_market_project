import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/** Load `.env.local` then `.env` without overriding existing process.env. */
export function loadProjectEnv(cwd = process.cwd()): void {
  for (const fname of [".env.local", ".env"]) {
    const file = join(cwd, fname)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
      const i = trimmed.indexOf("=")
      const key = trimmed.slice(0, i).trim()
      const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "")
      if (key && !process.env[key]) process.env[key] = value
    }
  }
}
