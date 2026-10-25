import { NativeModules, Platform } from "react-native"
import { File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { exportResearchReport, type ResearchExportFormat } from "@/api"

type ApkInstallerNative = {
  shareImage?: (uri: string) => Promise<void>
  shareFile?: (uri: string, mime: string, title?: string) => Promise<void>
}

function getApkInstaller(): ApkInstallerNative | null {
  try {
    const mod = NativeModules.ApkInstaller as ApkInstallerNative | null | undefined
    return mod && typeof mod === "object" ? mod : null
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const triplet = (a << 16) | (b << 8) | c
    out += chars[(triplet >> 18) & 63]
    out += chars[(triplet >> 12) & 63]
    out += i + 1 < bytes.length ? chars[(triplet >> 6) & 63] : "="
    out += i + 2 < bytes.length ? chars[triplet & 63] : "="
  }
  return out
}

function pickShareUri(file: File): string {
  const anyFile = file as File & { contentUri?: string; uri: string }
  const content = typeof anyFile.contentUri === "string" ? anyFile.contentUri.trim() : ""
  if (content) return content
  return anyFile.uri
}

async function shareLocalFile(file: File, mime: string, title: string): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("请在 Android 手机 App 内导出并分享到微信")
  }
  const uri = pickShareUri(file)
  if (!uri) throw new Error("导出文件路径无效，请重试")

  const shareNative = getApkInstaller()
  if (shareNative && typeof shareNative.shareFile === "function") {
    try {
      await shareNative.shareFile(uri, mime, title)
      return
    } catch (err) {
      // Fall through to expo-sharing / image path.
      console.warn("[share-report] native shareFile failed", err)
    }
  }
  if (mime.startsWith("image/") && shareNative && typeof shareNative.shareImage === "function") {
    try {
      await shareNative.shareImage(uri)
      return
    } catch (err) {
      console.warn("[share-report] native shareImage failed", err)
    }
  }

  try {
    const available = await Sharing.isAvailableAsync()
    if (!available) {
      throw new Error("unavailable")
    }
    await Sharing.shareAsync(uri, {
      mimeType: mime,
      dialogTitle: title,
    })
    return
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `无法调起系统分享（${detail}）。文件已生成：${title}。请用浏览器更新到最新版，或从文件管理器打开 App 缓存目录分享。`,
    )
  }
}

export async function exportAndShareManagerReport(input: {
  markdown: string
  managerName: string
  format: ResearchExportFormat
}): Promise<string> {
  const { filename, mime, bytes } = await exportResearchReport({
    markdown: input.markdown,
    managerName: input.managerName,
    title: `${input.managerName}管理人画像`,
    subjectLine: input.managerName,
    format: input.format,
  })
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, "_")
  const file = new File(Paths.cache, safeName)
  if (file.exists) file.delete()
  file.create()
  await file.write(bytesToBase64(bytes), { encoding: "base64" })
  await shareLocalFile(file, mime, safeName)
  return safeName
}
