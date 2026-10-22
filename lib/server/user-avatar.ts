import { mkdir, readFile, unlink, writeFile } from "fs/promises"
import path from "path"

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const USER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const EXTS = ["jpg", "png", "webp", "gif"] as const

export type AvatarKind = {
  ext: (typeof EXTS)[number]
  contentType: string
}

export function publicAvatarUrl(id: string, updatedAt: string | Date | null | undefined): string | null {
  if (updatedAt == null || updatedAt === "") return null
  const ms = new Date(updatedAt).getTime()
  if (!Number.isFinite(ms)) return null
  return `/api/auth/avatar/${encodeURIComponent(id)}?v=${ms}`
}

export function sniffAvatar(bytes: Buffer): AvatarKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" }
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" }
  }
  const gif = bytes.length >= 6 ? bytes.toString("ascii", 0, 6) : ""
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { ext: "gif", contentType: "image/gif" }
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", contentType: "image/webp" }
  }
  return null
}

function avatarDir(): string {
  return path.join(process.cwd(), "data", "avatars")
}

function assertUserId(id: string): string {
  const trimmed = id.trim()
  if (!USER_ID_RE.test(trimmed)) throw new Error("用户不存在")
  return trimmed
}

export async function writeAvatarFile(userId: string, bytes: Buffer): Promise<AvatarKind> {
  if (bytes.length === 0) throw new Error("图片为空")
  if (bytes.length > MAX_AVATAR_BYTES) throw new Error("图片过大（最大 2MB）")
  const kind = sniffAvatar(bytes)
  if (!kind) throw new Error("请上传 JPG、PNG、WEBP 或 GIF 图片")
  const id = assertUserId(userId)
  const dir = avatarDir()
  await mkdir(dir, { recursive: true })
  await removeAvatarFiles(id)
  await writeFile(path.join(dir, `${id}.${kind.ext}`), bytes)
  return kind
}

export async function removeAvatarFiles(userId: string): Promise<void> {
  let id: string
  try {
    id = assertUserId(userId)
  } catch {
    return
  }
  await Promise.all(
    EXTS.map(async (ext) => {
      try {
        await unlink(path.join(avatarDir(), `${id}.${ext}`))
      } catch {
        // already absent
      }
    }),
  )
}

export async function readAvatarFile(userId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  let id: string
  try {
    id = assertUserId(userId)
  } catch {
    return null
  }
  const dir = avatarDir()
  for (const ext of EXTS) {
    try {
      const bytes = await readFile(path.join(dir, `${id}.${ext}`))
      const kind = sniffAvatar(bytes)
      if (!kind) continue
      return { bytes, contentType: kind.contentType }
    } catch {
      // try the next extension
    }
  }
  return null
}
