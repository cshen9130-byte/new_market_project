import { Alert, AppState, Platform, type AppStateStatus } from "react-native"
import Constants from "expo-constants"
import * as Application from "expo-application"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { File, FileMode, Paths } from "expo-file-system"
import { startActivityAsync, ActivityAction } from "expo-intent-launcher"
import { resolveServerUrl } from "@/format"

const ANDROID_PACKAGE = "com.marketwebsite.fofresearch"
const FLAG_GRANT_READ_URI_PERMISSION = 1
const FLAG_ACTIVITY_NEW_TASK = 0x10000000
const AUTO_UPDATE_KEY = "fof.autoCheckUpdate"
/** Bump with each release so old size-only APK cache reuse cannot match. */
const UPDATE_CACHE_BUST = "fof-apk-cache-bust-1.6.63-70"
void UPDATE_CACHE_BUST

const WAITING_INSTALL_LABEL = "请在系统安装确认中点安装"

type AppRelease = {
  versionCode: number
  versionName: string
  url: string
  notes?: string
  expectedBytes?: number
  /** lowercase hex SHA-256 of the APK bytes; when present, verified before install */
  sha256?: string
}

type NoticeButton = {
  text: string
  style?: "cancel" | "destructive" | "default"
  onPress?: () => void
}

function notice(title: string, message?: string, buttons?: NoticeButton[]): void {
  const text = [title, message].filter(Boolean).join("\n")
  if (Platform.OS === "web") {
    if (buttons && buttons.some((button) => button.style !== "cancel" && button.onPress)) {
      const confirmed = window.confirm(text)
      const choice = buttons.find((button) => (confirmed ? button.style !== "cancel" : button.style === "cancel"))
      choice?.onPress?.()
      return
    }
    window.alert(text)
    return
  }
  try {
    Alert.alert(title, message, buttons)
  } catch {
    // Some OEM builds drop Alert; status text is the fallback.
  }
}

let prompted = false
let busy = false
let downloading = false
let waitingInstall = false
let progressSink: ((label: string) => void) | null = null
let appStateSub: { remove: () => void } | null = null

export function isAndroidInstall(): boolean {
  return Platform.OS === "android" && Application.applicationId === ANDROID_PACKAGE
}

export function currentVersionLabel(): string {
  const name = Application.nativeApplicationVersion || Constants.expoConfig?.version || "1.0.0"
  const code = Application.nativeBuildVersion
  return code ? `${name}（${code}）` : name
}

function installedVersionCode(): number {
  const code = Number(Application.nativeBuildVersion)
  return Number.isFinite(code) ? code : 0
}

function setProgress(label: string): void {
  progressSink?.(label)
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** Let React paint status before long sync work (SHA / copy) freezes the JS thread. */
async function paintProgress(label: string, onProgress?: (label: string) => void): Promise<void> {
  onProgress?.(label)
  progressSink?.(label)
  await sleepMs(48)
}

function apkCacheFile(versionCode: number): File {
  // Version-specific name: never reuse a previous release's APK just because byte size matched.
  return new File(Paths.cache, `fof-research-v${versionCode}.apk`)
}

function legacyApkCacheFile(): File {
  return new File(Paths.cache, "fof-research.apk")
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete()
  } catch {
    // ignore
  }
}

function clearLegacyApkCache(): void {
  deleteQuietly(legacyApkCacheFile())
}

