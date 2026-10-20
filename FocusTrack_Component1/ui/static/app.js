'use strict';

/* FocusTrack Component 1 — demo UI
 * Reads pipeline artifacts through the FastAPI layer and renders five views:
 * overview/run, states & transitions (SO4), context (SO5),
 * evaluation & statistics (SO6), integration output (M10).
 */

const PALETTE = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#f43f5e'];

const store = new Map();          // `${kind}:${source}:${name}` -> promise
const state = { source: 'real', tab: 'overview', sources: [], wasRunning: false, busy: false };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function fmt(v, d = 3) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(d);
  return esc(v);
}
const pct = (v, d = 1) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : '—');
const color = (i) => PALETTE[i % PALETTE.length];

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch (_) { /* ignore */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json();
}

function remember(kind, name, loader) {
  const key = `${kind}:${state.source}:${name}`;
  if (!store.has(key)) {
    store.set(key, loader().catch((err) => { store.delete(key); throw err; }));
  }
  return store.get(key);
}
const table = (name, limit = 5000) => remember('t', `${name}:${limit}`, () =>
  api(`/api/tables/${name}?source=${state.source}&limit=${limit}`));
const json = (name) => remember('j', name, () => api(`/api/json/${name}?source=${state.source}`));
const invalidate = (src) => { for (const key of [...store.keys()]) if (key.endsWith(`:${src}`) || key.includes(`:${src}:`)) store.delete(key); };

/* ---------------- shared render helpers ---------------- */

function empty(title, msg) {
  return `<div class="empty"><strong>${esc(title)}</strong>${esc(msg || '')}</div>`;
}

