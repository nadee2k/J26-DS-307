'use strict';

/* FocusTrack Component 1 — Session Analyzer tab.
 * Uploads one session's behaviour events and renders the Component 1 output
 * (states, transitions, integration rows) produced by /api/session/analyze.
 *
 * Loaded after app.js: it registers its view into VIEWS and reuses the shared
 * render helpers (api, empty, tableHTML, kv, barChart, heatmap, timelineHTML).
 */

const sa = { ready: null, result: null, busy: false };

const saFormSource = () => {
  const select = $('#sa-source');
  return (select && select.value) || state.source;
};

const saTable = (columns, rows) => ({ exists: true, total: rows.length, columns, rows });

function saClear() {
  ['sa-timeline', 'sa-shares', 'sa-trans', 'sa-win-table', 'sa-sess-table']
    .forEach((id) => { $(`#${id}`).innerHTML = ''; });
  ['sa-dl-window', 'sa-dl-session'].forEach((id) => { $(`#${id}`).hidden = true; });
  $('#sa-summary').innerHTML = empty(
    'No analysis yet',
    "Upload one session's behaviour events and press Analyze session.",
  );
  $('#sa-bio').textContent = '';
  $('#sa-meta').textContent = '';
  $('#sa-win-note').textContent = '';
}

function saShowError(message) {
  const html = empty('Analysis failed', message);
  $('#sa-summary').innerHTML = html;
  ['sa-timeline', 'sa-shares', 'sa-trans', 'sa-win-table', 'sa-sess-table']
    .forEach((id) => { $(`#${id}`).innerHTML = ''; });
  ['sa-dl-window', 'sa-dl-session'].forEach((id) => { $(`#${id}`).hidden = true; });
  $('#sa-bio').textContent = message;
  $('#sa-meta').textContent = 'error';
}

/* ---------------- readiness ---------------- */

async function saRenderReady() {
  const source = saFormSource();
  const el = $('#sa-ready');
  try {
    const info = await api(`/api/session/analyze/ready?source=${source}`);
    sa.ready = info;
    el.innerHTML = info.ready
      ? `<div class="ok">✓ ${esc(info.message)}</div>
         <div class="caption">Models: <code>${esc(info.state_model.split('/').slice(-2).join('/'))}</code>
         · default window ${info.window_seconds}s
         ${info.finished_at ? `· last run ${esc(info.finished_at)}` : ''}</div>`
      : `<div class="bad">✗ ${esc(info.message)}</div>`;
    $('#sa-analyze').disabled = !info.ready;
    $('#sa-sample').href = `/api/session/sample?source=${source}`;
    return info;
  } catch (err) {
    sa.ready = null;
    $('#sa-analyze').disabled = true;
    el.innerHTML = `<div class="bad">✗ ${esc(err.message)}</div>`;
    return null;
  }
}

/* ---------------- results ---------------- */

