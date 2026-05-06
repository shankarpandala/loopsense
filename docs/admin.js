/* global BACKEND_URL, io */

const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });

let state = {
  phase: 'idle',
  options: [],
  counts: {},
  remainingMs: 300_000,
  duration: 300_000,
  winner: null,
  initialSnapshot: null,
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

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
  renderPhase();
  renderControls();
  renderOptions();
  renderTimer();
  renderWinner();
}

function renderPhase() {
  const phaseNames  = { idle: 'Idle', running: 'Running', stopped: 'Stopped', winner_published: 'Results' };
  const phaseClasses = { idle: 'badge-idle', running: 'badge-running', stopped: 'badge-stopped', winner_published: 'badge-winner' };
  $('phase-label').textContent = phaseNames[state.phase] || state.phase;
  $('phase-badge').className   = 'badge ' + (phaseClasses[state.phase] || 'badge-idle');
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

function renderTimer() {
  $('stat-timer').textContent = formatTime(state.remainingMs);
  $('stat-timer').style.color = state.remainingMs < 30_000 ? 'var(--danger)' : '';
}

function renderWinner() {
  const panel = $('winner-panel');
  if (state.phase === 'winner_published' && state.winner) {
    panel.classList.remove('hidden');
    $('admin-winner-label').textContent  = state.winner.label;
    $('admin-winner-label').style.color  = state.winner.color || 'var(--accent)';
    $('admin-winner-votes').textContent  = `${state.winner.count} vote${state.winner.count !== 1 ? 's' : ''}`;
    renderSentimentComparison(state.initialSnapshot, state.counts, state.options);
  } else {
    panel.classList.add('hidden');
  }
}

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

// ---------------------------------------------------------------------------
// Option management
// ---------------------------------------------------------------------------

function removeOption(id) { socket.emit('admin:removeOption', { id }); }

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
  socket.emit('admin:addOption', { label, color: $('opt-color').value });
  $('opt-label').value = '';
});

$('opt-label').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-add-opt').click(); });

$('duration-input').addEventListener('change', () => {
  const secs = parseInt($('duration-input').value, 10);
  if (secs >= 10) socket.emit('admin:setDuration', { seconds: secs });
});

$('btn-start').addEventListener('click',   () => socket.emit('admin:start'));
$('btn-stop').addEventListener('click',    () => { if (confirm('Stop the session?')) socket.emit('admin:stop'); });
$('btn-publish').addEventListener('click', () => socket.emit('admin:publishWinner'));
$('btn-reset').addEventListener('click',   () => { if (confirm('Reset? All votes and options will be cleared.')) socket.emit('admin:reset'); });

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
  state.phase       = data.phase;
  state.options     = data.options || [];
  state.counts      = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.duration    = data.duration;
  state.winner      = data.winner;
  if (state.phase === 'idle') $('duration-input').value = Math.round(state.duration / 1000);
  renderAll();
});

socket.on('admin:stateSync', (data) => {
  state.phase       = data.phase;
  state.options     = data.options || [];
  state.counts      = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.duration    = data.duration;
  state.winner      = data.winner;
  renderAll();
});

socket.on('state:tick', (data) => {
  state.counts      = data.counts || {};
  state.remainingMs = data.remainingMs;
  state.phase       = data.phase;
  $('stat-votes').textContent = totalActiveVotes();
  renderTimer();
  if (data.phase === 'stopped') renderControls();
});

socket.on('state:winner', ({ winner, initialSnapshot }) => {
  state.winner          = winner;
  state.initialSnapshot = initialSnapshot;
  state.phase           = 'winner_published';
  renderAll();
});

socket.on('state:reset', () => {
  state = { phase: 'idle', options: [], counts: {}, remainingMs: 300_000, duration: 300_000, winner: null, initialSnapshot: null };
  $('duration-input').value = 300;
  resetBall();
  renderAll();
});

socket.on('admin:error', ({ message }) => alert('Error: ' + message));

