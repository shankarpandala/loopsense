/* global BACKEND_URL, io */

const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

let state = {
  phase: 'idle',
  options: [],
  counts: {},
  remainingMs: 300_000,
  duration: 300_000,
  winner: null,
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $(id) { return document.getElementById(id); }

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function escHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function totalActiveVotes() {
  return Object.values(state.counts).reduce((a, b) => a + b, 0);
}

function maxCount() {
  return Math.max(1, ...Object.values(state.counts));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
  renderPhase();
  renderControls();
  renderOptions();
  renderBars();
  renderTimer();
  renderWinner();
}

function renderPhase() {
  const phaseNames = { idle: 'Idle', running: 'Running', stopped: 'Stopped', winner_published: 'Results' };
  const phaseClasses = { idle: 'badge-idle', running: 'badge-running', stopped: 'badge-stopped', winner_published: 'badge-winner' };

  $('phase-label').textContent = phaseNames[state.phase] || state.phase;
  $('phase-badge').className = 'badge ' + (phaseClasses[state.phase] || 'badge-idle');
  $('phase-dot').classList.toggle('dot-pulse', state.phase === 'running');
}

function renderControls() {
  const p = state.phase;
  const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
  show('btn-start',   p === 'idle');
  show('btn-stop',    p === 'running');
  show('btn-publish', p === 'stopped');
  show('btn-reset',   p === 'stopped' || p === 'winner_published');
  $('setup-panel').classList.toggle('hidden', p !== 'idle');
}

function renderOptions() {
  const list = $('option-list');
  if (state.options.length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem;padding:4px 0">No options added yet.</li>';
    return;
  }
  list.innerHTML = state.options.map(opt => `
    <li class="option-item" data-id="${opt.id}">
      <span class="opt-color" style="background:${opt.color}"></span>
      <span class="opt-label">${escHtml(opt.label)}</span>
      <span class="opt-actions">
        <button class="btn btn-ghost btn-sm" onclick="editOption('${opt.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="removeOption('${opt.id}')">✕</button>
      </span>
    </li>
  `).join('');
}

function renderBars() {
  const list = $('bar-list');
  if (state.options.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No options yet.</p>';
    return;
  }
  const max = maxCount();
  list.innerHTML = state.options.map(opt => {
    const count = state.counts[opt.id] || 0;
    const pct = Math.round((count / max) * 100);
    return `
      <div class="bar-item">
        <div class="bar-meta">
          <span class="bar-name" style="color:${opt.color}">${escHtml(opt.label)}</span>
          <span class="bar-count" data-bar-count="${opt.id}">${count}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" data-bar-fill="${opt.id}" style="width:${pct}%;background:${opt.color}"></div>
        </div>
      </div>
    `;
  }).join('');
}

function updateBars() {
  const max = maxCount();
  $('stat-votes').textContent = totalActiveVotes();
  for (const opt of state.options) {
    const count = state.counts[opt.id] || 0;
    const pct = Math.round((count / max) * 100);
    const fill = document.querySelector(`[data-bar-fill="${opt.id}"]`);
    const countEl = document.querySelector(`[data-bar-count="${opt.id}"]`);
    if (fill) fill.style.width = pct + '%';
    if (countEl) countEl.textContent = count;
  }
}

function renderTimer() {
  $('stat-timer').textContent = formatTime(state.remainingMs);
  $('stat-timer').style.color = state.remainingMs < 30_000 ? 'var(--danger)' : '';
}

function renderWinner() {
  const panel = $('winner-panel');
  if (state.phase === 'winner_published' && state.winner) {
    panel.classList.remove('hidden');
    $('admin-winner-label').textContent = state.winner.label;
    $('admin-winner-label').style.color = state.winner.color || 'var(--accent)';
    $('admin-winner-votes').textContent = `${state.winner.count} vote${state.winner.count !== 1 ? 's' : ''}`;
  } else {
    panel.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------
// Option management
// ---------------------------------------------------------------------------

function removeOption(id) {
  socket.emit('admin:removeOption', { id });
}

function editOption(id) {
  const opt = state.options.find(o => o.id === id);
  if (!opt) return;
  const label = prompt('New label:', opt.label);
  if (label === null) return;
  socket.emit('admin:updateOption', { id, label: label.trim() || opt.label });
}

// ---------------------------------------------------------------------------
// Button event listeners
// ---------------------------------------------------------------------------

$('btn-add-opt').addEventListener('click', () => {
  const label = $('opt-label').value.trim();
  if (!label) return;
  const color = $('opt-color').value;
  socket.emit('admin:addOption', { label, color });
  $('opt-label').value = '';
});

$('opt-label').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-add-opt').click();
});

$('duration-input').addEventListener('change', () => {
  const secs = parseInt($('duration-input').value, 10);
  if (secs >= 10) socket.emit('admin:setDuration', { seconds: secs });
});

$('btn-start').addEventListener('click', () => {
  socket.emit('admin:start');
});

$('btn-stop').addEventListener('click', () => {
  if (confirm('Stop the voting session now?')) socket.emit('admin:stop');
});

$('btn-publish').addEventListener('click', () => {
  socket.emit('admin:publishWinner');
});

$('btn-reset').addEventListener('click', () => {
  if (confirm('Reset the game? This will clear all votes and options.')) socket.emit('admin:reset');
});

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------

socket.on('connect', () => {
  socket.emit('admin:identify');
  $('conn-dot').classList.add('connected');
  $('conn-label').textContent = 'Connected';
});

socket.on('disconnect', () => {
  $('conn-dot').classList.remove('connected');
  $('conn-label').textContent = 'Reconnecting…';
});

socket.on('state:full', (data) => {
  state.phase      = data.phase;
  state.options    = data.options || [];
  state.counts     = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.duration   = data.duration;
  state.winner     = data.winner;
  if (state.phase === 'idle') {
    $('duration-input').value = Math.round(state.duration / 1000);
  }
  renderAll();
});

socket.on('admin:stateSync', (data) => {
  state.phase      = data.phase;
  state.options    = data.options || [];
  state.counts     = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.duration   = data.duration;
  state.winner     = data.winner;
  renderAll();
});

socket.on('state:tick', (data) => {
  state.counts      = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.phase       = data.phase;
  updateBars();
  renderTimer();
  if (data.phase === 'stopped') renderControls();
});

socket.on('state:winner', ({ winner }) => {
  state.winner = winner;
  state.phase  = 'winner_published';
  renderAll();
});

socket.on('state:reset', () => {
  state = { phase: 'idle', options: [], counts: {}, remainingMs: 300_000, duration: 300_000, winner: null };
  $('duration-input').value = 300;
  renderAll();
});

socket.on('admin:error', ({ message }) => {
  alert('Error: ' + message);
});
