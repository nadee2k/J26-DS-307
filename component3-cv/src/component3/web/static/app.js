/* FocusTrack Component 3 — single-page app (no build step). */

"use strict";

/* ---------------- helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = `toast${isErr ? " err" : ""}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), isErr ? 6500 : 3500);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const fmtNum = (v, d = 3) => (v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(d));
const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const fmtMeanStd = (m, s) => (m == null ? "—" : `${Number(m).toFixed(3)} ± ${Number(s ?? 0).toFixed(3)}`);
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleString() : "—");

function pill(text, kind) { return `<span class="pill ${kind}">${esc(text)}</span>`; }

function sparkline(values, max = 100) {
  if (!values.length) return "";
  const W = 400, H = 60, P = 4;
  const step = values.length > 1 ? (W - 2 * P) / (values.length - 1) : 0;
  const y = (v) => H - P - ((Math.max(0, Math.min(max, v)) / max) * (H - 2 * P));
  const pts = values.map((v, i) => `${(P + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${(P + (values.length - 1) * step).toFixed(1)},${H - P} L${P},${H - P} Z`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path class="area" d="${area}"/><path class="line" d="${line}"/></svg>`;
}

function barRow(label, value, display) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return `<div class="bar-row">
    <div class="bar-label">${esc(label)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>
    <div class="bar-value">${esc(display)}</div>
  </div>`;
}

/* ---------------- polling registry (cleared on view change) ---------------- */

let timers = [];
function poll(fn, ms) { fn(); timers.push(setInterval(fn, ms)); }
function clearPolls() { timers.forEach(clearInterval); timers = []; }

/* status dot in the sidebar */
setInterval(async () => {
  try {
    const o = await api("/overview");
    const busy = o.capture_running || o.calibration_active;
    $("#live-dot").classList.toggle("on", busy);
    $("#live-text").textContent = o.capture_running ? "capture running"
      : o.calibration_active ? "calibrating" : "idle";
  } catch (_) {}
}, 5000);

/* ---------------- views ---------------- */

