import { NativeModules, Platform } from "react-native"
import { File, Paths } from "expo-file-system"
import { exportResearchReport, type ResearchExportFormat } from "@/api"

const shareNative = NativeModules.ApkInstaller as {
  shareImage?: (uri: string) => Promise<void>
  shareFile?: (uri: string, mime: string, title?: string) => Promise<void>
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

async function shareLocalFile(uri: string, mime: string, title: string): Promise<void> {
  if (Platform.OS !== "android") {
    throw new Error("请在 Android 手机 App 里分享到微信")
  }
  if (typeof shareNative.shareFile === "function") {
    await shareNative.shareFile(uri, mime, title)
    return
  }
  // Older APK without shareFile: images only
  if (mime.startsWith("image/") && typeof shareNative.shareImage === "function") {
    await shareNative.shareImage(uri)
    return
  }
  throw new Error("当前 App 版本不支持文件分享，请检查更新后再试")
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
  await shareLocalFile(file.uri, mime, safeName)
  return safeName
}