function tableHTML(t, opts = {}) {
  const max = opts.max || 60;
  if (!t || !t.exists) return empty('No results yet', 'Run the pipeline from the Overview tab to produce this artefact.');
  if (!t.total || !t.rows.length) return empty('No rows', 'This analysis produced no rows for the current data.');
  const numCols = new Set(t.columns.filter((c) => t.rows.some((r) => isNum(r[c]))));
  const wrapCols = new Set(opts.wrap || []);
  const hide = new Set(opts.hide || []);
  const cols = t.columns.filter((c) => !hide.has(c));
  const head = cols.map((c) => `<th class="${numCols.has(c) ? 'num' : ''} ${wrapCols.has(c) ? 'wrap' : ''}">${esc(c.replace(/_/g, ' '))}</th>`).join('');
  const body = t.rows.slice(0, max).map((r) => cols.map((c) => {
    const cls = [numCols.has(c) ? 'num' : '', wrapCols.has(c) ? 'wrap' : ''].filter(Boolean).join(' ');
    return `<td class="${cls}">${fmt(r[c], 3)}</td>`;
  }).join('')).join('');
  const note = t.total > max
    ? `<div class="table-note">Showing ${max} of ${t.total} rows.</div>`
    : `<div class="table-note">${t.total} row${t.total === 1 ? '' : 's'}.</div>`;
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${note}`;
}

function kv(pairs) {
  return `<div class="kv">${pairs.map(([k, v]) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`).join('')}</div>`;
}

function niceCeil(v) {
  if (!isNum(v) || v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * exp;
}

function short(s, n = 14) {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

/* Grouped (or single-series) vertical bar chart, as inline SVG. */
function barChart({ labels, series, height = 230, fmtY = (v) => fmt(v, 2), rotate = null }) {
  if (!labels.length) return empty('No data', '');
  const W = 680, H = height, pad = { l: 52, r: 12, t: 14, b: 56 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const all = series.flatMap((s) => s.values).filter(isNum);
  const max = niceCeil(Math.max(0, ...all)) || 1;
  const ticks = 4;
  const band = plotW / labels.length;
  const rotateX = rotate === null ? labels.length > 7 : rotate;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= ticks; i++) {
    const val = (max * i) / ticks;
    const y = pad.t + plotH * (1 - i / ticks);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef0f7" stroke-width="1"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8b90a8">${esc(fmtY(val))}</text>`;
  }
  const barW = Math.min(46, (band * 0.72) / series.length);
  labels.forEach((lab, i) => {
    const cx = pad.l + i * band + band / 2;
    series.forEach((s, si) => {
      const v = s.values[i];
      if (!isNum(v)) return;
      const h = Math.max(1, (v / max) * plotH);
      const x = cx - (series.length * barW) / 2 + si * barW;
      const y = pad.t + plotH - h;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color || color(si)}"><title>${esc(s.name)} · ${esc(lab)}: ${esc(fmtY(v))}</title></rect>`;
      if (series.length === 1 && labels.length <= 14) {
        svg += `<text x="${x + (barW - 2) / 2}" y="${y - 5}" text-anchor="middle" font-size="10" fill="#6b7089">${esc(fmtY(v))}</text>`;
      }
    });
    const label = esc(short(lab, rotateX ? 16 : 20));
    if (rotateX) {
      svg += `<text transform="translate(${cx - 2},${pad.t + plotH + 12}) rotate(-38)" font-size="10.5" fill="#6b7089">${label}</text>`;
    } else {
      svg += `<text x="${cx}" y="${pad.t + plotH + 18}" text-anchor="middle" font-size="11" fill="#6b7089">${label}</text>`;
    }
  });
  svg += `<line x1="${pad.l}" y1="${pad.t + plotH}" x2="${W - pad.r}" y2="${pad.t + plotH}" stroke="#d9dcea"/>`;
  svg += '</svg>';

  const legend = series.length > 1
    ? `<div class="legend">${series.map((s, i) => `<span><span class="swatch" style="background:${s.color || color(i)}"></span>${esc(s.name)}</span>`).join('')}</div>`
    : '';
  return `<div class="chart">${svg}</div>${legend}`;
}

/* Probability heatmap (transition matrices). */
function heatmap({ rowLabels, colLabels, values, fmtV = (v) => fmt(v, 2) }) {
  if (!rowLabels.length || !colLabels.length) return empty('No transitions', 'No state transitions were observed.');
  const max = Math.max(...values.flat().filter(isNum), 0) || 1;
  let html = `<div class="heat" style="grid-template-columns: 92px repeat(${colLabels.length}, minmax(42px,1fr))">`;
  html += '<div class="lbl"></div>';
  colLabels.forEach((c) => { html += `<div class="lbl top">${esc(c)}</div>`; });
  rowLabels.forEach((r, ri) => {
    html += `<div class="lbl">${esc(r)}</div>`;
    colLabels.forEach((c, ci) => {
      const v = values[ri][ci];
      const n = isNum(v) ? v : 0;
      const a = n <= 0 ? 0 : 0.12 + 0.88 * Math.min(1, Math.abs(n) / max);
      const bg = n <= 0 ? '#f4f5fa' : `rgba(79,70,229,${a.toFixed(3)})`;
      const fg = a > 0.55 ? '#fff' : '#14162b';
      html += `<div class="cell" style="background:${bg};color:${fg}" title="${esc(r)} → ${esc(c)}">${n <= 0 ? '·' : esc(fmtV(n))}</div>`;
    });
  });
  html += '</div>';
  return html;
}

/* Stacked 100% bars — state composition per context. */
function stackedBars({ groups, series }) {
  if (!groups.length) return empty('No data', '');
  const W = 680, H = 230, pad = { l: 44, r: 12, t: 14, b: 46 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const band = plotW / groups.length;
  const barW = Math.min(70, band * 0.6);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + plotH * (1 - i / 4);
    svg += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#eef0f7"/>`;
    svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8b90a8">${i * 25}%</text>`;
  }
  groups.forEach((g, gi) => {
    const x = pad.l + gi * band + (band - barW) / 2;
    let cursor = pad.t + plotH;
    series.forEach((s) => {
      const share = isNum(s.values[gi]) ? Math.max(0, s.values[gi]) : 0;
      const h = share * plotH;
      cursor -= h;
      if (h <= 0) return;
      svg += `<rect x="${x.toFixed(1)}" y="${cursor.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"><title>${esc(g)} · ${esc(s.name)}: ${pct(share)}</title></rect>`;
      if (h > 15) {
        svg += `<text x="${x + barW / 2}" y="${cursor + h / 2 + 4}" text-anchor="middle" font-size="10.5" fill="#fff" font-weight="600">${Math.round(share * 100)}%</text>`;
      }
    });
    svg += `<text x="${x + barW / 2}" y="${pad.t + plotH + 18}" text-anchor="middle" font-size="11" fill="#6b7089">${esc(short(g, 18))}</text>`;
  });
  svg += '</svg>';
  const legend = `<div class="legend">${series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>`;
  return `<div class="chart">${svg}</div>${legend}`;
}

/* Forest plot for paired statistics (delta + bootstrap CI). */
function forest(rows) {
  if (!rows.length) return empty('No statistics', 'Run the ML experiments to obtain paired comparisons.');
  const W = 680, pad = { l: 190, r: 60, t: 24, b: 34 }, rowH = 27;
  const H = pad.t + pad.b + rows.length * rowH;
  const lows = rows.map((r) => (isNum(r.ci_low) ? r.ci_low : 0));
  const highs = rows.map((r) => (isNum(r.ci_high) ? r.ci_high : 0));
  let lo = Math.min(0, ...lows), hi = Math.max(0, ...highs);
  if (hi - lo < 1e-9) { lo -= 0.1; hi += 0.1; }
  const span = hi - lo;
  lo -= span * 0.08; hi += span * 0.08;
  const x = (v) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  svg += `<line x1="${x(0)}" y1="${pad.t - 8}" x2="${x(0)}" y2="${H - pad.b + 4}" stroke="#b9bdd4" stroke-dasharray="4 4"/>`;
  svg += `<text x="${x(0)}" y="${H - pad.b + 20}" text-anchor="middle" font-size="10.5" fill="#8b90a8">no difference</text>`;
  rows.forEach((r, i) => {
    const y = pad.t + i * rowH + rowH / 2;
    const label = esc(short(`${r.target} · ${r.model}`, 30));
    svg += `<text x="${pad.l - 12}" y="${y + 4}" text-anchor="end" font-size="11.5" fill="#14162b">${label}</text>`;
    if (isNum(r.ci_low) && isNum(r.ci_high)) {
      svg += `<line x1="${x(r.ci_low)}" y1="${y}" x2="${x(r.ci_high)}" y2="${y}" stroke="#a5a7c5" stroke-width="5" stroke-linecap="round"><title>95% CI [${fmt(r.ci_low)}, ${fmt(r.ci_high)}]</title></line>`;
    }
    if (isNum(r.mean_delta)) {
      svg += `<circle cx="${x(r.mean_delta)}" cy="${y}" r="5.5" fill="#4f46e5"><title>${esc(r.target)}: Δ=${fmt(r.mean_delta)} (p=${fmt(r.p_wilcoxon, 4)})</title></circle>`;
    }
    svg += `<text x="${W - pad.r + 6}" y="${y + 4}" font-size="11" fill="#6b7089">${fmt(r.mean_delta, 2)}</text>`;
  });
  svg += '</svg>';
  return `<div class="chart">${svg}</div><div class="axis-note">Point = mean Macro-F1 difference against the baseline representation; bar = bootstrap 95% CI (right column shows Δ).</div>`;
}

/* Session state timeline from the window feature table. */
function timelineHTML(rows) {
  const usable = rows.filter((r) => isNum(r.interaction_state));
  if (!usable.length) return empty('No interaction states', 'Run the pipeline to discover interaction states.');
  const bySession = new Map();
  for (const r of usable) {
    const key = r.session_id;
    if (!bySession.has(key)) bySession.set(key, []);
    bySession.get(key).push(r);
  }
  const html = [...bySession.entries()].slice(0, 40).map(([sid, wins]) => {
    wins.sort((a, b) => (a.window_index || 0) - (b.window_index || 0));
    const segs = wins.map((w) => {
      const title = `window ${w.window_index} · state ${w.interaction_state} · ${w.transition_type || 'start'} · run ${fmt(w.state_duration, 1)} window(s)`;
      return `<span class="seg" style="background:${color(w.interaction_state)};flex:${Math.max(1, w.state_duration || 1)}" title="${esc(title)}"></span>`;
    }).join('');
    const ctx = wins[0].context ? ` (${wins[0].context})` : '';
    return `<div class="timeline-row"><span class="who" title="${esc(sid)}">${esc(sid.slice(0, 8))}${esc(ctx)}</span><span class="track">${segs}</span><span class="n">${wins.length}w</span></div>`;
  }).join('');
  const legend = `<div class="legend">${[...new Set(usable.map((r) => r.interaction_state))].sort((a, b) => a - b)
    .map((s) => `<span><span class="swatch" style="background:${color(s)}"></span>state ${s}</span>`).join('')}</div>`;
  return `<div class="axis-note">Rows are sessions (participant prefix + context); segments are consecutive windows, width ∝ run length.</div>${html}${legend}`;
}

/* Grouped split selector used by the evaluation charts. */
function withSplit(el, rows, draw) {
  if (!rows.length) { el.innerHTML = empty('No results', 'Run the pipeline with ML experiments enabled.'); return; }
  const splits = [...new Set(rows.map((r) => r.split).filter(Boolean))];
  if (splits.length < 2) { draw(el, splits[0] || null); return; }
  const pick = splits.includes('participant') ? 'participant' : splits[0];
  el.innerHTML = `<label class="inline">Split <select class="split-sel">${splits
    .map((s) => `<option value="${esc(s)}" ${s === pick ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label><div class="chart-slot"></div>`;
  const sel = el.querySelector('.split-sel');
  const run = () => draw(el.querySelector('.chart-slot'), sel.value);
  sel.addEventListener('change', run);
  run();
}

function summaryBars(el, t, labelFn) {
  if (!t || !t.exists || !t.rows.length) { el.innerHTML = empty('No results', 'This experiment produced no rows.'); return; }
  const labels = [...new Set(t.rows.map(labelFn))];
  const models = [...new Set(t.rows.map((r) => r.model))];
  const series = models.map((m, i) => ({
    name: m,
    color: color(i),
    values: labels.map((l) => {
      const row = t.rows.find((r) => labelFn(r) === l && r.model === m);
      return row ? row.macro_f1_mean : null;
    }),
  }));
  el.innerHTML = barChart({ labels, series, fmtY: (v) => v.toFixed(2) })
    + `<div class="axis-note">Macro-F1 (0–1), mean across folds.</div>`;
}

/* ---------------- views ---------------- */

/* Behaviour-inferred screen vs non-screen decision (Overview → analysis type). */
async function renderLearningType(force) {
  const el = {
    cards: $('#lt-cards'), table: $('#lt-table'), groups: $('#lt-groups'),
    score: $('#lt-score-chart'), method: $('#lt-method'), meta: $('#lt-meta'),
  };
  if (!force && el.cards.dataset.loaded) return;
  const clear = () => {
    el.table.innerHTML = ''; el.groups.innerHTML = '';
    el.score.innerHTML = ''; el.method.innerHTML = ''; el.meta.textContent = '';
  };
  el.cards.innerHTML = empty('Loading…', '');
  clear();
  try {
    const lt = await remember('lt', 'learning-type', () => api(`/api/analysis/learning-type?source=${state.source}`));
    if (!lt.ok) {
      el.cards.innerHTML = empty('Cannot decide learning type', lt.reason || 'Not available for this source.');
      return; // do not latch: a pipeline run should make this retry
    }
    const m = lt.meta;
    const screen = lt.participants.filter((p) => p.inferred_learning_type === 'screen');
    const other = lt.participants.filter((p) => p.inferred_learning_type !== 'screen');
    const ag = m.recorded_agreement;
    const cards = [
      ['Participants decided', m.n_participants, 'one row per user below'],
      ['Screen', screen.length, 'higher keyboard/mouse input volume'],
      ['Non-screen', other.length, 'lower input volume'],
      ['Recorded-label agreement', ag ? pct(ag.agreement_rate) : '—',
        ag ? `${ag.n_labelled} labelled users` : 'no recorded labels to compare'],
    ];
    el.cards.innerHTML = cards.map(([k, v, s]) =>
      `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');

    el.meta.textContent = `k=2 · silhouette ${isNum(m.silhouette) ? m.silhouette.toFixed(3) : '—'}`;

    const cols = [...new Set([
      'participant_id', 'inferred_learning_type', 'screen_score',
      ...(m.features_reported || m.features_used || []),
      'active_window_share', 'n_windows', 'n_sessions',
    ])];
    const rows = lt.participants.map((p) => ({ ...p, participant_id: short(p.participant_id, 10) }));
    el.table.innerHTML = tableHTML({ exists: true, total: rows.length, columns: cols, rows }, { max: 60 });

    el.score.innerHTML = lt.participants.length
      ? barChart({
        labels: lt.participants.map((p) => short(p.participant_id, 8)),
        series: [
          { name: 'screen', color: color(2), values: lt.participants.map((p) => (p.inferred_learning_type === 'screen' ? p.screen_score : null)) },
          { name: 'non-screen', color: color(3), values: lt.participants.map((p) => (p.inferred_learning_type !== 'screen' ? p.screen_score : null)) },
        ],
        fmtY: (v) => v.toFixed(2),
      }) + '<div class="axis-note">Score = projection onto the axis joining the two cluster centroids; bar colour = inferred group.</div>'
      : empty('No participants', '');

    const gScreen = lt.groups.find((g) => g.learning_type === 'screen') || { metrics: {}, participants: 0 };
    const gOther = lt.groups.find((g) => g.learning_type === 'non-screen') || { metrics: {}, participants: 0 };
    const metricKeys = (m.features_reported || []).concat(['active_window_share', 'n_windows', 'mean_screen_score']);
    const groupRows = metricKeys.map((k) => ({
      metric: k.replace(/_/g, ' '),
      screen: gScreen.metrics[k],
      'non-screen': gOther.metrics[k],
    })).concat([{ metric: 'participants', screen: gScreen.participants, 'non-screen': gOther.participants }]);
    el.groups.innerHTML = tableHTML(
      { exists: true, total: groupRows.length, columns: ['metric', 'screen', 'non-screen'], rows: groupRows },
      { max: 30 },
    );

    el.method.innerHTML = kv([
      ['Method', m.method],
      ['Orientation rule', m.orientation],
      ['Decision level', 'participant — all sessions of a user pooled'],
      ['Cluster features', (m.features_used || []).join(', ') || '—'],
      ['Reported metrics', (m.features_reported || []).join(', ') || '—'],
      ['Random state', m.random_state],
      ['Recorded-label agreement', ag ? `${pct(ag.agreement_rate)} over ${ag.n_labelled} labelled users` : '—'],
    ]) + `<div class="caption">Recorded <code>learning_type</code> labels are never used to fit or orient the clusters — they are only compared afterwards as a sanity check${ag ? `. ${esc(ag.note)}` : ''}. Disagreement can therefore be legitimate: in the synthetic source the recorded label is assigned randomly, so agreement ≈ chance is expected there.</div>`;
    el.cards.dataset.loaded = '1';
  } catch (err) {
    el.cards.innerHTML = empty('Could not load learning-type analysis', err.message);
    clear();
  }
}

async function renderOverview(force) {
  const sel = $('#ov-analysis');
  if (sel && !sel.dataset.bound) {
    sel.dataset.bound = '1';
    sel.addEventListener('change', () => {
      state.analysis = sel.value;
      renderOverview(true);
    });
  }
  const analysis = state.analysis || 'states';
  if (sel) sel.value = analysis;
  const showLearningType = analysis === 'learning-type';
  const panelStates = $('#ov-panel-states'), panelLtype = $('#ov-panel-ltype');
  if (panelStates) panelStates.hidden = showLearningType;
  if (panelLtype) panelLtype.hidden = !showLearningType;
  const hint = $('#ov-analysis-hint');
  if (hint) {
    hint.textContent = showLearningType
      ? 'Unsupervised k=2 split of participants on keyboard/mouse input volume — recorded labels are only compared afterwards.'
      : 'What the panels below show for the current source.';
  }
  if (showLearningType) { await renderLearningType(force); return; }

  const el = { cards: $('#ov-cards'), run: $('#ov-run'), quality: $('#ov-quality') };
  if (force || !el.cards.dataset.loaded) {
    el.cards.innerHTML = empty('Loading…', '');
    try {
      const ov = await api(`/api/overview?source=${state.source}`);
      const c = ov.counts;
      const cards = [
        ['Participants', c.participants, 'with behaviour logs'],
        ['Sessions', c.sessions, `${c.modelled_sessions} in the model dataset`],
        ['Behaviour events', c.events, '≈1 s snapshots'],
        ['Time windows', c.windows, `${(ov.run && ov.run.params && ov.run.params.window_seconds) || '—'} s each`],
        ['States', c.states, `${c.contexts} contexts`],
        ['Labelled sessions', c.labelled_sessions, 'self-reports'],
      ];
      el.cards.innerHTML = cards.map(([k, v, s]) => {
        const warn = k === 'Labelled sessions' && v < 10;
        return `<div class="card ${warn ? 'bad' : ''}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`;
      }).join('');

      const run = ov.run;
      const p = (run && run.params) || {};
      el.run.innerHTML = run
        ? kv([
          ['Finished at', run.finished_at || '—'],
          ['Duration', `${run.duration_seconds ?? '—'} s`],
          ['Window size', p.window_seconds !== undefined ? `${p.window_seconds} s` : '—'],
          ['Interaction states', p.n_states ?? '—'],
          ['Hidden regimes', p.n_hidden ?? '—'],
          ['ML experiments', p.run_ml === undefined ? '—' : (p.run_ml ? 'on' : 'off')],
          ['Events → windows', p.events !== undefined ? `${p.events} → ${p.windows}` : '—'],
          ['Labelled sessions', p.labelled_sessions ?? '—'],
        ]) + ((p.labelled_sessions ?? 99) < 10
          ? '<div class="caption">⚠ Few labelled sessions: supervised scores are not meaningful yet. The 15-minute self-report prompt in the collection UI must be submitted by the participant.</div>'
          : '')
        : empty('No run recorded yet', 'Artifacts exist but were written before run manifests, or the pipeline has not run for this source.');

      const q = ov.cluster_quality;
      el.quality.innerHTML = q
        ? `<div class="cards">${[
          ['Silhouette', q.silhouette.toFixed(3), isNum(q.silhouette) && q.silhouette > 0.5 ? 'good' : 'bad'],
          ['Davies-Bouldin', q.davies_bouldin.toFixed(3), isNum(q.davies_bouldin) && q.davies_bouldin < 1 ? 'good' : ''],
          ['Calinski-Harabasz', q.calinski_harabasz.toFixed(1), ''],
        ].map(([k, v, cls]) => `<div class="card ${cls}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
        <div class="caption">Higher silhouette and lower Davies-Bouldin indicate better-separated interaction states.</div>`
        : empty('No cluster quality recorded', '');
      el.cards.dataset.loaded = '1';
    } catch (err) {
      el.cards.innerHTML = empty('Could not load overview', err.message);
      el.run.innerHTML = '';
      el.quality.innerHTML = '';
    }
  }
}

async function renderStates() {
  const [features, profiles, trans, hmm, sess, byCtx] = await Promise.all([
    table('features'), table('state_profiles'), table('transition_probabilities'),
    table('hmm_hidden_transitions'), table('session_transitions'), table('transitions_by_context'),
  ]);

  const dist = {};
  features.rows.forEach((r) => { if (isNum(r.interaction_state)) dist[r.interaction_state] = (dist[r.interaction_state] || 0) + 1; });
  const distLabels = Object.keys(dist).sort((a, b) => a - b).map((s) => `state ${s}`);
  $('#chart-state-dist').innerHTML = barChart({
    labels: distLabels,
    series: [{ name: 'windows', values: Object.keys(dist).sort((a, b) => a - b).map((s) => dist[s]) }],
    fmtY: (v) => Math.round(v),
  });

  $('#tbl-state-profiles').innerHTML = tableHTML(profiles, { max: 20 });
  $('#chart-timeline').innerHTML = timelineHTML(features.rows);

  const toGrid = (t, fromCol, toCol, valCol) => {
    if (!t.exists || !t.rows.length) return null;
    const from = [...new Set(t.rows.map((r) => r[fromCol]))].sort((a, b) => a - b);
    const to = [...new Set(t.rows.map((r) => r[toCol]))].sort((a, b) => a - b);
    const values = from.map((f) => to.map((c) => {
      const row = t.rows.find((r) => r[fromCol] === f && r[toCol] === c);
      return row ? row[valCol] : null;
    }));
    return { rowLabels: from.map((f) => `state ${f}`), colLabels: to.map((c) => `state ${c}`), values };
  };

  /* Wide matrix (row label + one column per target) -> square grid. */
  const wideToGrid = (t, fromCol) => {
    if (!t.exists || !t.rows.length) return null;
    const colLabels = t.columns.filter((c) => c !== fromCol);
    if (!colLabels.length) return null;
    return {
      rowLabels: t.rows.map((r) => String(r[fromCol])),
      colLabels,
      values: t.rows.map((r) => colLabels.map((c) => r[c])),
    };
  };

  const grid = toGrid(trans, 'from_state', 'to_state', 'probability');
  $('#chart-transitions').innerHTML = grid
    ? heatmap({ ...grid, fmtV: (v) => v.toFixed(2) })
      + '<div class="axis-note">Row = current state, cell = P(to). Hover for exact probability.</div>'
    : empty('No transitions recorded', '');

  const hmmGrid = wideToGrid(hmm, 'from_hidden');
  $('#chart-hmm').innerHTML = hmmGrid
    ? heatmap({ ...hmmGrid, fmtV: (v) => v.toFixed(2) })
      + '<div class="axis-note">Baum-Welch transition matrix over hidden regimes (analysis only; never a model input).</div>'
    : empty('No HMM fitted', 'Sequences are required before the HMM can run.');

  $('#tbl-session-transitions').innerHTML = tableHTML(sess, { max: 100 });

  const select = $('#ctx-transition-select');
  const ctxRows = byCtx.rows || [];
  const contexts = [...new Set(ctxRows.map((r) => r.context).filter(Boolean))];
  const renderCtx = () => {
    const chosen = select.value;
    const sub = { ...byCtx, rows: ctxRows.filter((r) => r.context === chosen) };
    const g = toGrid(sub, 'from_state', 'to_state', 'probability');
    $('#chart-transitions-context').innerHTML = g
      ? heatmap({ ...g, fmtV: (v) => v.toFixed(2) })
      : empty('No transitions for this context', '');
  };
  if (contexts.length) {
    select.innerHTML = contexts.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    select.onchange = renderCtx;
    renderCtx();
  } else {
    select.innerHTML = '<option>—</option>';
    $('#chart-transitions-context').innerHTML = empty('No per-context transitions', '');
  }
}

async function renderContext() {
  const [features, analysis, agreement] = await Promise.all([
    table('features'), table('context_analysis'), table('context_agreement'),
  ]);

  const ctxCount = {};
  const comp = {}; // context -> state -> count
  features.rows.forEach((r) => {
    const c = r.context || 'unknown';
    ctxCount[c] = (ctxCount[c] || 0) + 1;
    if (isNum(r.interaction_state)) {
      comp[c] = comp[c] || {};
      comp[c][r.interaction_state] = (comp[c][r.interaction_state] || 0) + 1;
    }
  });
  const contexts = Object.keys(ctxCount).sort((a, b) => ctxCount[b] - ctxCount[a]);
  $('#chart-context-dist').innerHTML = barChart({
    labels: contexts,
    series: [{ name: 'windows', values: contexts.map((c) => ctxCount[c]) }],
    fmtY: (v) => Math.round(v),
  });

  const states = [...new Set(features.rows.map((r) => r.interaction_state).filter(isNum))].sort((a, b) => a - b);
  const series = states.map((s, i) => ({
    name: `state ${s}`,
    color: color(s),
    values: contexts.map((c) => {
      const total = Object.values(comp[c] || {}).reduce((a, b) => a + b, 0);
      return total ? (comp[c][s] || 0) / total : 0;
    }),
  }));
  $('#chart-context-state').innerHTML = contexts.length
    ? stackedBars({ groups: contexts, series })
    : empty('No context data', '');

  $('#tbl-context-analysis').innerHTML = tableHTML(analysis, { max: 50 });
  $('#tbl-context-agreement').innerHTML = tableHTML(agreement, { max: 50 });

  $('#context-note').innerHTML = `
    <div class="summ"><strong>Model features (label-free):</strong> <code>context_code</code> and
    <code>context × state</code> are computed from the observed context only, so they never touch the
    self-reported concentration label.</div>
    <div class="summ"><strong>Descriptive analysis:</strong> the context-effect table above uses the
    reference label to describe how contexts differ — it is reported, never fed to a model.</div>
    <div class="caption">This separation is what keeps the SO5 context results free of target leakage.</div>`;
}

async function renderEvaluation() {
  const [exp, seq, rep, stats, variation, partVar, ctxVar] = await Promise.all([
    table('experiment_summary'), table('sequential_summary'),
    table('state_representation_summary'), table('statistics_comparison'),
    table('statistics_variation'), table('participant_variation'), table('context_variation'),
  ]);

  const expEl = $('#chart-exp-summary');
  if (!exp.exists || !exp.rows.length) {
    expEl.innerHTML = empty('No experiment results',
      'Supervised evaluation needs labelled sessions. For the real source that means concentration self-reports; the synthetic source demonstrates the full analysis.');
  } else {
    withSplit(expEl, exp.rows, (slot, split) => {
      const rows = split ? exp.rows.filter((r) => r.split === split) : exp.rows;
      const reps = [...new Set(rows.map((r) => r.representation))];
      const models = [...new Set(rows.map((r) => r.model))];
      const series = models.map((m, i) => ({
        name: m, color: color(i),
        values: reps.map((rep) => {
          const row = rows.find((r) => r.representation === rep && r.model === m);
          return row ? row.macro_f1_mean : null;
        }),
      }));
      slot.innerHTML = barChart({ labels: reps, series, fmtY: (v) => v.toFixed(2) })
        + `<div class="axis-note">Ablation variants remove one feature block at a time; proposed = baseline + temporal + state + transition + context.</div>`;
    });
  }

  summaryBars($('#chart-seq-summary'), seq, (r) => r.representation);
  summaryBars($('#chart-state-rep'), rep, (r) => r.representation);

  const statRows = stats.rows.filter((r) => r.metric === 'macro_f1' && r.reference === 'baseline');
  $('#chart-stats').innerHTML = forest(statRows);
  $('#tbl-variation').innerHTML = tableHTML(variation, { max: 20 })
    || empty('No variation', '');
  const metric = (r) => ({
    group: undefined, id: undefined, n_sessions: r.n_sessions,
    macro_f1: r.macro_f1, balanced_accuracy: r.balanced_accuracy,
  });
  const lopo = {
    exists: partVar.exists || ctxVar.exists,
    total: (partVar.total || 0) + (ctxVar.total || 0),
    columns: ['group', 'id', 'n_sessions', 'macro_f1', 'balanced_accuracy'],
    rows: [
      ...partVar.rows.map((r) => ({ ...metric(r), group: 'participant', id: r.participant_id })),
      ...ctxVar.rows.map((r) => ({ ...metric(r), group: 'context', id: r.context })),
    ],
  };
  $('#tbl-lopo').innerHTML = tableHTML(lopo, { max: 60 });
}

async function renderIntegration() {
  const [validation, schema, session, win] = await Promise.all([
    json('integration_validation'), api('/api/schema'),
    table('behavioural_output_session'), table('behavioural_output_window'),
  ]);

  $('#schema-version').textContent = `schema v${schema.integration_version}`;
  const data = validation.data;
  const badge = (list) => (Array.isArray(list) && list.length === 0)
    ? '<span class="ok-badge">✓ valid</span>'
    : `<span class="bad-badge">✗ ${Array.isArray(list) ? esc(list.join('; ')) : 'unknown'}</span>`;
  $('#integration-validation').innerHTML = data
    ? `<div class="kv">
         <span class="k">Window stream</span><span class="v">${badge(data.window)}</span>
         <span class="k">Session summary</span><span class="v">${badge(data.session)}</span>
       </div>
       <div class="caption">Validated at the end of every pipeline run; a violation is reported instead of a silent schema break.</div>`
    : empty('No validation recorded', 'Run the pipeline to validate the export schemas.');

  $('#schema-fields').innerHTML = `
    <div class="caption">Session-level (${schema.session.length} fields)</div>
    <div class="chips">${schema.session.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
    <div class="caption" style="margin-top:12px">Window-level (${schema.window.length} fields)</div>
    <div class="chips">${schema.window.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>`;

  $('#tbl-integration-session').innerHTML = session.exists
    ? tableHTML(session, { max: 50, wrap: ['behavioural_summary'] })
    : empty('No session output', 'Run the pipeline to build the behavioural output contract.');
  $('#tbl-integration-window').innerHTML = tableHTML(win, { max: 100 });
}

const VIEWS = {
  overview: renderOverview,
  states: renderStates,
  context: renderContext,
  evaluation: renderEvaluation,
  integration: renderIntegration,
};

async function renderTab(tab, force = false) {
  if (state.busy) { state.pending = { tab, force: true }; return; }
  state.busy = true;
  try {
    await VIEWS[tab](force);
  } catch (err) {
    const section = $(`#tab-${tab}`);
    if (section) {
      section.querySelectorAll('.body, .cards').forEach((el) => {
        el.innerHTML = empty('Could not load this view', err.message);
      });
    }
  } finally {
    state.busy = false;
    if (state.pending) {
      const next = state.pending;
      state.pending = null;
      renderTab(next.tab, next.force);
    }
  }
}

/* ---------------- source / tabs / run control ---------------- */

function applySourceUI() {
  const synthetic = state.source === 'synthetic';
  $('#synth-opts').hidden = !synthetic;
  $('#opt-export').style.display = synthetic ? 'none' : '';
  const note = $('#source-note');
  note.hidden = false;
  note.className = synthetic ? 'banner' : 'banner info';
  note.textContent = synthetic
    ? 'Synthetic demo data — generated by src/simulation.py so the full analysis can be shown before pilot collection finishes. These results must not be used in the report.'
    : 'Live pilot tables from Supabase. Supervised evaluation needs more concentration self-reports — currently only a handful of sessions are labelled.';
  $$('#source-switch button').forEach((b) => b.classList.toggle('active', b.dataset.source === state.source));
}

function switchSource(source) {
  if (source === state.source) return;
  state.source = source;
  applySourceUI();
  renderTab(state.tab, true);
}

function switchTab(tab) {
  state.tab = tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  if (window.history && window.history.replaceState) window.history.replaceState(null, '', `#${tab}`);
  renderTab(tab);
}

function updateStatus(s) {
  const dot = $('#status-dot'), text = $('#status-text');
  dot.className = 'dot';
  if (s.running) {
    dot.classList.add('running');
    text.textContent = `running · ${s.stage}`;
  } else if (s.stage === 'failed') {
    dot.classList.add('failed');
    text.textContent = 'failed';
  } else if (s.stage === 'done') {
    dot.classList.add('done');
    text.textContent = `done${s.duration_seconds ? ` · ${s.duration_seconds}s` : ''}`;
  } else {
    text.textContent = 'idle';
  }

  const log = $('#run-log');
  if (s.log && s.log.length) {
    log.hidden = false;
    log.textContent = s.log.join('\n');
    log.scrollTop = log.scrollHeight;
  }

  if (state.wasRunning && !s.running) {
    invalidate(s.source || state.source);
    const ov = $('#ov-cards');
    if (ov) delete ov.dataset.loaded;
    const lt = $('#lt-cards');
    if (lt) delete lt.dataset.loaded;
    renderTab(state.tab, true);
    setRunEnabled(true);
  }
  state.wasRunning = s.running;
}

function setRunEnabled(enabled) {
  const btn = $('#run-btn');
  btn.disabled = !enabled;
  btn.textContent = enabled ? 'Run pipeline' : 'Running…';
}

async function pollStatus() {
  try { updateStatus(await api('/api/status')); } catch (_) { /* server restarting */ }
  setTimeout(pollStatus, 1800);
}

async function startRun() {
  const form = $('#run-form');
  const get = (name) => form.elements[name] ? form.elements[name].value : null;
  const checked = (name) => Boolean(form.elements[name] && form.elements[name].checked);
  const body = {
    source: state.source,
    window_seconds: Number(get('window_seconds')),
    n_states: Number(get('n_states')),
    n_hidden: Number(get('n_hidden')),
    run_ml: checked('run_ml'),
    run_hmm: checked('run_hmm'),
    export: checked('export'),
    participants: Number(get('participants')) || 15,
    sessions_per_participant: Number(get('sessions_per_participant')) || 3,
    duration_seconds: Number(get('duration_seconds')) || 600,
  };
  try {
    const res = await api('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    state.wasRunning = true;
    setRunEnabled(false);
    updateStatus(res);
  } catch (err) {
    $('#run-log').hidden = false;
    $('#run-log').textContent = `Could not start run: ${err.message}`;
  }
}

async function boot() {
  applySourceUI();
  try {
    state.sources = await api('/api/sources');
    const readyReal = state.sources.find((s) => s.id === 'real');
    const readySynth = state.sources.find((s) => s.id === 'synthetic');
    if (readyReal && readyReal.ready) state.source = 'real';
    else if (readySynth && readySynth.ready) state.source = 'synthetic';
    applySourceUI();
  } catch (_) { /* keep default */ }

  $('#source-switch').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (btn) switchSource(btn.dataset.source);
  });
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) switchTab(btn.dataset.tab);
  });
  $('#run-btn').addEventListener('click', startRun);

  // Deep links: /#states, /#evaluation, ... (handy when sharing a demo URL)
  window.addEventListener('hashchange', () => {
    const tab = window.location.hash.replace('#', '');
    if (VIEWS[tab] && tab !== state.tab) switchTab(tab);
  });
  const initial = window.location.hash.replace('#', '');
  if (VIEWS[initial] && initial !== 'overview') switchTab(initial);
  else renderTab('overview', true);
  pollStatus();
}

document.addEventListener('DOMContentLoaded', boot);