const views = {

  /* ------------------------------------------------ dashboard */
  async dashboard(el) {
    const o = await api("/overview");
    const t = o.train_summary;
    const b = o.benchmark;
    el.innerHTML = `
      <h1>Dashboard</h1>
      <div class="sub">FocusTrack Component 3 — computer vision &amp; visual behavior analysis</div>
      <div class="grid c4">
        <div class="card"><div class="stat-label">Consented participants</div>
          <div class="stat-value">${o.participants_consented}</div></div>
        <div class="card"><div class="stat-label">Captured sessions</div>
          <div class="stat-value">${o.sessions}</div>
          <div class="stat-note">${o.windows_total} windows total</div></div>
        <div class="card"><div class="stat-label">Labelled sessions</div>
          <div class="stat-value">${o.labels}</div></div>
        <div class="card"><div class="stat-label">Gaze calibrations</div>
          <div class="stat-value">${o.calibrations.length}</div>
          <div class="stat-note">${esc(o.calibrations.slice(0, 4).join(", ") || "none yet")}</div></div>
      </div>

      <h2>Latest results</h2>
      <div class="grid c2">
        <div class="card">
          <div class="stat-label">Best trained model (LNPO cross-validated)</div>
          ${t ? `
            <div class="stat-value">${fmtMeanStd(t.accuracy_mean, t.accuracy_std)}</div>
            <div class="stat-note">accuracy · ${esc(t.model)} · F1 ${fmtMeanStd(t.f1_mean, t.f1_std)}
            · majority baseline ${fmtNum(t.majority_baseline_accuracy_mean)}</div>`
          : `<div class="empty">No training run yet — go to Train &amp; Evaluate</div>`}
        </div>
        <div class="card">
          <div class="stat-label">Real-time benchmark</div>
          ${b ? `
            <div class="stat-value">${fmtNum(b.max_sustainable_fps, 1)} fps</div>
            <div class="stat-note">target ${b.target_fps} fps ·
              ${b.meets_target ? pill("meets target", "good") : pill("below target", "warn")}
              ${b.stub_phone ? pill("YOLO excluded", "neutral") : pill("YOLO included", "accent")}</div>`
          : `<div class="empty">No benchmark yet — go to Benchmark</div>`}
        </div>
      </div>

      <h2>Recent sessions</h2>
      <div class="card">${o.recent_sessions.length ? `<table>
        <tr><th>Session</th><th>Participant</th><th>Cohort</th><th>Frames</th><th>Windows</th></tr>
        ${o.recent_sessions.map((s) => `<tr>
          <td class="num">${esc(s.session_id)}</td><td>${esc(s.participant_id)}</td>
          <td>${pill(s.cohort, s.cohort === "screen" ? "accent" : "neutral")}</td>
          <td class="num">${s.n_frames}</td><td class="num">${s.n_windows}</td></tr>`).join("")}
      </table>` : `<div class="empty">No sessions captured yet</div>`}</div>`;
  },

  /* ------------------------------------------------ capture */
  async capture(el) {
    const consent = await api("/consent");
    const consented = consent.filter((r) => /^(true|1|yes|y)$/i.test(r.consented || ""));
    el.innerHTML = `
      <h1>Capture</h1>
      <div class="sub">Consent-gated session recording. Frames are processed in-stream and discarded by default.</div>
      <div class="live-wrap">
        <div>
          <div class="card">
            <label class="field"><span>Participant</span>
              <select id="cap-pid">${consented.map((r) =>
                `<option>${esc(r.participant_id)}</option>`).join("") || "<option value=''>— no consented participants —</option>"}</select>
            </label>
            <div class="grid c2">
              <label class="field"><span>Cohort</span>
                <select id="cap-cohort"><option value="screen">screen</option><option value="non_screen">non_screen</option></select>
              </label>
              <label class="field"><span>Duration (seconds, blank = until stopped)</span>
                <input type="number" id="cap-dur" placeholder="e.g. 2700" min="1"/>
              </label>
            </div>
            <label class="field"><span>Source (camera index, video file, or image folder)</span>
              <input type="text" id="cap-source" placeholder="0"/>
            </label>
            <label class="check"><input type="checkbox" id="cap-retain"/> Retain raw frames (debug only — overrides the privacy default)</label>
            <div class="row">
              <button class="btn" id="cap-start">Start session</button>
              <button class="btn danger" id="cap-stop" disabled>Stop</button>
              <button class="btn ghost" id="cap-aim">Aim camera</button>
            </div>
          </div>
          <div class="note">Use the tripod-mounted external webcam for study sessions — the same rig for both cohorts.
          Run gaze calibration for the participant first so on/off-screen gaze uses their calibrated model.</div>
        </div>
        <div>
          <div class="preview-box" id="cap-preview"><span>no preview</span></div>
          <div class="card mt" id="cap-live"><div class="empty">Not running</div></div>
        </div>
      </div>`;

    let previewMode = null; // "capture" | "aim" | null

    const setPreview = (url) => {
      $("#cap-preview").innerHTML = `<img src="${url}?t=${Date.now()}" alt="preview"/>`;
    };

    const renderLive = (st) => {
      const box = $("#cap-live");
      if (st.phase === "running") {
        const lw = st.live_window;
        const last = st.last || {};
        box.innerHTML = `
          <div class="row" style="justify-content:space-between">
            <div>
              <div class="score-big">${lw ? Math.round(lw.score) : "—"}</div>
              <div class="score-unit">live visual focus score (heuristic)</div>
            </div>
            <div style="text-align:right">
              <div class="stat-value" style="font-size:18px">${st.n_frames || 0}</div>
              <div class="score-unit">frames · ${Math.round(st.elapsed || 0)}s elapsed</div>
            </div>
          </div>
          <div class="flag-row">
            ${last.face_present ? pill("face", "good") : pill("no face", "bad")}
            ${last.gaze_valid ? (last.on_screen ? pill("gaze on-screen", "good") : pill("gaze off-screen", "warn")) : pill("gaze n/a", "neutral")}
            ${last.gaze_calibrated ? pill("calibrated", "accent") : pill("uncalibrated", "neutral")}
            ${last.phone_present ? pill(`phone ${fmtNum(last.phone_confidence, 2)}`, "bad") : pill("no phone", "neutral")}
          </div>
          ${last.yaw != null ? `<div class="kv mt"><span class="k">head pose</span>
            <b class="num">yaw ${fmtNum(last.yaw, 1)}° · pitch ${fmtNum(last.pitch, 1)}° · roll ${fmtNum(last.roll, 1)}°</b></div>` : ""}`;
      } else if (st.phase === "done" && st.meta) {
        box.innerHTML = `
          <div class="stat-label">Session complete</div>
          <div class="kv"><span class="k">session</span><b class="num">${esc(st.meta.session_id)}</b></div>
          <div class="kv"><span class="k">frames / windows</span><b class="num">${st.meta.n_frames} / ${st.meta.n_windows}</b></div>
          <div class="row mt">
            <a class="btn small ghost" href="#/sessions">Open in Sessions</a>
            <button class="btn small" id="cap-label-now">Add focus label</button>
          </div>`;
        $("#cap-label-now")?.addEventListener("click", async () => {
          const rating = prompt("Post-session self-report focus rating (1–5):");
          if (!rating) return;
          try {
            await api("/labels", { method: "POST", body: {
              session_id: st.meta.session_id, participant_id: st.meta.participant_id,
              cohort: st.meta.cohort, focus_rating: parseFloat(rating) } });
            toast("Label saved");
          } catch (e) { toast(e.message, true); }
        });
      } else if (st.phase === "error") {
        box.innerHTML = `<div class="stat-label">Capture failed</div><div class="note">${esc(st.error)}</div>`;
      } else {
        box.innerHTML = `<div class="empty">Not running</div>`;
      }
      $("#cap-start").disabled = st.phase === "running";
      $("#cap-stop").disabled = st.phase !== "running";
    };

    poll(async () => {
      try {
        const st = await api("/capture/status");
        renderLive(st);
        if (st.phase === "running") { previewMode = "capture"; setPreview("/api/capture/preview.jpg"); }
        else if (previewMode === "aim") setPreview("/api/preview/frame.jpg");
      } catch (_) {}
    }, 900);

    $("#cap-start").addEventListener("click", async () => {
      const pid = $("#cap-pid").value;
      if (!pid) return toast("Add a consented participant first", true);
      try {
        if (previewMode === "aim") { await api("/preview/stop", { method: "POST" }); previewMode = null; }
        await api("/capture/start", { method: "POST", body: {
          participant_id: pid,
          cohort: $("#cap-cohort").value,
          source: $("#cap-source").value || null,
          duration_seconds: $("#cap-dur").value ? parseFloat($("#cap-dur").value) : null,
          retain_frames: $("#cap-retain").checked,
        }});
        toast("Capture started");
      } catch (e) { toast(e.message, true); }
    });

    $("#cap-stop").addEventListener("click", async () => {
      try { await api("/capture/stop", { method: "POST" }); toast("Capture stopped — session saved"); }
      catch (e) { toast(e.message, true); }
    });

    $("#cap-aim").addEventListener("click", async () => {
      try {
        await api("/preview/start", { method: "POST", body: { source: $("#cap-source").value || null } });
        previewMode = "aim";
        toast("Preview started (auto-stops when idle)");
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ sessions */
  async sessions(el) {
    const sessions = await api("/sessions");
    el.innerHTML = `
      <h1>Sessions</h1>
      <div class="sub">Captured sessions with per-window scores and export artifacts.</div>
      <div class="card">${sessions.length ? `<table>
        <tr><th>Session</th><th>Participant</th><th>Cohort</th><th>Frames</th><th>Windows</th><th>Label</th><th>Captured</th></tr>
        ${sessions.map((s, i) => `<tr class="clickable" data-i="${i}">
          <td class="num">${esc(s.session_id)}</td>
          <td>${esc(s.participant_id)}</td>
          <td>${pill(s.cohort, s.cohort === "screen" ? "accent" : "neutral")}</td>
          <td class="num">${s.n_frames}</td><td class="num">${s.n_windows}</td>
          <td>${s.focus_rating != null && s.focus_rating !== "" ? pill(`rating ${s.focus_rating}`, "good") : pill("unlabelled", "warn")}</td>
          <td class="num">${fmtDate(s.captured_at)}</td></tr>`).join("")}
      </table>` : `<div class="empty">No sessions yet — capture one from the Capture page</div>`}</div>
      <div id="session-drawer" class="drawer"></div>`;

    el.querySelectorAll("tr.clickable").forEach((tr) => tr.addEventListener("click", async () => {
      const s = sessions[Number(tr.dataset.i)];
      const drawer = $("#session-drawer");
      drawer.innerHTML = `<div class="card"><div class="empty"><span class="spinner"></span> loading…</div></div>`;
      try {
        const windows = await api(`/sessions/${encodeURIComponent(s.session_id)}/windows`);
        const scores = windows.map((w) => w.visual_focus_score ?? 0);
        drawer.innerHTML = `<div class="card">
          <div class="row" style="justify-content:space-between">
            <div><div class="stat-label">${esc(s.session_id)}</div>
              <div class="stat-note">${esc(s.participant_id)} · ${esc(s.cohort)} · ${windows.length} windows</div></div>
            <div class="gap">
              <a class="btn small ghost" href="/api/sessions/${encodeURIComponent(s.session_id)}/download/contract">Contract JSONL</a>
              <a class="btn small ghost" href="/api/sessions/${encodeURIComponent(s.session_id)}/download/frames">Frames CSV</a>
              <a class="btn small ghost" href="/api/sessions/${encodeURIComponent(s.session_id)}/download/windows">Windows Parquet</a>
              <button class="btn small" id="sess-label">Set label</button>
            </div>
          </div>
          <div class="mt">${sparkline(scores)}</div>
          <details><summary>Window details (${windows.length})</summary><div class="inner"><table>
            <tr><th>Start</th><th>Score</th><th>Conf</th><th>Face</th><th>Gaze valid</th><th>Off-screen</th><th>Phone</th><th>Away</th></tr>
            ${windows.map((w) => `<tr>
              <td class="num">${esc((w.window_start || "").slice(11, 19))}</td>
              <td class="num">${fmtNum(w.visual_focus_score, 1)}</td>
              <td class="num">${fmtNum(w.confidence, 2)}</td>
              <td class="num">${fmtPct(w.face_present_ratio)}</td>
              <td class="num">${fmtPct(w.gaze_valid_ratio)}</td>
              <td class="num">${w.off_screen_gaze_ratio == null ? "—" : fmtPct(w.off_screen_gaze_ratio)}</td>
              <td>${w.phone_detected ? pill("yes", "bad") : "—"}</td>
              <td class="num">${fmtPct(w.away_from_desk_ratio)}</td></tr>`).join("")}
          </table></div></details>
        </div>`;
        $("#sess-label").addEventListener("click", async () => {
          const rating = prompt(`Focus rating (1–5) for ${s.session_id}:`, s.focus_rating || "");
          if (!rating) return;
          try {
            await api("/labels", { method: "POST", body: {
              session_id: s.session_id, participant_id: s.participant_id,
              cohort: s.cohort, focus_rating: parseFloat(rating) } });
            toast("Label saved"); route();
          } catch (e) { toast(e.message, true); }
        });
      } catch (e) { drawer.innerHTML = `<div class="card"><div class="note">${esc(e.message)}</div></div>`; }
    }));
  },

  /* ------------------------------------------------ calibration */
  async calibration(el) {
    const [consent, cals] = await Promise.all([api("/consent"), api("/calibrations")]);
    const consented = consent.filter((r) => /^(true|1|yes|y)$/i.test(r.consented || ""));
    el.innerHTML = `
      <h1>Gaze calibration</h1>
      <div class="sub">9 on-screen points + off-screen prompts fit a per-participant on/off-screen gaze model. Required for calibrated gaze.</div>
      <div class="grid c2">
        <div class="card">
          <label class="field"><span>Participant</span>
            <select id="cal-pid">${consented.map((r) => `<option>${esc(r.participant_id)}</option>`).join("") || "<option value=''>— none —</option>"}</select>
          </label>
          <label class="field"><span>Camera source (blank = configured default)</span>
            <input type="text" id="cal-source" placeholder="0"/>
          </label>
          <button class="btn" id="cal-start">Start calibration</button>
          <div class="note">The screen will go dark and show a moving dot. Ask the participant to follow it with their eyes only,
          then follow the off-screen prompts. Takes about a minute.</div>
        </div>
        <div class="card">
          <div class="stat-label">Saved calibrations</div>
          ${cals.length ? `<table><tr><th>Participant</th><th>Updated</th><th></th></tr>
            ${cals.map((c) => `<tr><td>${esc(c.participant_id)}</td><td class="num">${fmtDate(c.mtime)}</td>
              <td><button class="btn small ghost" data-del="${esc(c.participant_id)}">Delete</button></td></tr>`).join("")}
          </table>` : `<div class="empty">No calibrations saved yet</div>`}
        </div>
      </div>`;

    el.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!confirm(`Delete calibration for ${btn.dataset.del}?`)) return;
      try { await api(`/calibrations/${encodeURIComponent(btn.dataset.del)}`, { method: "DELETE" }); toast("Deleted"); route(); }
      catch (e) { toast(e.message, true); }
    }));

    $("#cal-start").addEventListener("click", async () => {
      const pid = $("#cal-pid").value;
      if (!pid) return toast("Add a consented participant first", true);
      try {
        const st = await api("/calibration/start", { method: "POST", body: {
          participant_id: pid, source: $("#cal-source").value || null } });
        await runCalibrationSequence(st);
        route();
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ participants */
  async participants(el) {
    const rows = await api("/consent");
    el.innerHTML = `
      <h1>Participants &amp; consent</h1>
      <div class="sub">Capture refuses to start without a consent record. Keep signed forms separate from data.</div>
      <div class="grid c2">
        <div class="card">
          <div class="stat-label">Register consent</div>
          <label class="field mt"><span>Participant ID (pseudonym, e.g. P001)</span>
            <input type="text" id="con-pid" placeholder="P001"/></label>
          <label class="field"><span>Notes</span>
            <input type="text" id="con-notes" placeholder="signed paper form"/></label>
          <label class="check"><input type="checkbox" id="con-flag" checked/> Informed consent given (incl. camera / biometric-adjacent clause)</label>
          <button class="btn" id="con-add">Save</button>
        </div>
        <div class="card">
          <div class="stat-label">Consent records</div>
          ${rows.length ? `<table><tr><th>ID</th><th>Consented</th><th>Date</th><th>Notes</th></tr>
            ${rows.map((r) => `<tr><td>${esc(r.participant_id)}</td>
              <td>${/^(true|1|yes|y)$/i.test(r.consented || "") ? pill("yes", "good") : pill("no", "bad")}</td>
              <td class="num">${esc(r.consent_date || "—")}</td><td>${esc(r.notes || "")}</td></tr>`).join("")}
          </table>` : `<div class="empty">No records yet</div>`}
        </div>
      </div>`;
    $("#con-add").addEventListener("click", async () => {
      try {
        await api("/consent", { method: "POST", body: {
          participant_id: $("#con-pid").value.trim(),
          consented: $("#con-flag").checked,
          notes: $("#con-notes").value } });
        toast("Consent record saved"); route();
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ labels */
  async labels(el) {
    const [labels, sessions] = await Promise.all([api("/labels"), api("/sessions")]);
    const labelled = new Set(labels.map((l) => l.session_id));
    const unlabelled = sessions.filter((s) => !labelled.has(s.session_id));
    el.innerHTML = `
      <h1>Labels</h1>
      <div class="sub">Post-session self-report focus ratings — the ground truth for training (rating ≥ threshold → focused).</div>
      ${unlabelled.length ? `<div class="note">${unlabelled.length} captured session(s) still unlabelled:
        ${unlabelled.slice(0, 5).map((s) => `<code>${esc(s.session_id)}</code>`).join(", ")}${unlabelled.length > 5 ? "…" : ""}</div>` : ""}
      <div class="grid c2">
        <div class="card">
          <div class="stat-label">Add / update label</div>
          <label class="field mt"><span>Session</span>
            <select id="lab-sid">
              ${sessions.map((s) => `<option value="${esc(s.session_id)}" data-pid="${esc(s.participant_id)}" data-cohort="${esc(s.cohort)}">
                ${esc(s.session_id)}${labelled.has(s.session_id) ? " (labelled)" : ""}</option>`).join("")}
              <option value="__custom__">custom session id…</option>
            </select></label>
          <label class="field" id="lab-custom-wrap" style="display:none"><span>Custom session ID</span>
            <input type="text" id="lab-custom"/></label>
          <label class="field"><span>Focus rating (1 = very distracted … 5 = fully focused)</span>
            <select id="lab-rating"><option>1</option><option>2</option><option>3</option><option selected>4</option><option>5</option></select></label>
          <button class="btn" id="lab-add">Save label</button>
        </div>
        <div class="card">
          <div class="stat-label">Existing labels (${labels.length})</div>
          ${labels.length ? `<table><tr><th>Session</th><th>Participant</th><th>Cohort</th><th>Rating</th></tr>
            ${labels.map((l) => `<tr><td class="num">${esc(l.session_id)}</td><td>${esc(l.participant_id || "—")}</td>
              <td>${esc(l.cohort || "—")}</td><td>${pill(l.focus_rating, Number(l.focus_rating) >= 4 ? "good" : "warn")}</td></tr>`).join("")}
          </table>` : `<div class="empty">No labels yet</div>`}
        </div>
      </div>`;
    $("#lab-sid").addEventListener("change", () => {
      $("#lab-custom-wrap").style.display = $("#lab-sid").value === "__custom__" ? "block" : "none";
    });
    $("#lab-add").addEventListener("click", async () => {
      const sel = $("#lab-sid");
      const opt = sel.selectedOptions[0];
      const sid = sel.value === "__custom__" ? $("#lab-custom").value.trim() : sel.value;
      if (!sid) return toast("Session ID required", true);
      try {
        await api("/labels", { method: "POST", body: {
          session_id: sid,
          participant_id: opt?.dataset.pid || "",
          cohort: opt?.dataset.cohort || "",
          focus_rating: parseFloat($("#lab-rating").value) } });
        toast("Label saved"); route();
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ train & evaluate */
  async train(el) {
    const feats = await api("/features");
    el.innerHTML = `
      <h1>Train &amp; Evaluate</h1>
      <div class="sub">RF/XGBoost with Leave-N-Participants-Out CV. Every headline number is reported beside a majority-class baseline.</div>
      <div class="card">
        <div class="row">
          <label class="field" style="flex:1; margin-bottom:0"><span>Feature dataset</span>
            <select id="job-feat">
              <option value="">All real sessions (*_windows.parquet)</option>
              ${feats.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join("")}
            </select></label>
          <button class="btn" data-job="train">Train baseline</button>
          <button class="btn ghost" data-job="evaluate">Evaluate</button>
          <button class="btn ghost" data-job="ablation">Ablation</button>
          <button class="btn ghost" id="job-synth">Generate synthetic data</button>
        </div>
        <div id="job-status" class="mt"></div>
      </div>
      <div id="train-results"></div>`;

    const renderReports = async () => {
      const reports = await api("/reports");
      const box = $("#train-results");
      let html = "";

      const cv = reports.baseline_cv?.data;
      if (cv) {
        html += `<h2>Training — cross-validated results <span style="text-transform:none;letter-spacing:0">(${fmtDate(reports.baseline_cv.mtime)})</span></h2>
        <div class="card">
          <div class="stat-note" style="margin-bottom:12px">${cv.n_windows} windows · ${cv.n_participants} participants ·
            class balance: ${cv.class_balance?.focused ?? "?"} focused / ${cv.class_balance?.distracted ?? "?"} distracted</div>
          <table><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th><th>Majority acc.</th></tr>
          ${(cv.models || []).map((m) => `<tr>
            <td>${esc(m.model)}</td>
            <td class="num">${fmtMeanStd(m.accuracy_mean, m.accuracy_std)}</td>
            <td class="num">${fmtMeanStd(m.precision_mean, m.precision_std)}</td>
            <td class="num">${fmtMeanStd(m.recall_mean, m.recall_std)}</td>
            <td class="num">${fmtMeanStd(m.f1_mean, m.f1_std)}</td>
            <td class="num">${fmtMeanStd(m.roc_auc_mean, m.roc_auc_std)}</td>
            <td class="num">${fmtMeanStd(m.majority_baseline_accuracy_mean, m.majority_baseline_accuracy_std)}</td></tr>`).join("")}
          </table>
          <div class="note">${esc(cv.note || "")}</div>
          <details><summary>Per-fold detail</summary><div class="inner">
            ${(cv.models || []).map((m) => `<div class="stat-label mt">${esc(m.model)}</div><table>
              <tr><th>Fold</th><th>Acc</th><th>F1</th><th>n</th><th>Test participants</th><th>Majority acc</th></tr>
              ${(m.folds || []).map((f) => `<tr><td class="num">${f.fold}</td>
                <td class="num">${fmtNum(f.accuracy)}</td><td class="num">${fmtNum(f.f1)}</td>
                <td class="num">${f.n}</td><td class="num">${f.n_test_participants}</td>
                <td class="num">${fmtNum(f.majority_baseline_accuracy)}</td></tr>`).join("")}</table>`).join("")}
          </div></details>
        </div>`;
      }

      const ab = reports.ablation?.data;
      if (ab) {
        html += `<h2>Visual-contribution ablation ${ab.mocked_comp12 ? pill("mocked Comp 1/2", "warn") : pill("real Comp 1/2", "good")}</h2>
        <div class="card">
          ${(ab.settings || []).map((s) => barRow(
            s.setting.replaceAll("_", " "), s.f1_mean ?? 0,
            `F1 ${fmtMeanStd(s.f1_mean, s.f1_std)}`)).join("")}
          <div class="stat-note mt">Marginal F1 — visual → +behavioral: <b class="num">${fmtNum(ab.marginal_f1?.["visual_to_vis+beh"])}</b>
            · +behavioral → all three: <b class="num">${fmtNum(ab.marginal_f1?.["vis+beh_to_all"])}</b></div>
          <div class="note">Fusion: ${esc(ab.fusion || "")}</div>
        </div>`;
      }

      const ev = reports.evaluation?.data;
      if (ev) {
        html += `<h2>Evaluation report</h2>
        <div class="card">
          <div class="note">${esc(ev.end_to_end?.daisee_framing || "")}</div>
          <table><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>Majority acc.</th></tr>
          ${(ev.end_to_end?.models || []).map((m) => `<tr><td>${esc(m.model)}</td>
            <td class="num">${esc(m.accuracy || "—")}</td><td class="num">${esc(m.precision || "—")}</td>
            <td class="num">${esc(m.recall || "—")}</td><td class="num">${esc(m.f1 || "—")}</td>
            <td class="num">${esc(m.majority_baseline_accuracy || "—")}</td></tr>`).join("")}
          </table>
          <div class="note mt">Expression: ${esc(ev.expression?.caveat || "")}</div>
        </div>`;
      }

      box.innerHTML = html || `<div class="card mt"><div class="empty">No reports yet — run training first (generate synthetic data if you have no sessions).</div></div>`;
    };
    await renderReports();

    const watchJob = (job) => {
      $("#job-status").innerHTML = `<span class="spinner"></span> <b>${esc(job.kind)}</b> running…`;
      const timer = setInterval(async () => {
        try {
          const j = await api(`/jobs/${job.id}`);
          if (j.status === "done") {
            clearInterval(timer);
            $("#job-status").innerHTML = pill(`${j.kind} finished in ${Math.round((j.finished - j.started))}s`, "good");
            toast(`${j.kind} complete`);
            await renderReports();
          } else if (j.status === "error") {
            clearInterval(timer);
            $("#job-status").innerHTML = `${pill(`${j.kind} failed`, "bad")} <span class="stat-note">${esc(j.error)}</span>`;
            toast(j.error, true);
          }
        } catch (_) {}
      }, 1200);
      timers.push(timer);
    };

    el.querySelectorAll("[data-job]").forEach((btn) => btn.addEventListener("click", async () => {
      try {
        const job = await api("/jobs", { method: "POST", body: {
          kind: btn.dataset.job,
          params: $("#job-feat").value ? { features: $("#job-feat").value } : {} } });
        watchJob(job);
      } catch (e) { toast(e.message, true); }
    }));

    $("#job-synth").addEventListener("click", async () => {
      const n = prompt("Synthetic participants:", "20");
      if (!n) return;
      try {
        const job = await api("/jobs", { method: "POST", body: { kind: "synthetic", params: { n_participants: parseInt(n, 10) } } });
        watchJob(job);
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ benchmark */
  async benchmark(el) {
    const reports = await api("/reports");
    const b = reports.benchmark?.data;
    el.innerHTML = `
      <h1>Real-time benchmark</h1>
      <div class="sub">Times one full pass (frame → all extractors → windowing) to validate the 2–5 fps design before data collection.</div>
      <div class="card">
        <div class="row">
          <label class="field" style="margin-bottom:0"><span>Frames</span>
            <input type="number" id="bench-n" value="30" min="5" style="width:110px"/></label>
          <label class="check" style="margin:18px 0 0"><input type="checkbox" id="bench-yolo"/> Include YOLO phone detection</label>
          <label class="check" style="margin:18px 0 0"><input type="checkbox" id="bench-cam"/> Use real camera</label>
          <button class="btn" id="bench-run" style="margin-top:12px">Run benchmark</button>
        </div>
        <div id="bench-status" class="mt"></div>
      </div>
      <div id="bench-result">${b ? renderBench(b, reports.benchmark.mtime) : ""}</div>`;

    function renderBench(r, mtime) {
      return `<h2>Latest result <span style="text-transform:none;letter-spacing:0">(${fmtDate(mtime)})</span></h2>
      <div class="grid c3">
        <div class="card"><div class="stat-label">Max sustainable</div>
          <div class="stat-value">${fmtNum(r.max_sustainable_fps, 2)} fps</div>
          <div class="stat-note">target ${r.target_fps} fps ${r.meets_target ? pill("OK", "good") : pill("below", "warn")}</div></div>
        <div class="card"><div class="stat-label">Per-frame latency</div>
          <div class="stat-value">${fmtNum(r.mean_frame_ms, 0)} ms</div>
          <div class="stat-note">p95 ${fmtNum(r.p95_frame_ms, 0)} ms · windowing ${fmtNum(r.windowing_ms, 1)} ms</div></div>
        <div class="card"><div class="stat-label">Setup</div>
          <div class="stat-value" style="font-size:16px">${r.n_frames} frames</div>
          <div class="stat-note">${esc(r.source)} · ${r.stub_phone ? "YOLO excluded" : "YOLO included"}</div></div>
      </div>
      <div class="note">${esc(r.recommendation || "")}</div>`;
    }

    $("#bench-run").addEventListener("click", async () => {
      try {
        const job = await api("/jobs", { method: "POST", body: { kind: "benchmark", params: {
          n_frames: parseInt($("#bench-n").value, 10) || 30,
          load_yolo: $("#bench-yolo").checked,
          use_camera: $("#bench-cam").checked } } });
        $("#bench-status").innerHTML = `<span class="spinner"></span> benchmarking…`;
        const timer = setInterval(async () => {
          const j = await api(`/jobs/${job.id}`);
          if (j.status === "done") {
            clearInterval(timer);
            $("#bench-status").innerHTML = "";
            $("#bench-result").innerHTML = renderBench(j.result, j.finished);
            toast("Benchmark complete");
          } else if (j.status === "error") {
            clearInterval(timer);
            $("#bench-status").innerHTML = pill("failed", "bad") + ` <span class="stat-note">${esc(j.error)}</span>`;
          }
        }, 1200);
        timers.push(timer);
      } catch (e) { toast(e.message, true); }
    });
  },

  /* ------------------------------------------------ contract */
  async contract(el) {
    const [schema, cfg, sessions] = await Promise.all([api("/schema"), api("/config"), api("/sessions")]);
    el.innerHTML = `
      <h1>Integration contract</h1>
      <div class="sub">The per-window JSON record consumed by the Signal Semantics Resolver and Components 1/2/4.
      Validity ratios distinguish “no distraction” from “couldn’t tell”.</div>
      <div class="grid c2">
        <div class="card">
          <div class="stat-label">Window record JSON Schema</div>
          <pre class="json mt">${esc(JSON.stringify(schema, null, 2))}</pre>
        </div>
        <div>
          <div class="card">
            <div class="stat-label">Pipeline configuration (read-only)</div>
            <div class="kv"><span class="k">window size</span><b class="num">${cfg.windowing?.window_seconds}s</b></div>
            <div class="kv"><span class="k">target fps</span><b class="num">${cfg.capture?.target_fps}</b></div>
            <div class="kv"><span class="k">resolution</span><b class="num">${cfg.capture?.width}×${cfg.capture?.height}</b></div>
            <div class="kv"><span class="k">retain raw frames</span><b>${cfg.capture?.retain_frames ? "yes" : pill("no (privacy default)", "good")}</b></div>
            <div class="kv"><span class="k">expression signal</span><b>${cfg.expression?.enabled ? "enabled" : pill("disabled (lowest-confidence)", "neutral")}</b></div>
            <div class="kv"><span class="k">focus label threshold</span><b class="num">rating ≥ ${cfg.model?.focus_label_threshold}</b></div>
            <div class="kv"><span class="k">CV folds (LNPO)</span><b class="num">${cfg.model?.n_folds}</b></div>
            <div class="note mt">Edit <code>config/default.yaml</code> to change these; agree the window size with Components 1/2 before full collection.</div>
          </div>
          <div class="card mt">
            <div class="stat-label">Contract exports</div>
            ${sessions.length ? sessions.slice(0, 8).map((s) =>
              `<div class="kv"><span class="k num">${esc(s.session_id)}</span>
               <a class="btn small ghost" href="/api/sessions/${encodeURIComponent(s.session_id)}/download/contract">Download JSONL</a></div>`).join("")
            : `<div class="empty">No session exports yet</div>`}
          </div>
        </div>
      </div>`;
  },
};

/* ---------------- calibration overlay sequence ---------------- */

async function runCalibrationSequence(st) {
  const overlay = $("#cal-overlay");
  const dot = $("#cal-dot");
  const msg = $("#cal-msg");
  const bar = $("#cal-bar");
  overlay.classList.remove("hidden");
  let aborted = false;
  const onAbort = async () => {
    aborted = true;
    try { await api("/calibration/cancel", { method: "POST" }); } catch (_) {}
    overlay.classList.add("hidden");
    toast("Calibration cancelled");
  };
  $("#cal-abort").onclick = onAbort;
  try { await document.documentElement.requestFullscreen?.(); } catch (_) {}

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    msg.textContent = "Follow the dot with your eyes. Keep your head still.";
    dot.classList.add("hidden");
    await sleep(2200);
    for (let i = 0; i < st.steps.length; i++) {
      if (aborted) return;
      const step = st.steps[i];
      bar.style.width = `${(i / st.steps.length) * 100}%`;
      if (step.kind === "onscreen") {
        msg.textContent = "";
        dot.classList.remove("hidden");
        dot.style.left = `${step.x * 100}%`;
        dot.style.top = `${step.y * 100}%`;
        await sleep(700);
      } else {
        dot.classList.add("hidden");
        msg.textContent = `Now ${step.prompt} and hold…`;
        await sleep(1400);
      }
      if (aborted) return;
      const res = await api("/calibration/collect", { method: "POST", body: { step: i } });
      if (res.collected === 0) toast(`No valid samples for step ${i + 1} — check the face is visible`, true);
    }
    if (aborted) return;
    bar.style.width = "100%";
    msg.textContent = "Fitting model…";
    dot.classList.add("hidden");
    const result = await api("/calibration/finish", { method: "POST" });
    toast(`Calibration saved for ${result.participant_id} — ${result.n_samples} samples, ${(result.train_accuracy * 100).toFixed(1)}% fit accuracy`);
  } catch (e) {
    toast(e.message, true);
    try { await api("/calibration/cancel", { method: "POST" }); } catch (_) {}
  } finally {
    overlay.classList.add("hidden");
    try { await document.exitFullscreen?.(); } catch (_) {}
  }
}

/* ---------------- router ---------------- */

async function route() {
  clearPolls();
  const name = (location.hash.replace("#/", "") || "dashboard").split("?")[0];
  const view = views[name] || views.dashboard;
  document.querySelectorAll("#nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === name));
  const el = $("#view");
  el.innerHTML = `<div class="empty"><span class="spinner"></span> loading…</div>`;
  try { await view(el); }
  catch (e) { el.innerHTML = `<div class="card"><div class="note">Failed to load: ${esc(e.message)}</div></div>`; }
}

window.addEventListener("hashchange", route);
route();
