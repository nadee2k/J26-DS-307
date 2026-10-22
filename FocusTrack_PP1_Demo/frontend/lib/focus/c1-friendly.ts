// Plain-language interpretation of one C1 epoch for the learner-facing view.
// The technical workbench still shows the probability and feature values; this module
// deliberately turns them into short, non-numeric observations.

import type { C1Features, StudyMode } from "./types"

export type FriendlyTone = "good" | "mixed" | "low" | "neutral"
export type FriendlyTrend = "improving" | "steady" | "slipping" | "unknown"

export interface FriendlyOutcome {
  title: string
  tone: FriendlyTone
  summary: string
  notices: string[]
  suggestion: string
  trend: FriendlyTrend
  trendText: string
}

export interface FriendlyInput {
  features: C1Features | null
  probability: number | null
  /** Most recent probabilities, oldest first. */
  recentProbabilities: number[]
  mode: StudyMode
  activeApp: string | null
  running: boolean
}

export interface GlanceItem {
  label: string
  value: string
}

const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function trendOf(values: number[]): FriendlyTrend {
  if (values.length < 4) return "unknown"
  const recent = average(values.slice(-2))
  const previous = average(values.slice(-4, -2))
  if (recent - previous > 0.05) return "improving"
  if (previous - recent > 0.05) return "slipping"
  return "steady"
}

function trendText(trend: FriendlyTrend, hasData: boolean): string {
  if (!hasData) return "There isn't enough activity yet to show a trend."
  if (trend === "improving") return "Your focus is improving over the last few updates."
  if (trend === "slipping") return "Your focus is slipping a little."
  if (trend === "steady") return "Your focus is holding steady."
  return "There aren't enough updates yet to show a trend."
}

/**
 * Turn the model/feature output into a friendly headline, observations and one suggestion.
 * No numbers are returned on purpose.
 */
export function friendlyOutcome(input: FriendlyInput): FriendlyOutcome {
  const { features: f, probability: p, recentProbabilities: recent, mode, activeApp, running } = input
  const trend = trendOf(recent)

  if (!f) {
    return {
      title: running ? "Getting started" : "Ready when you are",
      tone: "neutral",
      summary: running
        ? "Work normally for a few moments. The first check will appear here."
        : "Press Start, then work as you usually would. The first check appears after one update.",
      notices: ["Nothing has been analysed yet."],
      suggestion: running ? "Keep working — no need to do anything special." : "Start with a task you would normally do.",
      trend,
      trendText: trendText(trend, false),
    }
  }

  const quiet = f.idleRatio >= 0.6
  const switching = f.switchRate >= 2
  const typing = f.keyboardActive && f.typingRate >= 10
  const correcting = f.keyboardActive && f.backspaceRatio >= 0.2
  const mousey = f.mouseSpeed >= 40
  const lowProbability = p != null && p < 0.45
  const highProbability = p != null && p >= 0.65

  let title: string
  let tone: FriendlyTone
  let summary: string

  if (switching) {
    title = "Lots of switching"
    tone = "mixed"
    summary = "You're moving between apps a lot, so it's hard to stay with one task."
  } else if (quiet && !typing && !mousey) {
    title = mode === "non-screen" ? "A quiet reading stretch" : "You have gone quiet"
    tone = lowProbability ? "low" : "neutral"
    summary = mode === "non-screen"
      ? "Paper work often looks quiet — that's expected."
      : "There's been no typing or mouse movement for a while."
  } else if (typing && !switching && !quiet) {
    title = "You look focused"
    tone = "good"
    summary = "Your typing is steady and you're staying with the task."
  } else if (highProbability) {
    title = "On track"
    tone = "good"
    summary = "You're making progress with only a few interruptions."
  } else if (lowProbability) {
    title = "Struggling to settle"
    tone = "low"
    summary = "There are signs of distraction or stopping. A small reset may help."
  } else {
    title = "A little distracted"
    tone = "mixed"
    summary = "You're getting some work done, but there are interruptions."
  }

  const notices: string[] = []
  if (activeApp) notices.push(`You're working in ${activeApp}.`)
  if (typing) notices.push("Your typing is steady.")
  else if (f.keyboardActive) notices.push("There's some typing, but not much.")
  if (correcting) notices.push("You're correcting quite a few mistakes.")
  if (quiet) {
    notices.push(mode === "non-screen"
      ? "It's quiet — normal for reading or writing on paper."
      : "There are long quiet stretches with no typing or mouse movement.")
  }
  if (switching) notices.push("You're changing apps often.")
  else if (f.switchRate > 0) notices.push("You changed apps a few times.")
  if (!f.keyboardActive && !mousey && !quiet) notices.push("There's very little activity in this period.")
  if (!notices.length) notices.push("There isn't enough activity to say much yet.")

  const suggestion = switching
    ? "Try keeping just one window open for the next few minutes."
    : correcting
      ? "Slow down a little; accuracy first."
      : quiet
        ? mode === "non-screen"
          ? "If you're reading, keep going. If you're stuck, note the next small step."
          : "Write down the next small step, or take a short break if you're stuck."
        : lowProbability
          ? "Try one task at a time for the next few minutes."
          : "Keep going — this is a good rhythm."

  return {
    title,
    tone,
    summary,
    notices: notices.slice(0, 3),
    suggestion,
    trend,
    trendText: trendText(trend, true),
  }
}

/** Qualitative replacement for the numeric metrics in the simple view. */
export function friendlyGlance(f: C1Features | null, activeApp: string | null): GlanceItem[] {
  if (!f) {
    return [
      { label: "Working in", value: activeApp ?? "Not sure yet" },
      { label: "Typing", value: "Waiting" },
      { label: "Mouse", value: "Waiting" },
      { label: "App switching", value: "Waiting" },
      { label: "Mistakes corrected", value: "Waiting" },
      { label: "Time away", value: "Waiting" },
    ]
  }
  return [
    { label: "Working in", value: activeApp ?? "Not sure" },
    { label: "Typing", value: f.typingRate >= 15 ? "Steady" : f.typingRate > 0 ? "A little" : "None" },
    { label: "Mouse", value: f.mouseSpeed >= 40 ? "Moving" : f.mouseSpeed > 0 ? "A little" : "Still" },
    { label: "App switching", value: f.switchRate >= 2 ? "Often" : f.switchRate > 0 ? "A few" : "None" },
    { label: "Mistakes corrected", value: !f.keyboardActive ? "—" : f.backspaceRatio >= 0.2 ? "Quite a few" : f.backspaceRatio > 0.05 ? "Some" : "Few" },
    { label: "Time away", value: f.awayShare >= 0.2 ? "A lot" : f.awayShare > 0 ? "A little" : "No" },
  ]
}