// ---------------------------------------------------------------------------
// Swarm canvas — single consensus ball
//
// The ball moves toward the weighted centroid of all voted options, one small
// step per frame. As votes shift, the centroid moves and the ball changes
// direction mid-journey. It never teleports. Pull-lines show the live forces.
// ---------------------------------------------------------------------------

const canvas = $('swarm-canvas');
const ctx    = canvas.getContext('2d');

// The one consensus ball
let ball  = { x: 0, y: 0, vx: 0, vy: 0 };
let trail = [];           // [{x,y}] — recent path
const TRAIL_MAX = 180;
const DAMPING   = 0.96;

// Speed is canvas-relative so travel time stays ~30s at full consensus
// regardless of screen size.
// Distance centre→option ≈ canvas * 0.5 * 0.62 = canvas * 0.31
// At 60fps, 30s = 1800 frames → speed = canvas * 0.31 / 1800 ≈ canvas * 0.000172
function maxSpeed()  { return Math.min(cw(), ch()) * 0.000172; }
function stepForce() { return maxSpeed() * 0.4; }  // reach top speed quickly

function resetBall() {
  ball  = { x: canvas.width / 2, y: canvas.height / 2, vx: 0, vy: 0 };
  trail = [];
}

// Keep canvas square and pixel-perfect
const ro = new ResizeObserver(() => {
  const s = canvas.offsetWidth;
  if (s === 0) return;
  const needsReset = canvas.width === 0;
  canvas.width  = s;
  canvas.height = s;
  if (needsReset) resetBall();
  else { ball.x = Math.min(ball.x, s); ball.y = Math.min(ball.y, s); }
});
ro.observe(canvas);

function cw() { return canvas.width; }
function ch() { return canvas.height; }

// Radial position for option i out of total
function optPos(idx, total) {
  const r     = Math.min(cw(), ch()) * 0.5 * 0.62;
  const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
  return { x: cw() / 2 + Math.cos(angle) * r, y: ch() / 2 + Math.sin(angle) * r, angle };
}

