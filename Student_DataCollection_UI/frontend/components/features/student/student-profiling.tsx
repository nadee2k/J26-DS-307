import { UserRound, Hash } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GENDER_OPTIONS, TASK_OPTIONS } from "@/lib/constants"

export function StudentProfiling({ sessionCount = 0 }: { sessionCount?: number }) {
  return (
    <Card className="flex min-h-0 flex-col gap-3 border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Student Profiling
        </h2>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="participant-name" className="text-xs">
            Name
          </Label>
          <Input
            id="participant-name"
            placeholder="e.g., Jane Doe"
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="age" className="text-xs">
              Age
            </Label>
            <Input id="age" type="number" placeholder="21" min={0} className="h-9" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gender" className="text-xs">
              Gender
            </Label>
            <Select>
              <SelectTrigger id="gender" className="h-9">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="task" className="text-xs">
            Assigned Study Task
          </Label>
          <Select>
            <SelectTrigger id="task" className="h-9">
              <SelectValue placeholder="Select a task" />
            </SelectTrigger>
            <SelectContent>
              {TASK_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="text-xs font-medium text-muted-foreground">
              Session Count
            </span>
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {sessionCount}
          </span>
        </div>
      </div>
    </Card>
  )
}