/** Minimal SHA-256 (fallback when crypto.subtle is missing on OEM Hermes). */
function sha256HexBytes(bytes: Uint8Array): string {
  // Incremental SHA-256: never allocates a full padded copy of the input.
  // Fixes Hermes TypedArray overrun from JS `((55 - n) % 64)` going negative on large APKs.
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ])
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  const block = new Uint8Array(64)

  const compress = (blk: Uint8Array) => {
    const dv = new DataView(blk.buffer, blk.byteOffset, 64)
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(j * 4, false)
    for (let j = 16; j < 64; j++) {
      const v0 = w[j - 15], v1 = w[j - 2]
      const s0 = rotr(v0, 7) ^ rotr(v0, 18) ^ (v0 >>> 3)
      const s1 = rotr(v1, 17) ^ rotr(v1, 19) ^ (v1 >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }

  const bytesLen = bytes.byteLength
  let offset = 0
  while (offset + 64 <= bytesLen) {
    // Copy one block — never call set() with a source longer than dest
    block.set(bytes.subarray(offset, offset + 64))
    compress(block)
    offset += 64
  }

  // Remainder + padding in at most two 64-byte blocks (never larger than 128)
  const rem = bytesLen - offset
  const bitLenHi = Math.floor(bytesLen / 0x20000000)
  const bitLenLo = (bytesLen << 3) >>> 0
  // zero-pad count after 0x80 so (bytesLen + 1 + zeros) ≡ 56 (mod 64)
  // JS `%` is signed — must normalize: ((55 - bytesLen) % 64 + 64) % 64
  const zeroPad = ((55 - bytesLen) % 64 + 64) % 64
  const padTotal = 1 + zeroPad + 8 // 0x80 + zeros + length
  const pad = new Uint8Array(rem + padTotal)
  if (rem > 0) {
    pad.set(bytes.subarray(offset, offset + rem), 0)
  }
  pad[rem] = 0x80
  // length at end of padded message
  const dvPad = new DataView(pad.buffer)
  dvPad.setUint32(pad.length - 8, bitLenHi, false)
  dvPad.setUint32(pad.length - 4, bitLenLo, false)
  for (let i = 0; i < pad.length; i += 64) {
    block.set(pad.subarray(i, i + 64))
    compress(block)
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("")
}

/** Always returns hex digest; throws if the file cannot be hashed. */
async function sha256HexOfFile(file: File, onProgress?: (label: string) => void): Promise<string> {
  // Prefer chunked read so we never hold a second full APK copy for padding.
  const size = typeof file.size === "number" ? file.size : 0
  if (size > 0) {
    try {
      return await sha256HexOfFileChunked(file, size, onProgress)
    } catch (error) {
      console.warn("[app-update] chunked SHA-256 failed; trying whole-file", error)
    }
  }
  const bytes = await file.bytes()
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", bytes)
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
    } catch (error) {
      console.warn("[app-update] crypto.subtle digest failed; using JS SHA-256", error)
    }
  }
  return sha256HexBytes(bytes)
}

const SHA_READ_CHUNK = 256 * 1024

