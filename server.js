const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'vitkon2025';

// ── Storage ──────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── In-memory state ───────────────────────────────────────────────────────────
let connectedUsers = {};   // socketId → { name, avatar, joinedAt }
let photoWall = [];        // [{ url, uploadedBy, timestamp }]

// ── Helpers ───────────────────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function broadcastState() {
  broadcast({
    type: 'state',
    users: Object.values(connectedUsers),
    photos: photoWall
  });
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── REST: upload photo ────────────────────────────────────────────────────────
app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const uploader = req.body.name || 'אורח';
  const photoEntry = {
    url: '/uploads/' + req.file.filename,
    uploadedBy: uploader,
    timestamp: new Date().toISOString()
  };
  photoWall.push(photoEntry);
  broadcastState();
  res.json({ ok: true, photo: photoEntry });
});

// ── REST: admin reset ─────────────────────────────────────────────────────────
app.get('/reset', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  // Delete uploaded photos
  fs.readdirSync(UPLOADS_DIR).forEach(file => {
    fs.unlinkSync(path.join(UPLOADS_DIR, file));
  });
  photoWall = [];

  // Force all clients to log out
  broadcast({ type: 'force_logout' });
  connectedUsers = {};

  res.json({ ok: true, message: 'Reset complete — all users logged out, photos deleted' });
});

// ── REST: current state (for reconnect) ───────────────────────────────────────
app.get('/state', (req, res) => {
  res.json({
    users: Object.values(connectedUsers),
    photos: photoWall
  });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const socketId = Date.now() + '-' + Math.random().toString(36).slice(2);
  ws.socketId = socketId;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'login') {
      connectedUsers[socketId] = {
        id: socketId,
        name: msg.name,
        avatar: msg.avatar,
        joinedAt: new Date().toISOString()
      };
      broadcastState();
    }

    if (msg.type === 'logout') {
      delete connectedUsers[socketId];
      broadcastState();
    }
  });

  ws.on('close', () => {
    delete connectedUsers[socketId];
    broadcastState();
  });

  // Send current state on connect
  ws.send(JSON.stringify({
    type: 'state',
    users: Object.values(connectedUsers),
    photos: photoWall
  }));
});

server.listen(PORT, () => {
  console.log(`✡  Vitkon Haggadah running on http://localhost:${PORT}`);
  console.log(`🔑  Admin reset: http://localhost:${PORT}/reset?key=${ADMIN_KEY}`);
});
