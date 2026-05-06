# Loopsense

Real-time collective voting system inspired by swarm intelligence (bees, fish schools, starling murmurations).

Live at: **https://pandala.in/loopsense**

## Architecture

```
pandala.in/loopsense   (GitHub Pages → docs/)
        ↕ Socket.IO WebSocket
Your VPS               (Node.js → server/)
```

## Quick start

### Frontend (GitHub Pages)
- Repo Settings → Pages → Source: `docs/` folder
- Already live at `pandala.in/loopsense` once enabled

### Backend (VPS)
```bash
cd server
npm install
FRONTEND_ORIGIN=https://pandala.in PORT=3000 node server.js
```

### Connect them
Edit `docs/config.js` and set `BACKEND_URL` to your VPS address, then push.

## URLs
| Path | Description |
|---|---|
| `pandala.in/loopsense/` | Voter page |
| `pandala.in/loopsense/admin.html` | Admin control panel |
