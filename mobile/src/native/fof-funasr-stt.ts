import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native"

type StopResult = { text?: string }

type FofFunAsrSttNative = {
  isAvailable: () => Promise<boolean>
  prepare: () => Promise<boolean>
  start: () => Promise<boolean>
  stop: () => Promise<StopResult>
  cancel: () => Promise<null>
  addListener?: (eventName: string) => void
  removeListeners?: (count: number) => void
}

function getMod(): FofFunAsrSttNative | undefined {
  return NativeModules.FofFunAsrStt as FofFunAsrSttNative | undefined
}

export function isFofFunAsrAvailable(): boolean {
  if (Platform.OS !== "android") return false
  const mod = getMod()
  return Boolean(mod?.start && mod?.stop)
}

export async function requestFunAsrMicPermission(): Promise<boolean> {
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

export function createFunAsrEmitter(): NativeEventEmitter | null {
  const mod = getMod()
  if (!mod) return null
  return new NativeEventEmitter(mod as any)
}

export async function prepareFunAsr(): Promise<void> {
  const mod = getMod()
  if (!mod?.prepare) throw new Error("FofFunAsrStt missing")
  await mod.prepare()
}

export async function startFunAsr(): Promise<void> {
  const mod = getMod()
  if (!mod?.start) throw new Error("FofFunAsrStt missing")
  await mod.start()
}

export async function stopFunAsr(): Promise<string> {
  const mod = getMod()
  if (!mod?.stop) throw new Error("FofFunAsrStt missing")
  const result = await mod.stop()
  return (result?.text || "").trim()
}

export async function cancelFunAsr(): Promise<void> {
  try {
    const mod = getMod()
    if (mod?.cancel) await mod.cancel()
  } catch {
    // ignore
  }
}
