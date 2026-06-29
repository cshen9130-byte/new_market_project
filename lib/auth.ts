"use client"

export type PagePermissions = {
  ma?: boolean
  classic?: boolean
  mom?: boolean
  aiKnowledge?: boolean
  pfOperations?: boolean
  pfInvestmentAlt?: boolean
  /** 勾选后：可进投资池（投资概览、在管产品、FOF底层、资料列表） */
  pfInvestmentPool?: boolean
}

export interface User {
  id: string
  email: string
  name: string
  role?: "admin" | "user"
  permissions?: PagePermissions
}

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || res.statusText)
  return data as T
}

function currentUserId(): string {
  try {
    const user = localStorage.getItem("currentUser")
    return user ? (JSON.parse(user)?.id ?? "") : ""
  } catch {
    return ""
  }
}

export const authService = {
  // Ensure server-side users store is initialized
  init: async (): Promise<void> => {
    try {
      const uid = currentUserId()
      await jsonFetch<{ ok: true; users: User[] }>("/api/admin/users", {
        headers: uid ? { "x-market-user-id": uid } : {},
      })
    } catch {
      // ignore
    }
  },

  listUsers: async (): Promise<User[]> => {
    const uid = currentUserId()
    const data = await jsonFetch<{ ok: true; users: User[] }>("/api/admin/users", {
      headers: uid ? { "x-market-user-id": uid } : {},
    })
    return data.users
  },

  addUser: async (
    email: string,
    password: string,
    name: string,
    role: "admin" | "user" = "user",
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const uid = currentUserId()
      await jsonFetch<{ ok: true; user: User }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, name, role }),
        headers: uid ? { "x-market-user-id": uid } : {},
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "添加失败" }
    }
  },

  deleteUser: async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const uid = currentUserId()
      await jsonFetch<{ ok: true }>(`/api/admin/users/${id}`, {
        method: "DELETE",
        headers: uid ? { "x-market-user-id": uid } : {},
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "删除失败" }
    }
  },

  updateUser: async (
    id: string,
    updates: Partial<{ email: string; name: string; password: string; role: "admin" | "user" }>,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const uid = currentUserId()
      await jsonFetch<{ ok: true; user: User }>(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
        headers: uid ? { "x-market-user-id": uid } : {},
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "更新失败" }
    }
  },
  updatePermissions: async (
    id: string,
    permissions: PagePermissions,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const uid = currentUserId()
      await jsonFetch<{ ok: true; user: User }>(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ permissions }),
        headers: uid ? { "x-market-user-id": uid } : {},
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "更新失败" }
    }
  },

  isAdmin: (): boolean => {    const current = JSON.parse(localStorage.getItem("currentUser") || "null")
    if (!current) return false
    return current.role === "admin"
  },

  login: async (identifier: string, password: string): Promise<User | null> => {
    try {
      const data = await jsonFetch<{ ok: true; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      })
      localStorage.setItem("currentUser", JSON.stringify(data.user))
      return data.user
    } catch {
      return null
    }
  },

  logout: () => {
    localStorage.removeItem("currentUser")
  },

  getCurrentUser: (): User | null => {
    const user = localStorage.getItem("currentUser")
    return user ? JSON.parse(user) : null
  },

  refreshCurrentUser: async (): Promise<User | null> => {
    const uid = currentUserId()
    if (!uid) return null
    try {
      const data = await jsonFetch<{ ok: true; user: User }>("/api/auth/me", {
        headers: { "x-market-user-id": uid },
      })
      localStorage.setItem("currentUser", JSON.stringify(data.user))
      return data.user
    } catch {
      return authService.getCurrentUser()
    }
  },

  updateProfile: async (
    updates: Partial<{ name: string; password: string; currentPassword: string }>,
  ): Promise<{ success: boolean; user?: User; error?: string }> => {
    try {
      const uid = currentUserId()
      if (!uid) return { success: false, error: "未登录" }
      const data = await jsonFetch<{ ok: true; user: User }>("/api/auth/profile", {
        method: "PUT",
        body: JSON.stringify(updates),
        headers: { "x-market-user-id": uid },
      })
      localStorage.setItem("currentUser", JSON.stringify(data.user))
      return { success: true, user: data.user }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "更新失败"
      return { success: false, error: message }
    }
  },
}
