import { Alert, NativeModules, Platform } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import Constants from "expo-constants"
import * as Application from "expo-application"
import { File, Paths } from "expo-file-system"
import { resolveServerUrl } from "@/format"

const AUTO_UPDATE_KEY = "fof.autoUpdate"

const installer = NativeModules.ApkInstaller as {
  prepare: () => Promise<boolean>
  install: (uri: string) => Promise<void>
}

const ANDROID_PACKAGE = "com.marketwebsite.fofresearch"

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

export async function readAutoUpdate(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTO_UPDATE_KEY)) === "1"
}

export async function writeAutoUpdate(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_UPDATE_KEY, enabled ? "1" : "0")
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

async function downloadAndInstall(release: AppRelease, onProgress?: (label: string) => void): Promise<void> {
  const allowed = await installer.prepare()
  if (!allowed) {
    onProgress?.("请允许安装未知应用，然后再次点击检查更新")
    return
  }
  onProgress?.("正在下载 0%")
  const destination = new File(Paths.cache, "fof-research.apk")
  const file = await File.downloadFileAsync(release.url, destination, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(`正在下载 ${Math.min(100, Math.round((bytesWritten / totalBytes) * 100))}%`)
      else onProgress?.("正在下载")
    },
  })
  onProgress?.("正在安装")
  await installer.install(file.uri)
  onProgress?.("请在系统安装确认中点安装")
}

export async function promptAppUpdate(interactive: boolean, onProgress?: (label: string) => void): Promise<void> {
  if (!isAndroidInstall()) {
    if (interactive) {
      notice("检查更新", "应用内更新在安装到安卓手机后的应用里使用。网页预览不会安装安装包。")
    }
    return
  }
  if (!interactive && prompted) return
  if (!interactive) {
    prompted = true
    if (!(await readAutoUpdate())) return
  }
  if (busy || downloading) return
  busy = true
  try {
    const release = await fetchRelease()
    if (release.versionCode <= installedVersionCode()) {
      if (interactive) notice("已是最新版本", `当前版本 ${currentVersionLabel()}`)
      return
    }
    downloading = true
    try {
      await downloadAndInstall(release, onProgress)
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : "下载失败"
      onProgress?.("")
      notice("更新失败", detail)
    } finally {
      downloading = false
    }
  } catch (error: unknown) {
    if (interactive) {
      const detail = error instanceof Error ? error.message : "检查更新失败"
      notice("检查更新失败", detail)
    }
  } finally {
    busy = false
  }
}
