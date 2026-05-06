const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const gameState = {
  phase: 'idle', // 'idle' | 'running' | 'stopped' | 'winner_published'
  options: [],   // [{ id, label, color }]
  counts: {},    // { optionId: number } — recomputed every tick
  votes: {},     // { socketId: optionId | null } — authoritative
  startedAt: null,
  duration: 300_000, // ms (default 5 min)
  remainingMs: 300_000,
  winner: null,        // { id, label, color, count }
  initialSnapshot: null, // { counts, totalVotes } — captured at 5s mark, hidden until winner published
};

const adminSockets = new Set();

let tickInterval = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId() {
  return 'opt_' + Math.random().toString(36).slice(2, 8);
}

function computeCounts() {
  const counts = {};
  for (const opt of gameState.options) counts[opt.id] = 0;
  for (const optId of Object.values(gameState.votes)) {
    if (optId && counts[optId] !== undefined) counts[optId]++;
  }
  return counts;
}

function getPublicState() {
  return {
    phase: gameState.phase,
    options: gameState.options,
    counts: gameState.counts,
    duration: gameState.duration,
    remainingMs: gameState.remainingMs,
    winner: gameState.winner,
    // Only reveal initial snapshot once winner is published
    initialSnapshot: gameState.phase === 'winner_published' ? gameState.initialSnapshot : null,
  };
}

function broadcastFull() {
  io.emit('state:full', getPublicState());
}

function transitionTo(phase) {
  gameState.phase = phase;
  broadcastFull();
}

function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    gameState.counts = computeCounts();

    if (gameState.phase === 'running') {
      gameState.remainingMs = gameState.duration - (Date.now() - gameState.startedAt);
      if (gameState.remainingMs <= 0) {
        gameState.remainingMs = 0;
        stopTick();
        transitionTo('stopped');
        return;
      }
    }

    io.emit('state:tick', {
      counts: gameState.counts,
      remainingMs: gameState.remainingMs,
      phase: gameState.phase,
    });
  }, 100);
}

function stopTick() {
  clearInterval(tickInterval);
  tickInterval = null;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

app.get('/', (_req, res) => {
  res.send('Loopsense server is running.');
});

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  // Send full state snapshot to new connection
  socket.emit('state:full', getPublicState());

  // ---- Admin identification ----
  socket.on('admin:identify', () => {
    adminSockets.add(socket.id);
    socket.emit('admin:stateSync', { ...getPublicState(), votes: gameState.votes });
  });

  // ---- Admin: option management (idle phase only) ----
  socket.on('admin:addOption', ({ label, color } = {}) => {
    if (gameState.phase !== 'idle') return socket.emit('admin:error', { message: 'Can only add options in idle phase.' });
    if (!label || typeof label !== 'string' || !label.trim()) return socket.emit('admin:error', { message: 'Label is required.' });
    const opt = { id: generateId(), label: label.trim(), color: color || '#6366f1' };
    gameState.options.push(opt);
    broadcastFull();
  });

  socket.on('admin:removeOption', ({ id } = {}) => {
    if (gameState.phase !== 'idle') return socket.emit('admin:error', { message: 'Can only remove options in idle phase.' });
    gameState.options = gameState.options.filter(o => o.id !== id);
    // Null out votes for removed option
    for (const sid of Object.keys(gameState.votes)) {
      if (gameState.votes[sid] === id) gameState.votes[sid] = null;
    }
    broadcastFull();
  });

  socket.on('admin:updateOption', ({ id, label, color } = {}) => {
    if (gameState.phase !== 'idle') return socket.emit('admin:error', { message: 'Can only update options in idle phase.' });
    const opt = gameState.options.find(o => o.id === id);
    if (!opt) return socket.emit('admin:error', { message: 'Option not found.' });
    if (label && label.trim()) opt.label = label.trim();
    if (color) opt.color = color;
    broadcastFull();
  });

  socket.on('admin:setDuration', ({ seconds } = {}) => {
    if (gameState.phase !== 'idle') return socket.emit('admin:error', { message: 'Can only set duration in idle phase.' });
    const secs = parseInt(seconds, 10);
    if (!secs || secs < 10) return socket.emit('admin:error', { message: 'Duration must be at least 10 seconds.' });
    gameState.duration = secs * 1000;
    gameState.remainingMs = gameState.duration;
    broadcastFull();
  });

  // ---- Admin: game control ----
  socket.on('admin:start', () => {
    if (gameState.phase !== 'idle') return socket.emit('admin:error', { message: 'Game is not in idle phase.' });
    if (gameState.options.length === 0) return socket.emit('admin:error', { message: 'Add at least one option before starting.' });
    gameState.startedAt = Date.now();
    gameState.remainingMs = gameState.duration;
    gameState.votes = {};
    gameState.counts = computeCounts();
    gameState.initialSnapshot = null;
    transitionTo('running');
    startTick();

    // Capture initial public sentiment at 5 seconds — kept secret until winner published
    setTimeout(() => {
      if (gameState.phase === 'running') {
        const counts = computeCounts();
        const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
        gameState.initialSnapshot = { counts: { ...counts }, totalVotes };
      }
    }, 5000);
  });

  socket.on('admin:stop', () => {
    if (gameState.phase !== 'running') return socket.emit('admin:error', { message: 'Game is not running.' });
    stopTick();
    gameState.counts = computeCounts();
    transitionTo('stopped');
  });

  socket.on('admin:publishWinner', () => {
    if (gameState.phase !== 'stopped') return socket.emit('admin:error', { message: 'Game must be stopped first.' });
    gameState.counts = computeCounts();
    let winnerOpt = null;
    let maxCount = -1;
    for (const opt of gameState.options) {
      const c = gameState.counts[opt.id] || 0;
      if (c > maxCount) { maxCount = c; winnerOpt = opt; }
    }
    gameState.winner = winnerOpt ? { id: winnerOpt.id, label: winnerOpt.label, color: winnerOpt.color, count: maxCount } : null;
    transitionTo('winner_published');
    io.emit('state:winner', { winner: gameState.winner, initialSnapshot: gameState.initialSnapshot });
  });

  socket.on('admin:reset', () => {
    if (!['stopped', 'winner_published'].includes(gameState.phase)) {
      return socket.emit('admin:error', { message: 'Can only reset from stopped or winner_published phase.' });
    }
    stopTick();
    gameState.phase = 'idle';
    gameState.options = [];
    gameState.counts = {};
    gameState.votes = {};
    gameState.startedAt = null;
    gameState.duration = 300_000;
    gameState.remainingMs = 300_000;
    gameState.winner = null;
    gameState.initialSnapshot = null;
    io.emit('state:reset', {});
    broadcastFull();
  });

  // ---- Voter: cast / remove vote ----
  socket.on('vote:cast', ({ optionId } = {}) => {
    if (gameState.phase !== 'running') return;
    if (!gameState.options.find(o => o.id === optionId)) return;
    gameState.votes[socket.id] = optionId;
    socket.emit('vote:ack', { currentVote: optionId });
  });

  socket.on('vote:remove', ({ optionId } = {}) => {
    if (gameState.phase !== 'running') return;
    if (gameState.votes[socket.id] === optionId) {
      gameState.votes[socket.id] = null;
      socket.emit('vote:ack', { currentVote: null });
    }
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    delete gameState.votes[socket.id];
    adminSockets.delete(socket.id);
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Loopsense server running on http://localhost:${PORT}`);
});
