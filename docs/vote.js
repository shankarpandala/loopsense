/* global BACKEND_URL, io */

const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

let state = {
  phase: 'idle',
  options: [],
  counts: {},
  remainingMs: 300_000,
  currentVote: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function showScreen(name) {
  ['idle', 'running', 'stopped'].forEach(s => {
    $('screen-' + s).classList.toggle('hidden', s !== name);
  });
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function phaseBadgeClass(phase) {
  return { idle: 'badge-idle', running: 'badge-running', stopped: 'badge-stopped', winner_published: 'badge-winner' }[phase] || 'badge-idle';
}

function phaseBadgeText(phase) {
  return { idle: 'Waiting', running: 'Live', stopped: 'Closed', winner_published: 'Results' }[phase] || phase;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderPhase() {
  const badge = $('phase-badge');
  badge.className = 'badge ' + phaseBadgeClass(state.phase);
  $('phase-label').textContent = phaseBadgeText(state.phase);

  const dot = badge.querySelector('.dot');
  dot.classList.toggle('dot-pulse', state.phase === 'running');

  if (state.phase === 'idle') {
    showScreen('idle');
    $('winner-overlay').classList.add('hidden');
  } else if (state.phase === 'running') {
    showScreen('running');
    $('winner-overlay').classList.add('hidden');
    renderVoteButtons();
  } else if (state.phase === 'stopped') {
    showScreen('stopped');
  } else if (state.phase === 'winner_published') {
    showScreen('stopped');
  }
}

function renderVoteButtons() {
  const grid = $('vote-grid');
  grid.innerHTML = '';
  for (const opt of state.options) {
    const btn = document.createElement('button');
    btn.className = 'vote-button' + (state.currentVote === opt.id ? ' active' : '');
    btn.style.setProperty('--opt-color', opt.color);
    btn.dataset.id = opt.id;

    const count = state.counts[opt.id] || 0;
    btn.innerHTML = `
      <span class="btn-label">
        <span class="check-icon">
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="color-dot" style="background:${opt.color}"></span>
        <span class="btn-label-text">${escHtml(opt.label)}</span>
      </span>
      <span class="btn-count" data-count="${opt.id}">${count}</span>
    `;
    btn.addEventListener('click', () => handleVoteClick(opt.id));
    grid.appendChild(btn);
  }
}

function updateCounts() {
  for (const opt of state.options) {
    const el = document.querySelector(`[data-count="${opt.id}"]`);
    if (el) el.textContent = state.counts[opt.id] || 0;
  }
  // Update active state
  document.querySelectorAll('.vote-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.id === state.currentVote);
  });
}

function updateTimer() {
  const el = $('timer-display');
  if (!el) return;
  el.textContent = formatTime(state.remainingMs);
  el.classList.toggle('urgent', state.remainingMs < 30_000);
}

// ---------------------------------------------------------------------------
// Vote interaction
// ---------------------------------------------------------------------------

function handleVoteClick(optionId) {
  if (state.phase !== 'running') return;
  if (state.currentVote === optionId) {
    socket.emit('vote:remove', { optionId });
  } else {
    socket.emit('vote:cast', { optionId });
  }
}

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

socket.on('connect', () => {
  $('conn-dot').classList.add('connected');
  $('conn-label').textContent = 'Connected';
});

socket.on('disconnect', () => {
  $('conn-dot').classList.remove('connected');
  $('conn-label').textContent = 'Reconnecting…';
});

socket.on('state:full', (data) => {
  state.phase = data.phase;
  state.options = data.options || [];
  state.counts = data.counts || {};
  state.remainingMs = data.remainingMs;
  renderPhase();
  updateTimer();
});

socket.on('state:tick', (data) => {
  state.counts = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.phase = data.phase;
  updateCounts();
  updateTimer();
  if (data.phase === 'stopped' && document.getElementById('screen-running') &&
      !document.getElementById('screen-running').classList.contains('hidden')) {
    showScreen('stopped');
  }
});

socket.on('state:winner', ({ winner, initialSnapshot }) => {
  if (!winner) return;
  state.phase = 'winner_published';
  $('winner-label').textContent = winner.label;
  $('winner-label').style.color = winner.color || 'var(--accent)';
  $('winner-votes').textContent = `${winner.count} vote${winner.count !== 1 ? 's' : ''}`;
  renderSentimentComparison(initialSnapshot, state.counts, state.options);
  $('winner-overlay').classList.remove('hidden');
  showScreen('stopped');
});

function renderSentimentComparison(snapshot, finalCounts, options) {
  const section = $('sentiment-comparison');
  const rows    = $('sentiment-rows');
  if (!snapshot || !options.length) { section.classList.add('hidden'); return; }

  const initTotal  = Math.max(1, snapshot.totalVotes);
  const finalTotal = Math.max(1, Object.values(finalCounts).reduce((a, b) => a + b, 0));

  rows.innerHTML = options.map(opt => {
    const initCount  = snapshot.counts[opt.id] || 0;
    const finalCount = finalCounts[opt.id] || 0;
    const initPct    = Math.round((initCount  / initTotal)  * 100);
    const finalPct   = Math.round((finalCount / finalTotal) * 100);
    const delta      = finalPct - initPct;
    const arrow      = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    const arrowColor = delta > 0 ? 'var(--success)' : delta < 0 ? 'var(--danger)' : 'var(--text-muted)';

    return `
      <div class="sentiment-row">
        <span class="sentiment-opt" style="color:${opt.color}">${escHtml(opt.label)}</span>
        <div class="sentiment-bars">
          <div class="sentiment-bar-wrap">
            <span class="sentiment-label">Initial</span>
            <div class="sentiment-track">
              <div class="sentiment-fill" style="width:${initPct}%;background:${opt.color};opacity:0.45"></div>
            </div>
            <span class="sentiment-pct">${initPct}%</span>
          </div>
          <div class="sentiment-bar-wrap">
            <span class="sentiment-label">Final</span>
            <div class="sentiment-track">
              <div class="sentiment-fill" style="width:${finalPct}%;background:${opt.color}"></div>
            </div>
            <span class="sentiment-pct">${finalPct}% <span style="color:${arrowColor};font-size:0.75em">${arrow}</span></span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  section.classList.remove('hidden');
}

socket.on('state:reset', () => {
  state.currentVote = null;
  state.phase = 'idle';
  state.options = [];
  state.counts = {};
  $('winner-overlay').classList.add('hidden');
  renderPhase();
});

socket.on('vote:ack', ({ currentVote }) => {
  state.currentVote = currentVote;
  updateCounts();
});

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
