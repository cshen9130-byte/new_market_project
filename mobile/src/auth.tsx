import AsyncStorage from "@react-native-async-storage/async-storage"
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { Platform } from "react-native"
import { loginRequest } from "@/api"
import { resolveServerUrl } from "@/format"
import { setSession } from "@/session"
import type { User } from "@/types"

const URL_KEY = "fof.baseUrl"
const USER_KEY = "fof.user"

type AuthValue = {
  ready: boolean
  baseUrl: string
  user: User | null
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [baseUrl, setBaseUrl] = useState("")
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pairs = await AsyncStorage.multiGet([URL_KEY, USER_KEY])
      const nextUrl = resolveServerUrl(Platform.OS, __DEV__)
      await AsyncStorage.setItem(URL_KEY, nextUrl)
      const storedUser = pairs[1]?.[1] ?? ""
      let parsed: User | null = null
      if (storedUser) {
        try {
          const raw = JSON.parse(storedUser) as User
          if (raw?.id) parsed = { id: raw.id, name: raw.name, email: raw.email, role: raw.role }
        } catch {
          parsed = null
        }
      }
      if (cancelled) return
      setBaseUrl(nextUrl)
      setUser(parsed)
      setSession({ baseUrl: nextUrl, user: parsed })
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      baseUrl,
      user,
      login: async (identifier, password) => {
        const nextUrl = resolveServerUrl(Platform.OS, __DEV__)
        const nextUser = await loginRequest(nextUrl, identifier.trim(), password)
        await AsyncStorage.multiSet([
          [URL_KEY, nextUrl],
          [USER_KEY, JSON.stringify(nextUser)],
        ])
        setBaseUrl(nextUrl)
        setUser(nextUser)
        setSession({ baseUrl: nextUrl, user: nextUser })
      },
      logout: async () => {
        await AsyncStorage.removeItem(USER_KEY)
        setUser(null)
        setSession({ baseUrl, user: null })
      },
    }),
    [ready, baseUrl, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
