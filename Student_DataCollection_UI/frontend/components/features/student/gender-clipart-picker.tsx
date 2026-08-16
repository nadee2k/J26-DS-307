"use client"

import { cn } from "@/lib/utils"
import { StudentAvatar } from "@/components/features/student/student-avatar"

export function GenderClipartPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: "male" | "female") => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["male", "female"] as const).map((gender) => {
        const selected = value === gender
        return (
          <button
            key={gender}
            type="button"
            onClick={() => onChange(gender)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-2xl border bg-white p-3 transition",
              selected
                ? "border-[#7b3fa0] ring-2 ring-[#7b3fa0]/20"
                : "border-[#eadfce] hover:border-[#c4b0d6]"
            )}
          >
            <StudentAvatar gender={gender} className="h-20 w-20" />
            <span className="text-sm font-medium">{gender === "male" ? "Male" : "Female"}</span>
          </button>
        )
      })}
    </div>
  )
}
