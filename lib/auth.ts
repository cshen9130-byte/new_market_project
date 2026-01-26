"use client"

export interface User {
  id: string
  email: string
  name: string
  role?: "admin" | "user"
}

export const authService = {
  init: (): void => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const exists = users.find(
      (u: User & { password: string }) => u.name === "cshen" || u.email === "cshen@example.com"
    )

    if (!exists) {
      const newUser = {
        id: Math.random().toString(36).substr(2, 9),
        email: "cshen@example.com",
        password: "wygmmlhhhh8",
        name: "cshen",
        role: "admin",
      }
      users.push(newUser)
      localStorage.setItem("users", JSON.stringify(users))
    }
  },
  register: (email: string, password: string, name: string): boolean => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")

    if (users.find((u: User & { password: string }) => u.email === email)) {
      return false
    }

    const newUser = {
      id: Math.random().toString(36).substr(2, 9),
      email,
      password,
      name,
      role: "user",
    }

    users.push(newUser)
    localStorage.setItem("users", JSON.stringify(users))
    return true
  },

  listUsers: (): Array<User> => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    return users.map((u: any) => {
      const { password, ...rest } = u
      return rest
    })
  },

  addUser: (email: string, password: string, name: string, role: "admin" | "user" = "user"): { success: boolean; error?: string } => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    if (users.find((u: any) => u.email === email)) {
      return { success: false, error: "邮箱已存在" }
    }
    const newUser = {
      id: Math.random().toString(36).substr(2, 9),
      email,
      password,
      name,
      role,
    }
    users.push(newUser)
    localStorage.setItem("users", JSON.stringify(users))
    return { success: true }
  },

  deleteUser: (id: string): { success: boolean } => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const next = users.filter((u: any) => u.id !== id)
    localStorage.setItem("users", JSON.stringify(next))
    return { success: true }
  },

  updateUser: (id: string, updates: Partial<{ email: string; name: string; password: string; role: "admin" | "user" }>): { success: boolean; error?: string } => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const idx = users.findIndex((u: any) => u.id === id)
    if (idx === -1) return { success: false, error: "用户不存在" }
    if (updates.email) {
      const dup = users.find((u: any) => u.email === updates.email && u.id !== id)
      if (dup) return { success: false, error: "邮箱已存在" }
    }
    users[idx] = { ...users[idx], ...updates }
    localStorage.setItem("users", JSON.stringify(users))
    return { success: true }
  },

  isAdmin: (): boolean => {
    const current = JSON.parse(localStorage.getItem("currentUser") || "null")
    if (!current) return false
    // Only the designated admin account may access admin page
    return current.name === "cshen"
  },

  login: (identifier: string, password: string): User | null => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const user = users.find(
      (u: User & { password: string }) => (u.email === identifier || u.name === identifier) && u.password === password
    )

    if (user) {
      const { password, ...userWithoutPassword } = user
      localStorage.setItem("currentUser", JSON.stringify(userWithoutPassword))
      return userWithoutPassword
    }

    return null
  },

  logout: () => {
    localStorage.removeItem("currentUser")
  },

  getCurrentUser: (): User | null => {
    const user = localStorage.getItem("currentUser")
    return user ? JSON.parse(user) : null
  },
}
