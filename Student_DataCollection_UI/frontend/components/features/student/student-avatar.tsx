"use client"

import { cn } from "@/lib/utils"

export function StudentAvatar({
  gender,
  name,
  className,
}: {
  gender?: string | null
  name?: string
  className?: string
}) {
  const src =
    gender === "female" ? "/decor/clipart-female.png" : "/decor/clipart-male.png"

  return (
    <span
      className={cn(
        "inline-flex overflow-hidden rounded-full bg-[#e0e0e0]",
        className
      )}
    >
      <img
        src={src}
        alt={name ? `${name} avatar` : "Student avatar"}
        className="h-full w-full object-cover object-top"
      />
    </span>
  )
}
