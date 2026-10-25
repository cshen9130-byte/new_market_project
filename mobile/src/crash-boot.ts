import AsyncStorage from "@react-native-async-storage/async-storage"

const BOOT_KEY = "fof.lastBootTag"

/** Persist a tag before risky native init so next cold start can report where we died. */
export async function setLastBootTag(tag: string): Promise<void> {
  try {
    await AsyncStorage.setItem(BOOT_KEY, `${Date.now()}|${tag}`)
  } catch {
    // ignore
  }
}

export async function getLastBootTag(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(BOOT_KEY)
  } catch {
    return null
  }
}

export async function clearLastBootTag(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BOOT_KEY)
  } catch {
    // ignore
  }
}