async function sha256HexOfFileChunked(file: File, size: number, onProgress?: (label: string) => void): Promise<string> {
  // Same incremental SHA-256 as sha256HexBytes, fed from expo File handle.
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ])
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
  const w = new Uint32Array(64)
  const block = new Uint8Array(64)
  const compress = (blk: Uint8Array) => {
    const dv = new DataView(blk.buffer, blk.byteOffset, 64)
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(j * 4, false)
    for (let j = 16; j < 64; j++) {
      const v0 = w[j - 15], v1 = w[j - 2]
      const s0 = rotr(v0, 7) ^ rotr(v0, 18) ^ (v0 >>> 3)
      const s1 = rotr(v1, 17) ^ rotr(v1, 19) ^ (v1 >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[j] + w[j]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }

  let pending = new Uint8Array(0)
  const feed = (chunk: Uint8Array) => {
    if (chunk.byteLength === 0) return
    const merged = new Uint8Array(pending.byteLength + chunk.byteLength)
    if (pending.byteLength) merged.set(pending, 0)
    merged.set(chunk, pending.byteLength)
    let off = 0
    while (off + 64 <= merged.byteLength) {
      block.set(merged.subarray(off, off + 64))
      compress(block)
      off += 64
    }
    pending = merged.subarray(off)
  }

  const handle = file.open()
  try {
    handle.offset = 0
    let read = 0
    let lastPaint = 0
    const PAINT_EVERY = 4 * 1024 * 1024
    while (read < size) {
      const want = Math.min(SHA_READ_CHUNK, size - read)
      const chunk = handle.readBytesSync(want)
      if (!chunk || chunk.byteLength < 1) {
        throw new Error(`read returned empty at ${read}/${size}`)
      }
      // Guard: never treat a short/overlong buffer as full want without clipping
      const safe = chunk.byteLength > want ? chunk.subarray(0, want) : chunk
      feed(safe)
      read += safe.byteLength
      if (onProgress && (read - lastPaint >= PAINT_EVERY || read >= size)) {
        const pct = Math.min(99, Math.round((read / size) * 100))
        onProgress(`正在校验 ${pct}%`)
        progressSink?.(`正在校验 ${pct}%`)
        // Yield so Profile status can re-render; pure JS SHA otherwise freezes UI at download 100%.
        await sleepMs(0)
        lastPaint = read
      }
      if (safe.byteLength < want) {
        // unexpected EOF
        if (read < size) throw new Error(`short read ${read}/${size}`)
        break
      }
    }
  } finally {
    try { handle.close() } catch { /* ignore */ }
  }

  const bytesLen = size
  const rem = pending.byteLength
  const bitLenHi = Math.floor(bytesLen / 0x20000000)
  const bitLenLo = (bytesLen << 3) >>> 0
  const zeroPad = ((55 - bytesLen) % 64 + 64) % 64
  const padTotal = 1 + zeroPad + 8
  const pad = new Uint8Array(rem + padTotal)
  if (rem > 0) pad.set(pending, 0)
  pad[rem] = 0x80
  const dvPad = new DataView(pad.buffer)
  dvPad.setUint32(pad.length - 8, bitLenHi, false)
  dvPad.setUint32(pad.length - 4, bitLenLo, false)
  for (let i = 0; i < pad.length; i += 64) {
    block.set(pad.subarray(i, i + 64))
    compress(block)
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("")
}

async function assertApkIntegrity(
  file: File,
  release: AppRelease,
  onProgress?: (label: string) => void,
): Promise<void> {
  assertDownloadComplete(file, release.expectedBytes)
  assertApkZipMagic(file)
  // EOCD helper must exist — restored in 1.6.42 (was dropped during SHA rewrite).
  if (typeof assertApkZipEocd === "function") {
    assertApkZipEocd(file)
  } else {
    console.warn("[app-update] assertApkZipEocd missing; skipping EOCD check")
  }
  if (!release.sha256) {
    deleteQuietly(file)
    throw new Error(`服务器未提供安装包校验摘要，已中止安装`)
  }
  await paintProgress("正在校验安装包…", onProgress)
  const actual = await sha256HexOfFile(file, onProgress)
  if (actual !== release.sha256) {
    deleteQuietly(file)
    throw new Error(`安装包校验失败（摘要不匹配）。已清除缓存，请重试`)
  }
  await paintProgress("校验完成", onProgress)
}



export async function getAutoCheckUpdate(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(AUTO_UPDATE_KEY)
    if (raw == null) return true
    return raw === "1"
  } catch {
    return true
  }
}

export async function setAutoCheckUpdate(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_UPDATE_KEY, enabled ? "1" : "0")
}


function releaseUrl(release: AppRelease, server: string): string {
  const url = new URL(release.url, server)
  if (url.origin !== new URL(server).origin || !url.pathname.endsWith(".apk")) {
    throw new Error("安装包地址不在当前服务器上")
  }
  return url.toString()
}

