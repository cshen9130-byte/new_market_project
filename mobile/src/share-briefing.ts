import { NativeModules, Platform } from "react-native"
import { File, Paths } from "expo-file-system"

const shareImageNative = NativeModules.ApkInstaller as {
  shareImage?: (uri: string) => Promise<void>
}

type ShareStart = { type: "briefing-share-start"; parts: number; mime: string }
type SharePart = { type: "briefing-share-part"; index: number; data: string }
type ShareEnd = { type: "briefing-share-end" }
type ShareError = { type: "briefing-share-error"; message: string }
export type BriefingShareMessage = ShareStart | SharePart | ShareEnd | ShareError

type PendingShare = {
  parts: string[]
  got: number
  expected: number
  mime: string
  ended: boolean
}

export function shareBriefingScript(): string {
  return `
    (function () {
      if (typeof window.shareMomBriefing === "function") window.shareMomBriefing();
      else if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "briefing-share-error",
          message: "请退出后重新打开简报，再点分享"
        }));
      }
    })();
    true;
  `
}

export function createBriefingShareCollector(onImage: (base64: string, mime: string) => void, onError: (message: string) => void) {
  let pending: PendingShare | null = null

  function finish() {
    if (!pending || !pending.ended || pending.got !== pending.expected) return
    if (pending.parts.some((part) => part == null)) return
    const payload = pending.parts.join("")
    const mime = pending.mime
    pending = null
    onImage(payload, mime)
  }

  return function onMessage(raw: string) {
    let message: BriefingShareMessage
    try {
      message = JSON.parse(raw) as BriefingShareMessage
    } catch {
      return
    }
    if (message.type === "briefing-share-error") {
      pending = null
      onError(message.message || "分享失败")
      return
    }
    if (message.type === "briefing-share-start") {
      const expected = Number(message.parts)
      if (!Number.isInteger(expected) || expected < 1 || expected > 400) {
        onError("图片太大，无法分享")
        pending = null
        return
      }
      pending = { parts: new Array(expected), got: 0, expected, mime: message.mime || "image/png", ended: false }
      return
    }
    if (!pending) return
    if (message.type === "briefing-share-part") {
      if (message.index < 0 || message.index >= pending.expected || pending.parts[message.index] != null) return
      pending.parts[message.index] = String(message.data || "")
      pending.got += 1
      finish()
      return
    }
    if (message.type === "briefing-share-end") {
      pending.ended = true
      finish()
    }
  }
}

export async function shareBriefingImage(base64: string, mime: string): Promise<void> {
  if (Platform.OS !== "android" || !shareImageNative.shareImage) {
    throw new Error("请在手机 App 里分享到微信")
  }
  const extension = mime === "image/jpeg" ? "jpg" : "png"
  const file = new File(Paths.cache, `mom-briefing.${extension}`)
  if (file.exists) file.delete()
  file.create()
  await file.write(base64, { encoding: "base64" })
  await shareImageNative.shareImage(file.uri)
}
