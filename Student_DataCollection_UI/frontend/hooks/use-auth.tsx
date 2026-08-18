"use client"

import { createContext, useContext, useState, useEffect, ReactNode } from "react"
import type { Student } from "@/types"

interface AuthContextType {
  student: Student | null
  setStudent: (student: Student | null) => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType>({
  student: null,
  setStudent: () => {},
  isLoading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [student, setStudentState] = useState<Student | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem("focustrack_student")
    if (stored) {
      try {
        setStudentState(JSON.parse(stored))
      } catch {
        localStorage.removeItem("focustrack_student")
      }
    }
    setIsLoading(false)
  }, [])

  const setStudent = (s: Student | null) => {
    setStudentState(s)
    if (s) {
      localStorage.setItem("focustrack_student", JSON.stringify(s))
    } else {
      localStorage.removeItem("focustrack_student")
    }
  }

  return (
    <AuthContext.Provider value={{ student, setStudent, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
