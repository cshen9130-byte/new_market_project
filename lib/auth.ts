"use client"

export interface User {
  id: string
  email: string
  name: string
}

export const authService = {
  init: (): void => {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    const exists = users.find(
      (u: User & { password: string }) => u.name === "ben" || u.email === "ben@example.com"
    )

    if (!exists) {
      const newUser = {
        id: Math.random().toString(36).substr(2, 9),
        email: "ben@example.com",
        password: "123456",
        name: "ben",
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
    }

    users.push(newUser)
    localStorage.setItem("users", JSON.stringify(users))
    return true
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