function saRenderResult(result) {
  const m = result.meta;
  const s = result.session_summary;
  const v = result.validation;
  const problems = [...(v.window || []), ...(v.session || [])];

  $('#sa-meta').textContent =
    `${m.n_windows} windows · ${m.window_seconds}s each · ${m.n_events} events · ${m.duration_seconds}s`;

  $('#sa-summary').innerHTML = `
    <div class="cards">
      <div class="card"><div class="k">Dominant state</div><div class="v">state ${esc(s.dominant_state)}</div>
        <div class="s">${pct(s.dominant_share)} of windows</div></div>
      <div class="card"><div class="k">State entropy</div><div class="v">${fmt(s.state_entropy, 2)}</div>
        <div class="s">change rate ${fmt(s.state_change_rate, 2)}</div></div>
      <div class="card"><div class="k">Interruptions</div><div class="v">${fmt(s.interruption_count, 0)}</div>
        <div class="s">${fmt(s.recovery_count, 0)} recoveries</div></div>
      <div class="card"><div class="k">Session</div><div class="v">${fmt((s.session_duration_seconds || 0) / 60, 1)}<span style="font-size:14px"> min</span></div>
        <div class="s">${fmt(s.n_windows, 0)} windows</div></div>
    </div>
    ${kv([
      ['Participant', s.participant_id],
      ['Session', s.session_id],
      ['Context', `${s.context}${s.context_code === null || s.context_code === undefined ? '' : ` (code ${s.context_code})`}`],
      ['States observed', s.states_observed.join(', ')],
      ['State changes', `${fmt(s.n_transitions, 0)} in ${fmt(s.n_runs, 0)} runs (max ${fmt(s.max_run_length, 0)} windows)`],
      ['Mean state duration', `${fmt(s.mean_state_duration, 2)} windows`],
      ['Integration row', `interruptions ${fmt(s.row_interruption_count, 2)} · recoveries ${fmt(s.row_recovery_count, 2)} (mean per window)`],
      ['Models', `${m.model.state_method} · ${m.states} states`],
      ['Schema validation', problems.length === 0 ? '✓ valid' : `✗ ${esc(problems.join('; '))}`],
    ])}
    <div class="caption">Interruptions = state changes, recoveries = A→B→A returns (structural definition).
      The integration row exports the same measures averaged per window, as the batch pipeline does.</div>
    ${m.model.missing_feature_columns && m.model.missing_feature_columns.length
      ? `<div class="caption">⚠ Training columns absent from this upload were treated as 0: ${esc(m.model.missing_feature_columns.join(', '))}.</div>` : ''}`;

  $('#sa-timeline').innerHTML = timelineHTML(result.window_features)
    + `<div class="axis-note">Window ${fmt(result.timeline[0] && result.timeline[0].window_index, 0)}
        → ${fmt(result.timeline[result.timeline.length - 1] && result.timeline[result.timeline.length - 1].window_index, 0)}
        · ${esc(String(result.timeline[0] ? result.timeline[0].window_start : '—'))}
        → ${esc(String(result.timeline.length ? result.timeline[result.timeline.length - 1].window_start : '—'))}</div>`;

  $('#sa-shares').innerHTML = barChart({
    labels: result.state_shares.map((x) => `state ${x.state}`),
    series: [{ name: 'windows', values: result.state_shares.map((x) => x.windows) }],
    fmtY: (value) => Math.round(value),
  }) + `<div class="chips" style="margin-top:10px">${result.state_shares
    .map((x) => `<span class="chip">state ${x.state} · ${pct(x.share)}</span>`).join('')}</div>`;

  const t = result.transitions;
  $('#sa-trans').innerHTML = heatmap({
    rowLabels: t.labels, colLabels: t.labels, values: t.matrix, fmtV: (value) => value.toFixed(2),
  })
    + `<div class="axis-note">Row = current state, cell = P(to) within this session.</div>`
    + `<div class="table-wrap" style="margin-top:10px">${transCountsHTML(t.counts)}</div>`;

  const winRows = result.window_integration;
  const winCols = winRows.length ? Object.keys(winRows[0]) : [];
  $('#sa-win-note').textContent = result.window_integration_total
    ? `${result.window_integration_total} row${result.window_integration_total === 1 ? '' : 's'}`
    : (winRows.length ? `${winRows.length} rows` : '');
  $('#sa-win-table').innerHTML = winRows.length
    ? tableHTML(saTable(winCols, winRows), { max: 60 })
    : empty('No windows', 'This session produced no window rows.');

  const sessRow = result.session_integration || {};
  const sessCols = Object.keys(sessRow);
  $('#sa-sess-table').innerHTML = sessCols.length
    ? tableHTML(saTable(sessCols, [sessRow]), { max: 10, wrap: ['behavioural_summary'] })
    : empty('No session row', '');

  $('#sa-dl-session').href = result.download.session_csv;
  $('#sa-dl-session').hidden = false;
  $('#sa-dl-window').href = result.download.window_csv;
  $('#sa-dl-window').hidden = false;

  const windowSchema = (v.window || []).length === 0 ? 'OK' : (v.window || []).join('; ');
  const sessionSchema = (v.session || []).length === 0 ? 'OK' : (v.session || []).join('; ');
  $('#sa-bio').textContent = [
    `Session ${s.session_id} · participant ${s.participant_id} · context ${s.context}`,
    `Models: ${m.model.state_method} from ${m.model.state_model}`,
    `${m.n_events} events → ${m.n_windows} windows of ${m.window_seconds}s (${m.duration_seconds}s to analyse)`,
    `Integration schema: window ${windowSchema} · session ${sessionSchema}`,
    '',
    s.behavioural_summary,
  ].join('\n');
}

function transCountsHTML(rows) {
  if (!rows || !rows.length) {
    return '<div class="empty"><strong>No transitions</strong>Every window stayed in the same state.</div>';
  }
  const cols = ['from_state', 'to_state', 'count', 'probability'];
  const head = cols.map((c) => `<th class="${c === 'count' || c === 'probability' ? 'num' : ''}">${esc(c.replace(/_/g, ' '))}</th>`).join('');
  const body = rows.map((r) => cols.map((c) =>
    `<td class="${c === 'count' || c === 'probability' ? 'num' : ''}">${fmt(r[c], 2)}</td>`).join('')).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/* ---------------- view entry point ---------------- */

async function renderSessionAnalyzer() {
  await saRenderReady();
  if (sa.result) saRenderResult(sa.result);
  else saClear();
}

async function saSubmit(event) {
  event.preventDefault();
  if (sa.busy) return;
  const form = event.target;
  const button = $('#sa-analyze');
  sa.busy = true;
  button.disabled = true;
  button.textContent = 'Analyzing…';
  $('#sa-meta').textContent = 'running';
  try {
    const result = await api('/api/session/analyze', { method: 'POST', body: new FormData(form) });
    sa.result = result;
    saRenderResult(result);
  } catch (err) {
    sa.result = null;
    saShowError(err.message);
  } finally {
    sa.busy = false;
    button.textContent = 'Analyze session';
    button.disabled = !(sa.ready && sa.ready.ready);
  }
}

async function saInit() {
  const select = $('#sa-source');
  try {
    const sources = await api('/api/sources');
    select.innerHTML = sources
      .map((s) => `<option value="${esc(s.id)}" ${s.id === state.source ? 'selected' : ''}>${esc(s.label)}</option>`)
      .join('');
  } catch (_) {
    select.innerHTML = `<option value="${esc(state.source)}">${esc(state.source)}</option>`;
  }

  $('#sa-form').addEventListener('submit', saSubmit);
  select.addEventListener('change', () => { saRenderReady(); });
  if (state.tab === 'session-analyzer') saRenderReady();
}

/* Register the view before app.js's boot() runs on DOMContentLoaded. */
VIEWS['session-analyzer'] = renderSessionAnalyzer;
document.addEventListener('DOMContentLoaded', saInit);
