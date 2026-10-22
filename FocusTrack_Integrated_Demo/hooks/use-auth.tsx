"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Student } from "@/lib/demo/types"

interface AuthContextType {
  student: Student | null
  setStudent: (s: Student | null) => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType>({
  student: null,
  setStudent: () => {},
  isLoading: true,
})

const KEY = "ft_demo_student"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [student, setStudentState] = useState<Student | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) setStudentState(JSON.parse(raw) as Student)
    } catch {
      window.localStorage.removeItem(KEY)
    }
    setIsLoading(false)
  }, [])

  const setStudent = (s: Student | null) => {
    setStudentState(s)
    try {
      if (s) window.localStorage.setItem(KEY, JSON.stringify(s))
      else window.localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable */
    }
  }

  return <AuthContext.Provider value={{ student, setStudent, isLoading }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
