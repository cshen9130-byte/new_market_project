import { Alert, Platform } from "react-native"
import Constants from "expo-constants"
import * as Application from "expo-application"
import { File, Paths } from "expo-file-system"
import { startActivityAsync, ActivityAction } from "expo-intent-launcher"
import { resolveServerUrl } from "@/format"

const ANDROID_PACKAGE = "com.marketwebsite.fofresearch"
const FLAG_GRANT_READ_URI_PERMISSION = 1
const FLAG_ACTIVITY_NEW_TASK = 0x10000000

type AppRelease = {
  versionCode: number
  versionName: string
  url: string
  notes?: string
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
  Alert.alert(title, message, buttons)
}

let prompted = false
let busy = false
let downloading = false

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

function releaseUrl(release: AppRelease, server: string): string {
  const url = new URL(release.url, server)
  if (url.origin !== new URL(server).origin || !url.pathname.endsWith(".apk")) {
    throw new Error("安装包地址不在当前服务器上")
  }
  return url.toString()
}

async function fetchRelease(): Promise<AppRelease> {
  const server = resolveServerUrl(Platform.OS, __DEV__)
  const response = await fetch(`${server}/app/version.json?t=${Date.now()}`)
  if (!response.ok) throw new Error("无法读取服务器上的版本信息")
  const body = (await response.json()) as Partial<AppRelease>
  const versionCode = Number(body.versionCode)
  if (!Number.isInteger(versionCode) || versionCode < 1 || typeof body.url !== "string") {
    throw new Error("服务器上的版本信息不完整")
  }
  return {
    versionCode,
    versionName: body.versionName || String(versionCode),
    url: releaseUrl({ versionCode, versionName: body.versionName || "", url: body.url }, server),
    notes: body.notes,
  }
}

async function openInstaller(file: File): Promise<void> {
  await startActivityAsync("android.intent.action.VIEW", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  })
}

async function openInstallPermissionSettings(): Promise<void> {
  const packageId = Application.applicationId || ANDROID_PACKAGE
  await startActivityAsync(ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
    data: `package:${packageId}`,
  })
}

async function downloadAndInstall(release: AppRelease, onProgress?: (label: string) => void): Promise<void> {
  onProgress?.("正在下载 0%")
  const destination = new File(Paths.cache, "fof-research.apk")
  const file = await File.downloadFileAsync(release.url, destination, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(`正在下载 ${Math.min(100, Math.round((bytesWritten / totalBytes) * 100))}%`)
      else onProgress?.("正在下载")
    },
  })
  onProgress?.("正在打开安装程序")
  try {
    await openInstaller(file)
  } catch {
    notice("无法打开安装", "请允许本应用安装未知应用，然后回到这里再检查一次更新。", [
      { text: "取消", style: "cancel" },
      { text: "去设置", onPress: () => void openInstallPermissionSettings() },
    ])
  }
}

export async function promptAppUpdate(interactive: boolean, onProgress?: (label: string) => void): Promise<void> {
  if (!isAndroidInstall()) {
    if (interactive) {
      notice("检查更新", "应用内更新在安装到安卓手机后的应用里使用。网页预览不会安装安装包。")
    }
    return
  }
  if (!interactive && prompted) return
  if (!interactive) prompted = true
  if (busy || downloading) return
  busy = true
  try {
    const release = await fetchRelease()
    if (release.versionCode <= installedVersionCode()) {
      if (interactive) notice("已是最新版本", `当前版本 ${currentVersionLabel()}`)
      return
    }
    const message = [`${release.versionName}（${release.versionCode}）`, release.notes || "服务器上有更新的安装包。"]
      .filter(Boolean)
      .join("\n")
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
              onProgress?.("")
              notice("更新失败", detail)
            })
            .finally(() => {
              downloading = false
            })
        },
      },
    ])
  } catch (error: unknown) {
    if (interactive) {
      const detail = error instanceof Error ? error.message : "检查更新失败"
      notice("检查更新失败", detail)
    }
  } finally {
    busy = false
  }
}
