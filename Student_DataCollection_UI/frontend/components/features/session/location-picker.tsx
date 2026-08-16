"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { STUDY_LOCATION_OPTIONS } from "@/lib/constants"

export function LocationPicker({
  location,
  locationOther,
  onLocationChange,
  onOtherChange,
}: {
  location: string
  locationOther: string
  onLocationChange: (value: string) => void
  onOtherChange: (value: string) => void
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label className="text-xs">Study Location *</Label>
        <Select value={location} onValueChange={onLocationChange}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Select location" />
          </SelectTrigger>
          <SelectContent>
            {STUDY_LOCATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {location === "other" && (
        <div className="grid gap-1.5">
          <Label className="text-xs">Type your location *</Label>
          <Input
            value={locationOther}
            onChange={(event) => onOtherChange(event.target.value)}
            placeholder="e.g. hostel, cafe, relative's house"
            className="h-10"
          />
        </div>
      )}
    </div>
  )
}