async function fetchRelease(): Promise<AppRelease> {
  const server = resolveServerUrl(Platform.OS, __DEV__)
  const versionUrl = `${server}/app/version.json?t=${Date.now()}`
  let response: Response
  try {
    response = await fetch(versionUrl)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法连接更新服务器（${server}）：${detail}`)
  }
  if (!response.ok) throw new Error(`无法读取版本信息（HTTP ${response.status}）`)
  let body: Partial<AppRelease>
  try {
    body = (await response.json()) as Partial<AppRelease>
  } catch {
    throw new Error("版本信息不是有效 JSON")
  }
  const versionCode = Number(body.versionCode)
  if (!Number.isInteger(versionCode) || versionCode < 1 || typeof body.url !== "string") {
    throw new Error("服务器上的版本信息不完整")
  }
  const url = releaseUrl({ versionCode, versionName: body.versionName || "", url: body.url }, server)
  let expectedBytes: number | undefined
  const sizeFromJson = Number((body as { size?: unknown }).size)
  if (Number.isFinite(sizeFromJson) && sizeFromJson > 1_000_000) {
    expectedBytes = sizeFromJson
  }
  try {
    const head = await fetch(url, { method: "HEAD" })
    const len = Number(head.headers.get("content-length"))
    if (Number.isFinite(len) && len > 0) {
      if (expectedBytes && Math.abs(expectedBytes - len) > 64) {
        throw new Error(`服务器版本大小与文件不一致（${expectedBytes}/${len}）`)
      }
      expectedBytes = expectedBytes || len
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("不一致")) throw error
    // HEAD optional when version.json size is present
  }
  if (!expectedBytes || expectedBytes < 1_000_000) {
    throw new Error("版本信息缺少有效安装包大小，请稍后重试")
  }
  const sha256Raw =
    typeof (body as { sha256?: unknown }).sha256 === "string"
      ? (body as { sha256: string }).sha256.trim().toLowerCase()
      : ""
  const sha256 = /^[a-f0-9]{64}$/.test(sha256Raw) ? sha256Raw : undefined
  return {
    versionCode,
    versionName: body.versionName || String(versionCode),
    url,
    notes: body.notes,
    expectedBytes,
    sha256,
  }
}

/** Copy verified APK to a fresh document-dir path so PackageInstaller gets a stable contentUri (Huawei). */
async function stageApkForInstall(
  source: File,
  versionCode: number,
  onProgress?: (label: string) => void,
): Promise<File> {
  const size = typeof source.size === "number" ? source.size : 0
  const tryCopy = async (dest: File): Promise<File> => {
    deleteQuietly(dest)
    // Large APK: always chunk-copy with UI progress. copySync freezes Hermes for minutes on ~200MB+.
    if (size >= 8_000_000) {
      dest.create()
      const rh = source.open()
      const wh = dest.open(FileMode.ReadWrite)
      try {
        const chunk = 1024 * 1024
        let offset = 0
        let lastPaint = 0
        while (offset < size) {
          rh.offset = offset
          const buf = rh.readBytesSync(Math.min(chunk, size - offset))
          wh.offset = offset
          await wh.writeBytes(buf)
          offset += buf.length
          if (offset - lastPaint >= 8 * 1024 * 1024 || offset >= size) {
            const pct = Math.min(99, Math.round((offset / size) * 100))
            onProgress?.(`正在准备安装包 ${pct}%`)
            progressSink?.(`正在准备安装包 ${pct}%`)
            await sleepMs(0)
            lastPaint = offset
          }
        }
      } finally {
        try { rh.close() } catch { /* ignore */ }
        try { wh.close() } catch { /* ignore */ }
      }
    } else {
      const anySrc = source as File & { copySync?: (d: File) => void; copy?: (d: File) => Promise<void> }
      if (typeof anySrc.copySync === "function") {
        anySrc.copySync(dest)
      } else if (typeof anySrc.copy === "function") {
        await anySrc.copy(dest)
      } else {
        dest.create()
        const rh = source.open()
        const wh = dest.open(FileMode.ReadWrite)
        try {
          const chunk = 1024 * 1024
          let offset = 0
          while (offset < size) {
            rh.offset = offset
            const buf = rh.readBytesSync(Math.min(chunk, size - offset))
            wh.offset = offset
            await wh.writeBytes(buf)
            offset += buf.length
          }
        } finally {
          try { rh.close() } catch { /* ignore */ }
          try { wh.close() } catch { /* ignore */ }
        }
      }
    }
    if (!dest.exists || typeof dest.size !== "number" || Math.abs(dest.size - (source.size || 0)) > 64) {
      deleteQuietly(dest)
      throw new Error("stage size mismatch")
    }
    return dest
  }
  await paintProgress("正在准备安装包…", onProgress)
  try {
    return await tryCopy(new File(Paths.document, `fof-install-v${versionCode}.apk`))
  } catch {
    return await tryCopy(new File(Paths.cache, `fof-install-v${versionCode}.apk`))
  }
}

async function openInstallerView(file: File): Promise<void> {
  await startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  })
}

async function openInstallerPackage(file: File): Promise<void> {
  // Do NOT set RETURN_RESULT: on Huawei/EMUI startActivityAsync can stay pending until the
  // user finishes installing, which looks like "stuck at 100%" for several minutes.
  await startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    extra: {
      "android.intent.extra.NOT_UNKNOWN_SOURCE": true,
    },
  })
}

async function openInstaller(file: File): Promise<void> {
  try {
    await openInstallerView(file)
  } catch (viewError) {
    try {
      await openInstallerPackage(file)
    } catch {
      throw viewError
    }
  }
}

async function openInstallPermissionSettings(): Promise<void> {
  const packageId = Application.applicationId || ANDROID_PACKAGE
  await startActivityAsync(ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
    data: `package:${packageId}`,
  })
}

function stopInstallWatcher(): void {
  if (appStateSub) {
    appStateSub.remove()
    appStateSub = null
  }
}

function clearWaiting(label = ""): void {
  waitingInstall = false
  stopInstallWatcher()
  setProgress(label)
}

async function onReturnFromInstaller(): Promise<void> {
  if (!waitingInstall) return
  try {
    const release = await fetchRelease()
    if (release.versionCode <= installedVersionCode()) {
      clearWaiting("")
      notice("更新完成", `当前版本 ${currentVersionLabel()}`)
      return
    }
    // Package installer can say "success" while reinstalling a stale same-size cached APK.
    clearLegacyApkCache()
    deleteQuietly(apkCacheFile(release.versionCode))
    const msg =
      `系统显示安装成功，但当前仍是 ${currentVersionLabel()}，未升到 ${release.versionName}（${release.versionCode}）。` +
      `
多半是旧安装包缓存被重复安装。已清除本地缓存，请再点「检查更新」重新下载。` +
      `
若仍不行：系统设置 → 应用 → 母基金投研 → 清除缓存，或先卸载再从浏览器安装。`
    clearWaiting(msg)
    notice("安装未替换成功", msg, [{ text: "好的" }])
    return
  } catch {
    // fall through
  }
  setProgress("安装未完成。请再点「检查更新」。")
  waitingInstall = false
  stopInstallWatcher()
}

function ensureInstallWatcher(): void {
  if (appStateSub) return
  appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") void onReturnFromInstaller()
  })
}

function assertDownloadComplete(file: File, expectedBytes?: number, knownSize?: number): void {
  const size =
    typeof knownSize === "number" && knownSize > 0
      ? knownSize
      : typeof file.size === "number"
        ? file.size
        : 0
  if (!file.exists || size < 1_000_000) {
    deleteQuietly(file)
    throw new Error(`安装包下载不完整（文件过小 ${size} 字节），请改用浏览器安装或重试`)
  }
  if (expectedBytes && expectedBytes > 0) {
    // Require near-exact Content-Length match; never hand a truncated file to the installer.
    if (Math.abs(size - expectedBytes) > 64) {
      deleteQuietly(file)
      throw new Error(`安装包下载不完整（大小不匹配），请重试（${size}/${expectedBytes}）`)
    }
  }
}

/** APK is a ZIP: must start with PK\x03\x04. Reject HTML error pages / truncated junk. */
function assertApkZipMagic(file: File): void {
  let header: Uint8Array
  try {
    const handle = file.open()
    try {
      header = handle.readBytesSync(4)
    } finally {
      try {
        handle.close()
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.warn("[app-update] cannot read APK header", error)
    deleteQuietly(file)
    throw new Error(`下载文件不是有效 APK（已清除缓存），请重试或用浏览器下载`)
  }
  if (
    header.length < 4 ||
    header[0] !== 0x50 ||
    header[1] !== 0x4b ||
    header[2] !== 0x03 ||
    header[3] !== 0x04
  ) {
    deleteQuietly(file)
    throw new Error(`下载文件不是有效 APK（已清除缓存），请重试或用浏览器下载`)
  }
}

function assertApkZipEocd(file: File): void {
  const size = typeof file.size === "number" ? file.size : 0
  if (size < 22) {
    deleteQuietly(file)
    throw new Error(`安装包下载不完整（无 ZIP 目录），请重试`)
  }
  const scan = Math.min(size, 65557)
  let tail: Uint8Array
  try {
    const handle = file.open()
    try {
      handle.offset = size - scan
      tail = handle.readBytesSync(scan)
    } finally {
      try { handle.close() } catch { /* ignore */ }
    }
  } catch {
    deleteQuietly(file)
    throw new Error(`无法校验安装包结构，请重试`)
  }
  let found = false
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      found = true
      break
    }
  }
  if (!found) {
    deleteQuietly(file)
    throw new Error(`安装包不完整（缺少 ZIP 结尾），请清除缓存后重试`)
  }
}



const APK_CHUNK = 1024 * 1024
const APK_CHUNK_RETRIES = 4


/** Huawei/OEM often abort a single long GET ~half way. Pull with Range chunks + retries. */
async function downloadApkResumable(
  url: string,
  destination: File,
  expectedBytes: number | undefined,
  onProgress?: (label: string) => void,
): Promise<File> {
  deleteQuietly(destination)
  destination.create()
  let offset = 0
  const totalHint = expectedBytes && expectedBytes > 0 ? expectedBytes : 0
  const handle = destination.open(FileMode.ReadWrite)
  try {
    handle.offset = 0
    while (totalHint === 0 || offset < totalHint) {
      const end = totalHint > 0 ? Math.min(offset + APK_CHUNK - 1, totalHint - 1) : offset + APK_CHUNK - 1
      let chunk: Uint8Array | null = null
      let lastErr = ""
      for (let attempt = 1; attempt <= APK_CHUNK_RETRIES; attempt++) {
        try {
          const response = await fetch(url, {
            headers: { Range: `bytes=${offset}-${end}` },
          })
          if (!(response.ok || response.status === 206)) {
            throw new Error(`HTTP ${response.status}`)
          }
          const buf = new Uint8Array(await response.arrayBuffer())
          if (buf.length < 1) throw new Error("empty chunk")
          if (response.status === 200 && offset === 0 && (totalHint === 0 || buf.length >= totalHint)) {
            handle.offset = 0
            await handle.writeBytes(buf)
            offset = buf.length
            onProgress?.("下载完成，准备校验…")
            return destination
          }
          if (response.status === 200 && offset > 0) {
            throw new Error("server ignored Range")
          }
          if (response.status === 206 && totalHint > 0) {
            const want = end - offset + 1
            if (buf.length !== want) {
              throw new Error(`chunk size mismatch ${buf.length}/${want}`)
            }
          }
          chunk = buf
          break
        } catch (error: unknown) {
          lastErr = error instanceof Error ? error.message : String(error)
          const pct = totalHint ? Math.min(99, Math.round((offset / totalHint) * 100)) : 0
          onProgress?.(`下载中 ${pct}%（重试 ${attempt}/${APK_CHUNK_RETRIES}）`)
          await sleepMs(400 * attempt)
        }
      }
      if (!chunk) {
        throw new Error(`下载失败，请保持网络稳定后重试，或用浏览器打开链接下载（${lastErr}）`)
      }
      handle.offset = offset
      await handle.writeBytes(chunk)
      offset += chunk.length
      if (totalHint > 0) {
        onProgress?.(`下载中 ${Math.min(99, Math.round((offset / totalHint) * 100))}%`)
        if (offset >= totalHint) break
      } else if (chunk.length < APK_CHUNK) {
        break
      }
    }
  } finally {
    try {
      handle.close()
    } catch {
      // ignore
    }
  }
  if (totalHint > 0 && offset < totalHint) {
    deleteQuietly(destination)
    throw new Error(`下载失败（未下完 ${offset}/${totalHint}），请保持网络稳定后重试，或用浏览器打开下载`)
  }
  // Some OEMs leave File.size at 0 until a new handle/stat — verify against bytes we wrote.
  const reported = typeof destination.size === "number" ? destination.size : 0
  if (totalHint > 0 && reported > 0 && Math.abs(reported - offset) > 64) {
    deleteQuietly(destination)
    throw new Error(`下载失败（大小异常 ${reported}/${offset}），请重试`)
  }
  if (totalHint > 0 && reported < 1_000_000 && offset >= totalHint) {
    // Metadata stale but bytes were written; integrity will re-stat via reopen in caller.
  }
  return destination
}

async function downloadApkFull(
  url: string,
  destination: File,
  expectedBytes: number | undefined,
  onProgress?: (label: string) => void,
): Promise<File> {
  deleteQuietly(destination)
  onProgress?.("下载中 0%")
  const file = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    headers: { "Cache-Control": "no-cache" },
    onProgress: (data: { totalBytesWritten?: number; totalBytesExpectedToWrite?: number; bytesWritten?: number; totalBytes?: number }) => {
      const written = data.totalBytesWritten ?? data.bytesWritten ?? 0
      const expected = data.totalBytesExpectedToWrite ?? data.totalBytes ?? expectedBytes ?? 0
      if (expected > 0) {
        onProgress?.(`下载中 ${Math.min(99, Math.round((written / expected) * 100))}%`)
      } else {
        onProgress?.(`下载中 ${Math.round(written / 1024 / 1024)}MB`)
      }
    },
  })
  onProgress?.("下载完成，准备校验…")
  return file
}

async function downloadAndInstall(release: AppRelease, onProgress?: (label: string) => void): Promise<void> {
  if (onProgress) progressSink = onProgress
  clearLegacyApkCache()
  const sizeHint = release.expectedBytes ? `约 ${Math.round(release.expectedBytes / 1024 / 1024)}MB` : "约 100MB"
  await paintProgress(`正在下载 0%（${sizeHint}，请保持网络）`, onProgress)
  const destination = apkCacheFile(release.versionCode)
  deleteQuietly(destination)
  let file: File = destination
  let lastDetail = ""
  let ok = false
  // Huawei/OEM: File.downloadFileAsync often "succeeds" with an empty/tiny file on large APKs.
  // Prefer Range resumable whenever we know the package is large; always validate size before accept.
  const preferResume = (release.expectedBytes ?? 0) >= 8_000_000
  for (let pass = 1; pass <= 3; pass++) {
    try {
      deleteQuietly(destination)
      if (preferResume || pass > 1) {
        await paintProgress(`分段下载 ${pass}/3…`, onProgress)
        file = await downloadApkResumable(release.url, destination, release.expectedBytes, onProgress)
      } else {
        try {
          file = await downloadApkFull(release.url, destination, release.expectedBytes, onProgress)
          assertDownloadComplete(file, release.expectedBytes)
        } catch (fullErr: unknown) {
          lastDetail = fullErr instanceof Error ? fullErr.message : String(fullErr)
          deleteQuietly(destination)
          await paintProgress(`改用分段下载…`, onProgress)
          file = await downloadApkResumable(release.url, destination, release.expectedBytes, onProgress)
        }
      }
      // Re-open path to avoid stale File.size metadata on some OEMs.
      file = new File(Paths.cache, `fof-research-v${release.versionCode}.apk`)
      if (!file.exists) {
        file = destination
      }
      await assertApkIntegrity(file, release, onProgress)
      ok = true
      break
    } catch (error: unknown) {
      lastDetail = error instanceof Error ? error.message : String(error)
      deleteQuietly(destination)
      await sleepMs(700 * pass)
    }
  }
  if (!ok) throw new Error(lastDetail || "下载失败，请保持网络稳定后重试，或用浏览器打开链接下载")
  let installFile = file
  try {
    installFile = await stageApkForInstall(file, release.versionCode, onProgress)
    assertDownloadComplete(installFile, release.expectedBytes)
    assertApkZipMagic(installFile)
    if (typeof assertApkZipEocd === "function") assertApkZipEocd(installFile)
  } catch (stageErr: unknown) {
    const detail = stageErr instanceof Error ? stageErr.message : String(stageErr)
    throw new Error(`${detail}

也可浏览器打开：${release.url}`)
  }
  await paintProgress("正在打开安装程序", onProgress)
  waitingInstall = true
  ensureInstallWatcher()
  try {
    await openInstaller(installFile)
    onProgress?.(WAITING_INSTALL_LABEL)
  } catch {
    clearWaiting("")
    notice("无法打开安装", `请允许本应用「安装未知应用」。
也可浏览器打开：
${release.url}`, [
      { text: "去设置", onPress: () => void openInstallPermissionSettings() },
      { text: "取消", style: "cancel" },
    ])
    onProgress?.(`无法打开安装`)
  }
}


/**
 * Interactive check must never no-op: reset stuck flags, always write status / Alert.
 * When a newer build exists, start download immediately (do not rely on Alert buttons —
 * Huawei/EMUI sometimes swallows Alert.alert).
 */
export async function promptAppUpdate(interactive: boolean, onProgress?: (label: string) => void): Promise<void> {
  if (onProgress) progressSink = onProgress

  if (!isAndroidInstall()) {
    if (interactive) {
      const msg = "应用内更新仅在已安装的安卓包可用"
      onProgress?.(msg)
      notice("检查更新", msg)
    }
    return
  }

  if (!interactive) {
    const auto = await getAutoCheckUpdate()
    if (!auto) return
    if (prompted) return
    prompted = true
    // auto path may still hit busy; never block forever
    if (busy || downloading) return
  } else {
    // Manual tap: clear silent stuck state from a hung prior download/check
    if (busy || downloading) {
      onProgress?.("正在重新检查（已重置上次未完成的更新）…")
    } else {
      onProgress?.("正在检查更新…")
    }
    busy = false
    downloading = false
    clearWaiting("")
  }

  if (busy) {
    if (interactive) {
      onProgress?.("检查仍在进行，请稍候…")
      notice("请稍候", "正在检查更新，请稍后再试。")
    }
    return
  }
  if (downloading) {
    if (interactive) {
      onProgress?.("正在下载中…")
      notice("正在下载", "安装包较大（约 100MB），请等待进度。", [
        { text: "好的" },
      ])
    }
    return
  }

  busy = true
  try {
    if (interactive) onProgress?.("正在读取服务器版本…")
    const release = await fetchRelease()
    const local = installedVersionCode()
    if (release.versionCode <= local) {
      if (interactive) {
        onProgress?.("")
        notice("已是最新版本", `当前版本 ${currentVersionLabel()}`)
      }
      return
    }

    const message = [`发现 ${release.versionName}（${release.versionCode}），当前 ${currentVersionLabel()}`, release.notes || ""]
      .filter(Boolean)
      .join("\n")

    clearLegacyApkCache()
    const cached = apkCacheFile(release.versionCode)
    let canReuse = false
    if (
      cached.exists &&
      typeof cached.size === "number" &&
      release.expectedBytes != null &&
      Math.abs(cached.size - release.expectedBytes) <= 64
    ) {
      try {
        await assertApkIntegrity(cached, release, onProgress)
        canReuse = true
      } catch {
        deleteQuietly(cached)
        canReuse = false
      }
    }

    if (interactive) {
      // Surface on the Profile row even if Alert is dropped by the OEM.
      onProgress?.(canReuse ? `发现 ${release.versionName}，准备打开安装…` : `发现 ${release.versionName}，开始下载…`)
      notice("发现新版本", `${message}

将自动开始${canReuse ? "安装" : "下载"}（约 ${release.expectedBytes ? Math.round(release.expectedBytes / 1024 / 1024) : 100}MB）。`, [
        { text: "好的" },
      ])
      downloading = true
      try {
        if (canReuse) {
          await paintProgress("正在准备已缓存的安装包…", onProgress)
          const staged = await stageApkForInstall(cached, release.versionCode, onProgress)
          await paintProgress("正在打开安装程序", onProgress)
          waitingInstall = true
          ensureInstallWatcher()
          await openInstaller(staged)
          onProgress?.(WAITING_INSTALL_LABEL)
        } else {
          await downloadAndInstall(release, onProgress)
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : "更新失败"
        onProgress?.(detail)
        notice("更新失败", detail, [
          { text: "好的" },
        ])
      } finally {
        downloading = false
      }
      return
    }

    // Non-interactive (auto): keep confirm dialog so we don't surprise-download on open
    notice("发现新版本", message, [
      { text: "稍后", style: "cancel" },
      {
        text: "下载并安装",
        onPress: () => {
          if (downloading) return
          downloading = true
          void downloadAndInstall(release, onProgress)
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : "下载失败"
              onProgress?.(detail)
              notice("更新失败", detail, [
                { text: "好的" },
              ])
            })
            .finally(() => {
              downloading = false
            })
        },
      },
    ])
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "检查更新失败"
    if (interactive) {
      onProgress?.(`${detail}`)
      notice("检查更新失败", `${detail}\n\n`, [
        { text: "好的" },
      ])
    }
  } finally {
    busy = false
  }
}
