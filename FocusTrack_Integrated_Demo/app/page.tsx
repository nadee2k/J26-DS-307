"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Activity } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

export default function Home() {
  const { student, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading) router.replace(student ? "/demo/session" : "/login")
  }, [student, isLoading, router])

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
          <Activity className="h-6 w-6 animate-pulse text-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Loading FocusTrack…</p>
      </div>
    </div>
  )
}
