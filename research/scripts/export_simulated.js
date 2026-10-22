// Export the PP1 simulated study to CSV for the research pipeline.
// Observable fields only: the hidden focus process is NOT exported.
// Usage: node export_simulated.js <output-dir> [seed] [compiled-sim-dir]
const fs = require("fs");
const path = require("path");

const build = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(__dirname, "..", ".sim-build");
const { generateStudy } = require(path.join(build, "generate.js"));

const out = process.argv[2];
const seed = Number(process.argv[3] || 2026);
if (!out) {
  console.error("usage: node export_simulated.js <output-dir> [seed] [compiled-sim-dir]");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const study = generateStudy(seed);
const byPid = new Map(study.participants.map((p) => [p.id, p]));

const esc = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const num = (v) => (Number.isFinite(v) ? Number(v.toFixed(6)) : v);

function writeCsv(name, header, rows) {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(esc).join(","));
  fs.writeFileSync(path.join(out, name), lines.join("\n") + "\n");
  console.log(`${name}: ${rows.length} rows`);
}

const sessionRows = study.sessions.map((s) => {
  const p = byPid.get(s.pid);
  return [
    s.id, s.pid, s.index, s.mode, s.task, s.room, s.startHour, s.sessionRating,
    p.usualMode, p.faculty, s.epochs.length * 60,
  ];
});
writeCsv(
  "sessions.csv",
  ["session_id", "participant_id", "session_index", "study_mode", "task", "room",
   "start_hour", "session_rating", "usual_mode", "faculty", "duration_seconds"],
  sessionRows,
);

const epochRows = [];
for (const s of study.sessions) {
  for (const e of s.epochs) {
    epochRows.push([
      s.id, s.pid, e.t, num(e.typingRate), num(e.interKeyVar), num(e.backspaceRatio),
      num(e.idleRatio), num(e.mouseSpeed), num(e.switchRate), e.keyboardActive,
    ]);
  }
}
writeCsv(
  "epochs.csv",
  ["session_id", "participant_id", "epoch_index", "typing_rate", "inter_key_var",
   "backspace_ratio", "idle_ratio", "mouse_speed", "switch_rate", "keyboard_active"],
  epochRows,
);

const probeRows = [];
for (const s of study.sessions) {
  s.probes.forEach((p, i) => {
    probeRows.push([s.id, s.pid, i, p.t, p.rating, p.observer]);
  });
}
writeCsv(
  "probes.csv",
  ["session_id", "participant_id", "probe_index", "epoch_index", "rating", "observer"],
  probeRows,
);
