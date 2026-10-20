'use strict';

/* FocusTrack Component 1 — standalone "focus dashboard".
 *
 * Read-only trends across past sessions, built from the trained models' outputs
 * (GET /api/focus?source=). Only Component 1 data is used: behaviour-derived
 * interaction states, their transitions and the HMM regime, plus self-reported
 * concentration. No environment or vision data.
 */

const PALETTE = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#f43f5e'];
const MAX_STRIPS = 25;

const state = { source: 'real', data: null };

const $ = (sel) => document.querySelector(sel);

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const color = (i) => PALETTE[Math.abs(Number(i) || 0) % PALETTE.length];

function fmt(v, d = 2) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(d);
  return esc(v);
}
const pct = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : '—');

function short(s, n = 16) {
  const str = String(s === null || s === undefined ? '' : s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function niceCeil(v) {
  if (!isNum(v) || v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_) { /* ignore */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

const empty = (title, msg) => `<div class="empty"><strong>${esc(title)}</strong>${esc(msg || '')}</div>`;

/* ---------------- charts (inline SVG, matching the analysis app) ---------------- */

function barChart({ labels, series, height = 240, fmtY = (v) => fmt(v, 2) }) {
  if (!labels.length) return empty('No data', '');
  const W = 900, H = height, pad = { l: 52, r: 12, t: 16, b: 62 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter(isNum);
  const max = niceCeil(Math.max(0, ...all)) || 1;
  const band = plotW / labels.length;
  const rotate = labels.length > 7;
  const multi = series.length > 1;
  const barW = Math.min(46, (band * 0.72) / series.length);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH * (1 - i / 4);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef0f7"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8b90a8">${esc(fmtY((max * i) / 4))}</text>`;
  }
  labels.forEach((lab, i) => {
    const cx = pad.l + i * band + band / 2;
    series.forEach((s, si) => {
      const v = s.values[i];
      if (!isNum(v)) return;
      const h = Math.max(1, (v / max) * plotH);
      const x = cx - (series.length * barW) / 2 + si * barW;
      const y = pad.t + plotH - h;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color || color(si)}"><title>${esc(s.name || '')} ${esc(lab)}: ${esc(fmtY(v))}</title></rect>`;
      if (!multi && labels.length <= 16) {
        svg += `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10" fill="#6b7089">${esc(fmtY(v))}</text>`;
      }
    });
    const label = esc(short(lab, rotate ? 16 : 22));
    if (rotate) {
      svg += `<text transform="translate(${(cx - 2).toFixed(1)},${pad.t + plotH + 12}) rotate(-38)" font-size="10.5" fill="#6b7089">${label}</text>`;
    } else {
      svg += `<text x="${cx.toFixed(1)}" y="${pad.t + plotH + 18}" text-anchor="middle" font-size="11" fill="#6b7089">${label}</text>`;
    }
  });
  svg += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#d9dcea"/></svg>`;

  const legend = multi
    ? `<div class="legend">${series.map((s, i) => `<span><span class="swatch" style="background:${s.color || color(i)}"></span>${esc(s.name)}</span>`).join('')}</div>`
    : '';
  return `<div class="chart">${svg}</div>${legend}`;
}

function stackedBars({ groups, series, height = 240 }) {
  if (!groups.length) return empty('No data', '');
  const W = 900, H = height, pad = { l: 44, r: 12, t: 16, b: 62 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const band = plotW / groups.length;
  const barW = Math.min(70, band * 0.62);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH * (1 - i / 4);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef0f7"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8b90a8">${i * 25}%</text>`;
  }
  const rotate = groups.length > 7;
  groups.forEach((g, gi) => {
    const x = pad.l + gi * band + (band - barW) / 2;
    let cursor = pad.t + plotH;
    series.forEach((s) => {
      const share = isNum(s.values[gi]) ? Math.max(0, s.values[gi]) : 0;
      const h = share * plotH;
      cursor -= h;
      if (h <= 0) return;
      svg += `<rect x="${x.toFixed(1)}" y="${cursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"><title>${esc(g)} · ${esc(s.title || s.name)}: ${pct(share)}</title></rect>`;
      if (h > 16) {
        svg += `<text x="${(x + barW / 2).toFixed(1)}" y="${(cursor + h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">${Math.round(share * 100)}%</text>`;
      }
    });
    const cx = x + barW / 2;
    if (rotate) {
      svg += `<text transform="translate(${(cx - 2).toFixed(1)},${pad.t + plotH + 12}) rotate(-38)" font-size="10.5" fill="#6b7089">${esc(short(g, 16))}</text>`;
    } else {
      svg += `<text x="${cx.toFixed(1)}" y="${pad.t + plotH + 18}" text-anchor="middle" font-size="11" fill="#6b7089">${esc(short(g, 22))}</text>`;
    }
  });
  svg += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#d9dcea"/></svg>`;
  const legend = `<div class="legend">${series.map((s) => `<span title="${esc(s.title || s.name)}"><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`;
  return `<div class="chart">${svg}</div>${legend}`;
}

function scatter({ points, xLabel, yLabel }) {
  if (!points.length) return empty('No concentration data', 'No past session has a self-reported concentration rating yet.');
  const W = 900, H = 260, pad = { l: 58, r: 20, t: 18, b: 48 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(1, ...xs), xMax = Math.max(5, ...xs);
  const yMax = Math.max(1, ...ys);
  const px = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const py = (v) => pad.t + plotH - (v / yMax) * plotH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH * (1 - i / 4);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef0f7"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8b90a8">${esc(fmt((yMax * i) / 4))}</text>`;
  }
  for (let v = Math.ceil(xMin); v <= Math.floor(xMax); v++) {
    svg += `<line x1="${px(v).toFixed(1)}" y1="${pad.t}" x2="${px(v).toFixed(1)}" y2="${pad.t + plotH}" stroke="#f3f4fa"/>`;
    svg += `<text x="${px(v).toFixed(1)}" y="${pad.t + plotH + 18}" text-anchor="middle" font-size="11" fill="#6b7089">${v}</text>`;
  }
  points.forEach((p) => {
    svg += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="6" fill="${color(p.state)}" fill-opacity="0.85" stroke="#fff" stroke-width="1.5"><title>${esc(p.label)}</title></circle>`;
  });
  svg += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#d9dcea"/></svg>`;
  return `<div class="chart">${svg}</div><div class="axis-note">${esc(xLabel)} (x) · ${esc(yLabel)} (y). ${points.length} session${points.length === 1 ? '' : 's'} with a rating.</div>`;
}

function strips(sessions, statesMeta) {
  const desk = new Map((statesMeta || []).map((s) => [s.state, s.descriptor]));
  const usable = sessions.filter((s) => s.sequence && s.sequence.length).slice(-MAX_STRIPS);
  if (!usable.length) return empty('No interaction states', 'Run the pipeline to discover interaction states.');
  const rows = usable.map((s) => {
    const runs = [];
    let prev = null;
    for (const st of s.sequence) {
      if (st !== prev) { runs.push({ state: st, len: 1 }); prev = st; } else { runs[runs.length - 1].len += 1; }
    }
    const segs = runs.map((r) => `<span class="seg" style="background:${color(r.state)};flex:${Math.max(1, r.len)}" title="state ${r.state} · ${r.len} window(s)"></span>`).join('');
    const label = `${fmtDate(s.startedAt)} ${s.context || ''}`;
    return `<div class="timeline-row"><span class="who" title="${esc(s.sessionId)}">${esc(label)}</span><span class="track">${segs}</span><span class="n">${s.nWindows}w</span></div>`;
  }).join('');
  const legend = `<div class="legend">${(statesMeta || []).map((s) => `<span title="${esc(s.descriptor)}"><span class="swatch" style="background:${color(s.state)}"></span>state ${s.state}: ${esc(short(s.descriptor, 38))}</span>`).join('')}</div>`;
  const note = sessions.length > usable.length
    ? `<div class="axis-note">Showing the most recent ${usable.length} of ${sessions.length} sessions.</div>`
    : '';
  return `${note}${rows}${legend}`;
}

/* ---------------- renderers ---------------- */

function sessionLabel(s) {
  return `${fmtDate(s.startedAt)} ${s.context || ''}`.trim();
}

function renderKpis(d) {
  const t = d.totals;
  const cards = [
    ['Sessions analysed', fmt(t.sessions, 0), t.contexts.length ? t.contexts.join(', ') : '—'],
    ['Participants', fmt(t.participants, 0), `${t.windows} windows`],
    ['Avg stability', fmt(t.avgStability, 2), 'windows per stable run'],
    ['Pattern consistency', pct(t.avgDominantShare, 0), 'avg dominant-state share'],
    ['Interruptions', fmt(t.totalInterruptions, 0), `${t.totalRecoveries} recoveries`],
    ['Concentration', `${t.withConcentration}/${t.sessions}`, 'sessions with a rating'],
  ];
  $('#kpis').innerHTML = cards.map(([k, v, s]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
}

function renderStability(d) {
  const sessions = d.sessions;
  $('#stability').innerHTML = sessions.length
    ? barChart({
        labels: sessions.map(sessionLabel),
        series: [{ name: 'Mean run length', values: sessions.map((s) => s.meanRunLength), color: PALETTE[0] }],
        fmtY: (v) => fmt(v, 1),
      })
    : empty('No sessions', 'Run the pipeline from the Overview tab to analyse sessions.');
}

function renderComposition(d) {
  const sessions = d.sessions;
  if (!sessions.length) { $('#composition').innerHTML = empty('No sessions', ''); return; }
  const series = (d.states || []).map((meta) => ({
    name: `state ${meta.state}`,
    title: meta.descriptor,
    color: color(meta.state),
    values: sessions.map((s) => {
      const entry = (s.stateShares || []).find((x) => x.state === meta.state);
      return entry ? entry.share : 0;
    }),
  }));
  $('#composition').innerHTML = stackedBars({ groups: sessions.map(sessionLabel), series });
}

function renderInterruptions(d) {
  const sessions = d.sessions;
  $('#interruptions').innerHTML = sessions.length
    ? barChart({
        labels: sessions.map(sessionLabel),
        series: [
          { name: 'Interruptions', values: sessions.map((s) => s.interruptions), color: PALETTE[3] },
          { name: 'Recoveries', values: sessions.map((s) => s.recoveries), color: PALETTE[2] },
        ],
        fmtY: (v) => fmt(v, 0),
      })
    : empty('No sessions', '');
}

function renderConcentration(d) {
  const points = d.sessions
    .filter((s) => isNum(s.concentrationMean) && isNum(s.dominantShare))
    .map((s) => ({
      x: s.concentrationMean,
      y: s.dominantShare,
      state: s.dominantState,
      label: `${fmtDate(s.startedAt)} ${s.context || ''} · focus ${fmt(s.concentrationMean, 0)}/5 · dominant share ${pct(s.dominantShare)} · stability ${fmt(s.meanRunLength, 2)}`,
    }));
  $('#concentration').innerHTML = scatter({
    points,
    xLabel: 'self-reported concentration (1–5)',
    yLabel: 'dominant-state share',
  });
}

function renderStrips(d) {
  $('#strips').innerHTML = strips(d.sessions, d.states);
}

function renderTable(d) {
  const sessions = d.sessions;
  if (!sessions.length) { $('#table').innerHTML = empty('No sessions', 'Run the pipeline to produce per-session results.'); return; }
  const head = ['Date', 'Participant', 'Context', 'Windows', 'Dominant state', 'Share', 'Stability', 'Interrupt.', 'Recover.', 'Transitions', 'Regime', 'Concentration'];
  const rows = sessions.slice().reverse().map((s) => {
    const concentration = isNum(s.concentrationMean)
      ? `${fmt(s.concentrationMean, 0)}/5${isNum(s.nRatings) ? ` (n=${s.nRatings})` : ''}`
      : '—';
    const cells = [
      `<td>${esc(fmtDateTime(s.startedAt))}</td>`,
      `<td>${esc(short(s.participantId, 8))}</td>`,
      `<td>${esc(s.context || '—')}</td>`,
      `<td class="num">${esc(fmt(s.nWindows, 0))}</td>`,
      `<td title="${esc(s.dominantDescriptor || '')}">state ${esc(fmt(s.dominantState, 0))}</td>`,
      `<td class="num">${esc(pct(s.dominantShare))}</td>`,
      `<td class="num">${esc(fmt(s.meanRunLength, 2))}</td>`,
      `<td class="num">${esc(fmt(s.interruptions, 0))}</td>`,
      `<td class="num">${esc(fmt(s.recoveries, 0))}</td>`,
      `<td class="num">${esc(fmt(s.nTransitions, 0))}</td>`,
      `<td>${isNum(s.hmmRegime) ? `regime ${s.hmmRegime}` : '—'}</td>`,
      `<td class="num">${esc(concentration)}</td>`,
    ];
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
  const note = `<div class="table-note">${sessions.length} session${sessions.length === 1 ? '' : 's'}, newest first. “Dominant state” is the interaction state the model assigned most often.</div>`;
  $('#table').innerHTML = `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>${note}`;
}

function render(d) {
  state.data = d;
  document.title = `FocusTrack · Focus dashboard (${d.label})`;
  $('#scope').textContent = d.label;
  $('#generated').textContent = `Updated ${fmtDateTime(d.generatedAt)} · ${d.nStates} interaction states`;
  const note = $('#source-note');
  if (d.synthetic) {
    note.hidden = false;
    note.textContent = 'Synthetic demo data — results are for demonstration only and must not be used in the report.';
  } else {
    note.hidden = true;
  }
  renderKpis(d);
  renderStability(d);
  renderComposition(d);
  renderInterruptions(d);
  renderConcentration(d);
  renderStrips(d);
  renderTable(d);
  $('#notes').innerHTML = (d.notes || []).map((n) => `<div class="banner info" style="margin:0 0 14px">${esc(n)}</div>`).join('');
}

async function load() {
  $('#generated').textContent = 'Loading…';
  try {
    const data = await api(`/api/focus?source=${encodeURIComponent(state.source)}`);
    render(data);
  } catch (err) {
    $('#generated').textContent = 'Failed to load';
    const msg = err && err.message ? err.message : 'Could not load the dashboard.';
    ['#kpis', '#stability', '#composition', '#interruptions', '#concentration', '#strips', '#table'].forEach((sel) => {
      $(sel).innerHTML = empty('Could not load', msg);
    });
  }
}

function switchSource(source) {
  state.source = source;
  document.querySelectorAll('#source-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === source);
  });
  load();
}

async function boot() {
  document.querySelectorAll('#source-switch button').forEach((button) => {
    button.addEventListener('click', () => switchSource(button.dataset.source));
  });
  $('#refresh').addEventListener('click', load);

  try {
    const sources = await api('/api/sources');
    const real = sources.find((s) => s.id === 'real');
    if (real && !real.ready) switchSource('synthetic');
    else load();
  } catch (_) {
    load();
  }
}

boot();
