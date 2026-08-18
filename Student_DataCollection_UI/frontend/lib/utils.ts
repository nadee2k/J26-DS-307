import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const SRI_LANKA = 'Asia/Colombo'

export function formatSriLankaDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-LK', {
    timeZone: SRI_LANKA,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export function formatSriLankaDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-LK', {
    timeZone: SRI_LANKA,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatSriLankaTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleTimeString('en-LK', {
    timeZone: SRI_LANKA,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}
