"use client"

export interface User {
  id: string
  email: string
  name: string
  role?: "admin" | "user"
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

export const authService = {
  // Ensure server-side users store is initialized
  init: async (): Promise<void> => {
    try {
      await jsonFetch<{ ok: true; users: User[] }>("/api/admin/users")
    } catch {
      // ignore
    }
  },

  listUsers: async (): Promise<User[]> => {
    const data = await jsonFetch<{ ok: true; users: User[] }>("/api/admin/users")
    return data.users
  },

  addUser: async (
    email: string,
    password: string,
    name: string,
    role: "admin" | "user" = "user",
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      await jsonFetch<{ ok: true; user: User }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, name, role }),
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "添加失败" }
    }
  },

  deleteUser: async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await jsonFetch<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" })
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
      await jsonFetch<{ ok: true; user: User }>(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || "更新失败" }
    }
  },

  isAdmin: (): boolean => {
    const current = JSON.parse(localStorage.getItem("currentUser") || "null")
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
}
