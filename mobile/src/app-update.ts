import { Alert, AppState, Platform, type AppStateStatus } from "react-native"
import Constants from "expo-constants"
import * as Application from "expo-application"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { File, Paths } from "expo-file-system"
import { startActivityAsync, ActivityAction } from "expo-intent-launcher"
import { resolveServerUrl } from "@/format"

const ANDROID_PACKAGE = "com.marketwebsite.fofresearch"
const FLAG_GRANT_READ_URI_PERMISSION = 1
const FLAG_ACTIVITY_NEW_TASK = 0x10000000
const AUTO_UPDATE_KEY = "fof.autoCheckUpdate"
const WAITING_INSTALL_LABEL = "请在系统安装确认中点安装"

type AppRelease = {
  versionCode: number
  versionName: string
  url: string
  notes?: string
  expectedBytes?: number
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

function apkCacheFile(): File {
  return new File(Paths.cache, "fof-research.apk")
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
  try {
    const head = await fetch(url, { method: "HEAD" })
    const len = Number(head.headers.get("content-length"))
    if (Number.isFinite(len) && len > 0) expectedBytes = len
  } catch {
    // optional
  }
  return {
    versionCode,
    versionName: body.versionName || String(versionCode),
    url,
    notes: body.notes,
    expectedBytes,
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
  await startActivityAsync("android.intent.action.INSTALL_PACKAGE", {
    data: file.contentUri,
    type: "application/vnd.android.package-archive",
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
    extra: {
      "android.intent.extra.NOT_UNKNOWN_SOURCE": true,
      "android.intent.extra.RETURN_RESULT": true,
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
  } catch {
    // fall through
  }
  setProgress(`安装未完成。可再点检查更新。可再点「检查更新」`)
  waitingInstall = false
  stopInstallWatcher()
}

function ensureInstallWatcher(): void {
  if (appStateSub) return
  appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") void onReturnFromInstaller()
  })
}

function assertDownloadComplete(file: File, expectedBytes?: number): void {
  const size = typeof file.size === "number" ? file.size : 0
  if (!file.exists || size < 1_000_000) {
    throw new Error(`安装包下载不完整（过小）。请重试`)
  }
  if (expectedBytes && expectedBytes > 0) {
    const delta = Math.abs(size - expectedBytes)
    if (delta > 4096) {
      throw new Error(`安装包下载不完整（${size}/${expectedBytes}）。请重试`)
    }
  }
}

async function downloadAndInstall(release: AppRelease, onProgress?: (label: string) => void): Promise<void> {
  if (onProgress) progressSink = onProgress
  const sizeHint = release.expectedBytes ? `约 ${Math.round(release.expectedBytes / 1024 / 1024)}MB` : "约 100MB"
  onProgress?.(`正在下载 0%（${sizeHint}，请保持网络）`)
  const destination = apkCacheFile()
  let file: File
  try {
    file = await File.downloadFileAsync(release.url, destination, {
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : release.expectedBytes || 0
        if (total > 0) onProgress?.(`正在下载 ${Math.min(100, Math.round((bytesWritten / total) * 100))}%`)
        else onProgress?.(`正在下载 ${Math.round(bytesWritten / 1024 / 1024)}MB…`)
      },
    })
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`下载中断：${detail}。请重试`)
  }
  assertDownloadComplete(file, release.expectedBytes)
  onProgress?.("正在打开安装程序")
  waitingInstall = true
  ensureInstallWatcher()
  try {
    await openInstaller(file)
    onProgress?.(WAITING_INSTALL_LABEL)
  } catch {
    clearWaiting("")
    notice("无法打开安装", `请允许本应用「安装未知应用」。`, [
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

    const cached = apkCacheFile()
    const canReuse =
      cached.exists &&
      typeof cached.size === "number" &&
      release.expectedBytes != null &&
      Math.abs(cached.size - release.expectedBytes) <= 4096

    if (interactive) {
      // Surface on the Profile row even if Alert is dropped by the OEM.
      onProgress?.(canReuse ? `发现 ${release.versionName}，准备打开安装…` : `发现 ${release.versionName}，开始下载…`)
      notice("发现新版本", `${message}\n\n将自动开始${canReuse ? "安装" : "下载"}（约 ${release.expectedBytes ? Math.round(release.expectedBytes / 1024 / 1024) : 100}MB）。`, [
        { text: "好的" },
      ])
      downloading = true
      try {
        if (canReuse) {
          waitingInstall = true
          ensureInstallWatcher()
          onProgress?.("正在打开安装程序")
          await openInstaller(cached)
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