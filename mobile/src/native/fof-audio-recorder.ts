import { NativeModules, PermissionsAndroid, Platform } from "react-native"

type StartResult = { uri?: string }
type StopResult = { uri?: string; mimeType?: string; base64?: string; bytes?: number }

type FofAudioRecorderNative = {
  start: () => Promise<StartResult>
  stop: () => Promise<StopResult>
  cancel: () => Promise<null>
}

/** Resolve native module only when called — package registration is inert until start(). */
function getRecorder(): FofAudioRecorderNative {
  const mod = NativeModules.FofAudioRecorder as FofAudioRecorderNative | undefined
  if (!mod?.start || !mod?.stop) {
    throw new Error("FofAudioRecorder native module missing")
  }
  return mod
}

export function isFofAudioRecorderAvailable(): boolean {
  if (Platform.OS !== "android") return false
  const mod = NativeModules.FofAudioRecorder as FofAudioRecorderNative | undefined
  return Boolean(mod?.start && mod?.stop)
}

export async function requestMicPermission(): Promise<boolean> {
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

export async function startFofRecording(): Promise<void> {
  await getRecorder().start()
}

export async function stopFofRecording(): Promise<StopResult> {
  return getRecorder().stop()
}

export async function cancelFofRecording(): Promise<void> {
  try {
    const mod = NativeModules.FofAudioRecorder as FofAudioRecorderNative | undefined
    if (mod?.cancel) await mod.cancel()
  } catch {
    // ignore
  }
}