// Weighted centroid of all voted option positions
function consensusTarget() {
  const total = state.options.length;
  const totalVotes = Object.values(state.counts).reduce((a, b) => a + b, 0);

  if (total === 0 || totalVotes === 0) {
    return { x: cw() / 2, y: ch() / 2 };
  }

  let wx = 0, wy = 0;
  state.options.forEach((opt, i) => {
    const count = state.counts[opt.id] || 0;
    const pos   = optPos(i, total);
    wx += pos.x * count;
    wy += pos.y * count;
  });
  return { x: wx / totalVotes, y: wy / totalVotes };
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

// Blend color of all options weighted by vote count (for ball colour)
function consensusColor() {
  const totalVotes = Object.values(state.counts).reduce((a, b) => a + b, 0);
  if (totalVotes === 0 || state.options.length === 0) return '#6366f1';
  let r = 0, g = 0, b = 0;
  for (const opt of state.options) {
    const w   = (state.counts[opt.id] || 0) / totalVotes;
    const rgb = hexToRgb(opt.color).split(',').map(Number);
    r += rgb[0] * w;
    g += rgb[1] * w;
    b += rgb[2] * w;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function drawFrame() {
  const W = cw(), H = ch();
  if (W === 0 || H === 0) { requestAnimationFrame(drawFrame); return; }

  const total = state.options.length;

  // Fade trail (partial clear)
  ctx.fillStyle = 'rgba(15,15,26,0.40)';
  ctx.fillRect(0, 0, W, H);

  // ---- Placeholder when no options ----
  if (total === 0) {
    ctx.fillStyle = '#334155';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Add options to start the swarm', W / 2, H / 2);
    requestAnimationFrame(drawFrame);
    return;
  }

  // ---- Update ball physics ----
  const target = consensusTarget();
  const dx     = target.x - ball.x;
  const dy     = target.y - ball.y;
  const dist   = Math.hypot(dx, dy);

  if (dist > 0.5) {
    // Apply unit-step force in direction of consensus
    ball.vx += (dx / dist) * stepForce();
    ball.vy += (dy / dist) * stepForce();
  }

  // Hard cap — ball moves like a turtle even at full consensus
  const speed = Math.hypot(ball.vx, ball.vy);
  const cap   = maxSpeed();
  if (speed > cap) {
    ball.vx = (ball.vx / speed) * cap;
    ball.vy = (ball.vy / speed) * cap;
  }

  ball.vx *= DAMPING;
  ball.vy *= DAMPING;
  ball.x  += ball.vx;
  ball.y  += ball.vy;

  // Clamp inside canvas
  ball.x = Math.max(8, Math.min(W - 8, ball.x));
  ball.y = Math.max(8, Math.min(H - 8, ball.y));

  // Record trail
  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > TRAIL_MAX) trail.shift();

  // ---- Draw trail ----
  if (trail.length > 2) {
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) {
      ctx.lineTo(trail[i].x, trail[i].y);
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  // ---- Draw pull-lines (forces from ball to each option) ----
  const totalVotes = Object.values(state.counts).reduce((a, b) => a + b, 0);
  state.options.forEach((opt, i) => {
    const count = state.counts[opt.id] || 0;
    if (count === 0) return;
    const pos   = optPos(i, total);
    const rgb   = hexToRgb(opt.color);
    const frac  = count / Math.max(1, totalVotes);
    const alpha = 0.10 + frac * 0.55;
    const lw    = 0.5 + frac * 3.5;

    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = `rgba(${rgb},${alpha})`;
    ctx.lineWidth   = lw;
    ctx.stroke();
  });

  // ---- Draw option nodes ----
  state.options.forEach((opt, i) => {
    const pos   = optPos(i, total);
    const count = state.counts[opt.id] || 0;
    const rgb   = hexToRgb(opt.color);
    const maxC  = Math.max(1, ...state.options.map(o => state.counts[o.id] || 0));
    const frac  = count / maxC;
    const nodeR = 18 + frac * 10;

    // Outer glow
    const grd = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, nodeR + 10);
    grd.addColorStop(0,   `rgba(${rgb},0.25)`);
    grd.addColorStop(0.6, `rgba(${rgb},0.06)`);
    grd.addColorStop(1,   `rgba(${rgb},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, nodeR + 10, 0, Math.PI * 2);
    ctx.fill();

    // Circle
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, nodeR, 0, Math.PI * 2);
    ctx.fillStyle   = `rgba(${rgb},0.14)`;
    ctx.fill();
    ctx.strokeStyle = opt.color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Vote count
    ctx.fillStyle    = opt.color;
    ctx.font         = `bold ${count > 99 ? 11 : 13}px system-ui`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count, pos.x, pos.y);

    // Label (further out on same radial)
    const labelR = Math.min(cw(), ch()) * 0.5 * 0.90;
    const angle  = (i / total) * Math.PI * 2 - Math.PI / 2;
    const lx = cw() / 2 + Math.cos(angle) * labelR;
    const ly = ch() / 2 + Math.sin(angle) * labelR;

    ctx.fillStyle    = '#e2e8f0';
    ctx.font         = '600 11px system-ui';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const maxLW = Math.min(cw() * 0.18, 70);
    const words = opt.label.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxLW && line) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
    const lh = 14;
    const startY = ly - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, k) => ctx.fillText(l, lx, startY + k * lh));
  });

  // ---- Draw consensus ball ----
  const ballColor = consensusColor();
  const ballRgb   = hexToRgb(ballColor.startsWith('#') ? ballColor : '#6366f1');

  // Outer glow
  const ballGrd = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, 18);
  ballGrd.addColorStop(0,   `rgba(${ballRgb},0.80)`);
  ballGrd.addColorStop(0.4, `rgba(${ballRgb},0.30)`);
  ballGrd.addColorStop(1,   `rgba(${ballRgb},0)`);
  ctx.fillStyle = ballGrd;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 18, 0, Math.PI * 2);
  ctx.fill();

  // Core
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = ballColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  requestAnimationFrame(drawFrame);
}

// Kick off animation loop
requestAnimationFrame(drawFrame);
