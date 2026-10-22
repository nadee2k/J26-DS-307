export const HEADLINE = {
  macroF1Proposed: 0.534,
  macroF1Baseline: 0.442,
  nonScreenProposed: 0.499,
  nonScreenBaseline: 0.38,
  crossContextProposed: 0.377,
  crossContextBaseline: 0.083,
  silhouette: 0.773,
  realSessions: 2,
  realWindows: 94,
  simulatedSessions: 45,
}

export const INTEGRATION = [
  {
    n: 1,
    name: "Behaviour",
    short: "C1",
    color: "#2A6FDB",
    what: "Typing rhythm, corrections, idle time, app switching and interaction states.",
    why: "Tells us what the learner is doing, without ever storing what they type.",
  },
  {
    n: 2,
    name: "Environment",
    short: "C2",
    color: "#1E8E5A",
    what: "Temperature, humidity, light, noise and motion from an ESP32 sensor node.",
    why: "Explains dips that have nothing to do with effort — a hot, noisy room is not a motivation problem.",
  },
  {
    n: 3,
    name: "Vision",
    short: "C3",
    color: "#D9711C",
    what: "Gaze zone, head pose, phone in frame and reading motion — features only, no video stored.",
    why: "Separates reading on paper from phone use, the case where activity-only models fail.",
  },
  {
    n: 4,
    name: "Fusion & forecast",
    short: "C4",
    color: "#7D3CB0",
    what: "Fuses the streams, forecasts a focus drop 5–10 minutes ahead, and explains why.",
    why: "Turns three signals into one calm, actionable decision the learner can accept or ignore.",
  },
]

export const EVIDENCE = [
  {
    label: "Proposed vs baseline",
    value: "0.534 vs 0.442",
    meta: "Macro-F1, participant-level split",
    note: "The context-aware representation beats raw aggregated features when the test participant is unseen.",
  },
  {
    label: "Non-screen sessions",
    value: "0.499 vs 0.380",
    meta: "Macro-F1, paper-based study",
    note: "The gain is largest where activity counts are weakest — quiet reading looks like idleness to a timer.",
  },
  {
    label: "Unseen task transfer",
    value: "0.377 vs 0.083",
    meta: "Cross-context holdout",
    note: "The representation is far more robust when the task changes, the hard generalisation problem.",
  },
  {
    label: "Interaction states",
    value: "silhouette 0.773",
    meta: "KMeans k = 4, real pilot",
    note: "The unsupervised states are well separated, so transitions between them carry information.",
  },
]

export const LIMITS = [
  "The real pilot is small — 2 sessions, 94 windows. Real numbers are indicative, not conclusive.",
  "The synthetic study (45 sessions) drives the live demo; its numbers are pipeline evidence, not findings.",
  "Concentration labels are self-reported (1–5), so the target inherits self-report bias.",
  "Cross-context accuracy is much lower than participant-level accuracy. Generalising to unseen tasks remains the open research problem.",
  "This demo showcases the integrated experience. It does not claim the integrated model is already validated end-to-end.",
]

export const OBJECTIVES = [
  { id: "SO1", name: "Data collection system", demo: "Three live sources, consent, privacy-preserving features." },
  { id: "SO2", name: "Feature engineering", demo: "60-second windows, temporal and interaction features." },
  { id: "SO3", name: "State modelling", demo: "Unsupervised interaction states shown as a live ribbon." },
  { id: "SO4", name: "Transition modelling", demo: "Interruptions and recovery drive the forecast." },
  { id: "SO5", name: "Context-aware evaluation", demo: "Screen vs paper framing changes how signals are read." },
  { id: "SO6", name: "Integration", demo: "This product: one loop from login to feedback." },
]
