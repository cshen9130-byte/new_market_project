import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native"

type StopResult = { text?: string }

type FofVoskSttNative = {
  isAvailable: () => Promise<boolean>
  prepare: () => Promise<boolean>
  start: () => Promise<boolean>
  stop: () => Promise<StopResult>
  cancel: () => Promise<null>
  addListener?: (eventName: string) => void
  removeListeners?: (count: number) => void
}

function getMod(): FofVoskSttNative | undefined {
  return NativeModules.FofVoskStt as FofVoskSttNative | undefined
}

export function isFofVoskAvailable(): boolean {
  if (Platform.OS !== "android") return false
  const mod = getMod()
  return Boolean(mod?.start && mod?.stop)
}

export async function requestVoskMicPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: "麦克风权限",
      message: "按住 AI 球说话需要使用麦克风",
      buttonPositive: "允许",
      buttonNegative: "取消",
    },
  )
  return granted === PermissionsAndroid.RESULTS.GRANTED
}

export function createVoskEmitter(): NativeEventEmitter | null {
  const mod = getMod()
  if (!mod) return null
  return new NativeEventEmitter(mod as any)
}

export async function prepareVosk(): Promise<void> {
  const mod = getMod()
  if (!mod?.prepare) throw new Error("FofVoskStt missing")
  await mod.prepare()
}

export async function startVosk(): Promise<void> {
  const mod = getMod()
  if (!mod?.start) throw new Error("FofVoskStt missing")
  await mod.start()
}

export async function stopVosk(): Promise<string> {
  const mod = getMod()
  if (!mod?.stop) throw new Error("FofVoskStt missing")
  const result = await mod.stop()
  return (result?.text || "").trim()
}

export async function cancelVosk(): Promise<void> {
  try {
    const mod = getMod()
    if (mod?.cancel) await mod.cancel()
  } catch {
    // ignore
  }
}