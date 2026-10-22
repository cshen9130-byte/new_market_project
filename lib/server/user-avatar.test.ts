/**
 *   npx tsx --test lib/server/user-avatar.test.ts
 */
import assert from "node:assert/strict"
import test from "node:test"
import { publicAvatarUrl, readAvatarFile, removeAvatarFiles, sniffAvatar, writeAvatarFile } from "./user-avatar"

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test("sniff accepts jpeg, png, gif, and webp", () => {
  assert.equal(sniffAvatar(JPEG)?.contentType, "image/jpeg")
  assert.equal(sniffAvatar(PNG)?.ext, "png")
  assert.equal(sniffAvatar(Buffer.from("GIF89aXXXX"))?.contentType, "image/gif")
  const webp = Buffer.alloc(12)
  webp.write("RIFF", 0, "ascii")
  webp.write("WEBP", 8, "ascii")
  assert.equal(sniffAvatar(webp)?.ext, "webp")
})

test("sniff rejects empty and non-image bytes", () => {
  assert.equal(sniffAvatar(Buffer.alloc(0)), null)
  assert.equal(sniffAvatar(Buffer.from("<svg></svg>")), null)
  assert.equal(sniffAvatar(Buffer.from("not an image")), null)
})

test("avatar url is omitted until a timestamp exists", () => {
  assert.equal(publicAvatarUrl("abc", null), null)
  assert.equal(publicAvatarUrl("abc", ""), null)
  const stamp = "2026-10-22T09:00:00.000Z"
  assert.equal(publicAvatarUrl("abc", stamp), `/api/auth/avatar/abc?v=${Date.parse(stamp)}`)
  assert.equal(publicAvatarUrl("a b", stamp), `/api/auth/avatar/a%20b?v=${Date.parse(stamp)}`)
})

test("avatar file round trip stays inside data/avatars", async () => {
  const id = "avatarunittest"
  try {
    const saved = await writeAvatarFile(id, JPEG)
    assert.equal(saved.ext, "jpg")
    const read = await readAvatarFile(id)
    assert.equal(read?.contentType, "image/jpeg")
    assert.deepEqual(read?.bytes, JPEG)
    await writeAvatarFile(id, PNG)
    const png = await readAvatarFile(id)
    assert.equal(png?.contentType, "image/png")
    assert.equal(await readAvatarFile("avatarunittest.jpg"), null)
  } finally {
    await removeAvatarFiles(id)
  }
  assert.equal(await readAvatarFile(id), null)
})

test("rejects oversized files, non-images, and unsafe ids", async () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 1)
  big[0] = 0xff
  big[1] = 0xd8
  big[2] = 0xff
  await assert.rejects(() => writeAvatarFile("avatarunittest", big), /图片过大/)
  await assert.rejects(() => writeAvatarFile("avatarunittest", Buffer.from("<html></html>")), /JPG、PNG/)
  await assert.rejects(() => writeAvatarFile("../etc/passwd", JPEG), /用户不存在/)
  assert.equal(await readAvatarFile("../etc/passwd"), null)
})
