"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Activity } from "lucide-react"

export default function Home() {
  const { student, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) {
      if (student) {
        router.push("/dashboard")
      } else {
        router.push("/login")
      }
    }
  }, [student, isLoading, router])

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
          <Activity className="h-6 w-6 text-primary animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground">Loading FocusTrack...</p>
      </div>
    </div>
  )
}
