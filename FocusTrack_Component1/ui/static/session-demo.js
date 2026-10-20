'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const sourceSelect = $('#demo-source');
  const notice = $('#demo-notice');
  const sessionStatus = $('#session-status');
  const startButton = $('#start-session');
  const endButton = $('#end-session');
  const sampleButton = $('#sample-session');
  const outcomeSection = $('#outcome-section');
  const outcomeContent = $('#outcome-content');
  const CLEAR_PALETTE = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#a855f7', '#84cc16', '#f43f5e'];

  const state = {
    sources: [],
    ready: null,
    running: false,
    sessionId: null,
    participantId: null,
    context: null,
    source: null,
    startedAt: 0,
    lastActivityAt: 0,
    lastSnapshotAt: 0,
    keyCount: 0,
    clickCount: 0,
    mouseDistance: 0,
    snapshots: [],
    timer: null,
    elapsedTimer: null,
  };

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).detail || ''; } catch (_) { /* response may not be JSON */ }
      throw new Error(detail || `Request failed (${response.status})`);
    }
    return response.json();
  }

  function setNotice(message, type = '') {
    notice.textContent = message;
    notice.className = `demo-notice${type ? ` ${type}` : ''}`;
  }

  function setSessionStatus(message, type = '') {
    sessionStatus.textContent = message;
    sessionStatus.className = `demo-notice${type ? ` ${type}` : ''}`;
  }

  function setButtons() {
    const modelReady = Boolean(state.ready && state.ready.ready);
    startButton.disabled = !modelReady || state.running;
    sampleButton.disabled = !modelReady || state.running;
    endButton.disabled = !state.running;
    sourceSelect.disabled = state.running;
    $('#demo-context').disabled = state.running;
    $('#demo-participant').disabled = state.running;
  }

  async function loadSources() {
    try {
      state.sources = await api('/api/sources');
      sourceSelect.innerHTML = state.sources.map((source) =>
        `<option value="${esc(source.id)}">${esc(source.label)}${source.synthetic ? ' · demo data' : ''}</option>`
      ).join('');
      const defaultSource = state.sources.find((source) => source.id === 'synthetic')
        || state.sources.find((source) => source.ready)
        || state.sources[0];
      if (defaultSource) sourceSelect.value = defaultSource.id;
      await checkReadiness();
    } catch (error) {
      setNotice(`Could not load Component 1 sources: ${error.message}`, 'error');
      $('#model-status').textContent = 'Unavailable';
      $('#model-dot').className = 'dot failed';
    }
  }

  async function checkReadiness() {
    const source = sourceSelect.value;
    if (!source) return;
    state.source = source;
    try {
      state.ready = await api(`/api/live/ready?source=${encodeURIComponent(source)}`);
      const dot = $('#model-dot');
      const status = $('#model-status');
      if (state.ready.ready) {
        dot.className = 'dot done';
        status.textContent = `${state.ready.n_states || '?'}-state model ready`;
        $('#window-size').textContent = `${state.ready.window_seconds || 60}s`;
        setNotice(`${state.ready.message} ${state.ready.hmm_model && state.ready.hmm_model.available ? 'HMM regime model is also available.' : 'No HMM model is available; interaction-state outcomes are still supported.'}`, 'info');
      } else {
        dot.className = 'dot failed';
        status.textContent = 'Model setup required';
        $('#window-size').textContent = '—';
        setNotice(`${state.ready.message} Open the research dashboard, choose this source, and run the pipeline first.`, 'warn');
      }
      setButtons();
    } catch (error) {
      state.ready = null;
      setNotice(`Could not check model readiness: ${error.message}`, 'error');
      $('#model-status').textContent = 'Check failed';
      $('#model-dot').className = 'dot failed';
      setButtons();
    }
  }

  function newSessionId() {
    return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function markActivity() {
    state.lastActivityAt = Date.now();
  }

  function recordSnapshot() {
    if (!state.running) return;
    const now = Date.now();
    const snapshot = {
      created_at: new Date(now).toISOString(),
      keyboard_count: state.keyCount,
      mouse_distance: Math.round(state.mouseDistance * 100) / 100,
      mouse_clicks: state.clickCount,
      idle_time: Math.max(0, (now - Math.max(state.lastActivityAt, state.lastSnapshotAt)) / 1000),
      active_application: document.hidden ? 'Away from session page' : 'FocusTrack session page',
    };
    state.snapshots.push(snapshot);
    state.lastSnapshotAt = now;
    state.keyCount = 0;
    state.mouseDistance = 0;
    state.clickCount = 0;
    $('#snapshot-count').textContent = String(state.snapshots.length);
  }

  function formatElapsed(seconds) {
    const mins = Math.floor(seconds / 60);
    return `${mins}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function updateElapsed() {
    if (!state.running) return;
    $('#elapsed').textContent = formatElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
  }

  function startCapture() {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('pointermove', onPointermove, { passive: true });
    document.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', onVisibilityChange);
    recordSnapshot();
    state.timer = setInterval(recordSnapshot, 2000);
    state.elapsedTimer = setInterval(updateElapsed, 1000);
  }

  function stopCapture() {
    clearInterval(state.timer);
    clearInterval(state.elapsedTimer);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('pointermove', onPointermove);
    document.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    state.timer = null;
    state.elapsedTimer = null;
  }

  function onKeydown(event) {
    if (event.repeat) return;
    state.keyCount += 1;
    markActivity();
  }

  function onPointermove(event) {
    state.mouseDistance += Math.hypot(event.movementX || 0, event.movementY || 0);
    markActivity();
  }

  function onClick() {
    state.clickCount += 1;
    markActivity();
  }

  function onVisibilityChange() {
    recordSnapshot();
  }

  async function startSession() {
    if (!state.ready || !state.ready.ready || state.running) return;
    const participantId = $('#demo-participant').value.trim();
    if (!participantId) {
      setSessionStatus('Enter a participant label before starting.', 'error');
      return;
    }
    if (state.sessionId && !(await clearSession())) return;

    state.running = true;
    state.sessionId = newSessionId();
    state.participantId = participantId;
    state.context = $('#demo-context').value;
    state.source = sourceSelect.value;
    state.startedAt = Date.now();
    state.lastActivityAt = state.startedAt;
    state.lastSnapshotAt = state.startedAt;
    state.snapshots = [];
    outcomeSection.hidden = true;
    $('#elapsed').textContent = '0:00';
    $('#snapshot-count').textContent = '0';
    startCapture();
    setSessionStatus(`Recording ${state.context} session metadata. Select End session when you are ready for Component 1 to analyse it.`);
    setButtons();
  }

  async function endSession() {
    if (!state.running) return;
    recordSnapshot();
    stopCapture();
    $('#elapsed').textContent = formatElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    state.running = false;
    setButtons();
    await analyzeSnapshots(state.snapshots, false);
  }

  function makeSampleSnapshots(windowSeconds) {
    const durationSeconds = Math.max(180, windowSeconds * 4);
    const intervalSeconds = 2;
    const count = Math.ceil(durationSeconds / intervalSeconds) + 1;
    const start = Date.now() - durationSeconds * 1000;
    const apps = ['Study notes', 'Reference material', 'FocusTrack session page'];
    return Array.from({ length: count }, (_, index) => {
      const elapsed = index * intervalSeconds;
      const phase = Math.floor(elapsed / Math.max(20, windowSeconds * 0.55)) % 4;
      const active = phase === 0 || phase === 2;
      const exploratory = phase === 2;
      const idle = !active || (index % 11 === 0);
      return {
        created_at: new Date(start + elapsed * 1000).toISOString(),
        keyboard_count: active && !exploratory ? (index % 5) + 1 : 0,
        mouse_distance: active ? (exploratory ? 55 + (index % 35) : 12 + (index % 20)) : 0,
        mouse_clicks: active && exploratory ? index % 3 : (active && index % 4 === 0 ? 1 : 0),
        idle_time: idle ? intervalSeconds : 0,
        active_application: apps[Math.floor(elapsed / 45) % apps.length],
      };
    });
  }

  async function loadSampleSession() {
    if (!state.ready || !state.ready.ready || state.running) return;
    if (state.sessionId && !(await clearSession())) return;
    const participantId = $('#demo-participant').value.trim() || 'demo-learner';
    const context = $('#demo-context').value;
    state.sessionId = newSessionId();
    state.participantId = participantId;
    state.context = context;
    state.source = sourceSelect.value;
    state.snapshots = makeSampleSnapshots(state.ready.window_seconds || 60);
    state.startedAt = Date.now() - (state.snapshots.length - 1) * 2000;
    $('#elapsed').textContent = formatElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    $('#snapshot-count').textContent = String(state.snapshots.length);
    setSessionStatus(`Generated sample session for ${context}. These example events are demonstration-only.`);
    setButtons();
    await analyzeSnapshots(state.snapshots, true);
  }

  async function analyzeSnapshots(snapshots, isSample) {
    if (snapshots.length < 2) {
      setSessionStatus('Not enough observations yet. Collect at least two metadata snapshots, then end the session.', 'warn');
      return;
    }
    setSessionStatus('Sending metadata to Component 1 and applying its trained state model…');
    endButton.disabled = true;
    sampleButton.disabled = true;
    startButton.disabled = true;
    try {
      let insight = null;
      for (let offset = 0; offset < snapshots.length; offset += 1000) {
        insight = await api('/api/live/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: state.source,
            participant_id: state.participantId,
            session_id: state.sessionId,
            context: state.context,
            window_seconds: state.ready.window_seconds || 60,
            snapshots: snapshots.slice(offset, offset + 1000),
          }),
        });
      }
      renderOutcome(insight, isSample);
      outcomeSection.hidden = false;
      setSessionStatus(isSample
        ? 'Sample session analysed by the selected trained Component 1 model.'
        : 'Session ended. These outcomes were generated by the selected trained Component 1 model.');
    } catch (error) {
      setSessionStatus(`Could not analyse the session: ${error.message}`, 'error');
      outcomeContent.innerHTML = `<p class="demo-notice error">${esc(error.message)}</p>`;
      outcomeSection.hidden = false;
    } finally {
      setButtons();
    }
  }

  function metric(label, value) {
    return `<div class="demo-outcome"><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span></div>`;
  }

  function renderOutcome(insight, isSample) {
    const transitions = insight.transitions || {};
    const regime = insight.regime;
    const descriptor = insight.currentStateDescriptor || 'Not available';
    const regimeDescription = regime
      ? `Regime ${regime.current + 1} · ${(regime.confidence * 100).toFixed(0)}% model confidence`
      : 'HMM model unavailable';
    const duration = Number(insight.elapsedSeconds);
    const durationLabel = Number.isFinite(duration)
      ? formatElapsed(Math.round(duration))
      : 'Not available';
    const shares = (insight.stateShares || []).map((entry) => {
      const share = Math.max(0, Math.min(1, Number(entry.share) || 0));
      const label = `State ${entry.state}: ${entry.descriptor || 'interaction pattern'}`;
      return `<div class="demo-bar-row">
        <span title="${esc(label)}">${esc(label)}</span>
        <div class="demo-bar-track"><div class="demo-bar-fill" style="width:${(share * 100).toFixed(1)}%;background:${CLEAR_PALETTE[entry.state % CLEAR_PALETTE.length]}"></div></div>
        <strong>${(share * 100).toFixed(0)}%</strong>
      </div>`;
    }).join('');
    const timeline = (insight.timeline || []).map((entry) => {
      const stateNumber = Number(entry.state) || 0;
      const title = `Window ${entry.windowIndex + 1}: state ${stateNumber}${entry.transition ? ' (state change)' : ''}`;
      return `<span title="${esc(title)}" style="background:${CLEAR_PALETTE[stateNumber % CLEAR_PALETTE.length]}"></span>`;
    }).join('');
    const evidenceNote = insight.windows < 2
      ? 'Limited temporal evidence: this session produced fewer than two model windows, so transitions and recovery patterns may not be meaningful.'
      : `${insight.windows} model windows were analysed. State changes and recoveries describe structural transitions, not confirmed concentration changes.`;
    const sourceLabel = insight.model && insight.model.sourceLabel ? insight.model.sourceLabel : state.source;
    const syntheticNote = insight.model && insight.model.synthetic
      ? ' The selected model source is synthetic and must not be reported as real-pilot evidence.'
      : '';

    $('#outcome-label').textContent = `${isSample ? 'Sample replay' : 'Completed session'} · ${sourceLabel}`;
    outcomeContent.innerHTML = `
      <div class="demo-result-grid">
        ${metric('Current interaction state', `State ${insight.currentState ?? '—'}`)}
        ${metric('State profile', descriptor)}
        ${metric('Model regime', regimeDescription)}
        ${metric('Learning activity', insight.context || state.context)}
        ${metric('Session length', durationLabel)}
        ${metric('Observed windows', insight.windows ?? 0)}
        ${metric('State changes', transitions.count ?? 0)}
        ${metric('Interruptions / returns', `${transitions.interruptions ?? 0} / ${transitions.recoveries ?? 0}`)}
      </div>
      <h3 class="demo-result-title">Interaction-state timeline</h3>
      <div class="demo-timeline" role="img" aria-label="Interaction state in each model window">${timeline || '<span></span>'}</div>
      <p class="demo-timeline-note">Each segment is one model window; colours distinguish learned interaction states, not focus levels.</p>
      <h3 class="demo-result-title">Share of observed interaction states</h3>
      <div class="demo-bars">${shares || '<p>No state-share output was available.</p>'}</div>
      <div class="summ">${esc(insight.summary || 'No plain-language session summary was returned.')}</div>
      <div class="demo-notice warn">${esc(evidenceNote)}${esc(syntheticNote)}</div>
      <p class="demo-footnote">Keyboard, pointer, idle, and browser-tab visibility metadata cannot prove concentration. HMM confidence is confidence in the inferred hidden regime only; it is not a concentration score. This demo collects no self-reported concentration rating.</p>
    `;
  }

  async function clearSession() {
    if (!state.sessionId) return true;
    try {
      await api(`/api/live/session?session_id=${encodeURIComponent(state.sessionId)}`, { method: 'DELETE' });
      state.sessionId = null;
      state.snapshots = [];
      outcomeSection.hidden = true;
      $('#elapsed').textContent = '0:00';
      $('#snapshot-count').textContent = '0';
      setSessionStatus('Session metadata and readout cleared from server memory.');
      return true;
    } catch (error) {
      setSessionStatus(`Could not clear session data: ${error.message}`, 'error');
      return false;
    }
  }

  sourceSelect.addEventListener('change', checkReadiness);
  startButton.addEventListener('click', startSession);
  endButton.addEventListener('click', endSession);
  sampleButton.addEventListener('click', loadSampleSession);
  $('#clear-session').addEventListener('click', clearSession);
  loadSources();
})();
