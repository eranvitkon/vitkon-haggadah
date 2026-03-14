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
// uploads/ sits at the repo root — no conflict with any existing files/folders
const UPLOADS_DIR = path.join(__dirname, 'uploads');
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
let connectedUsers = {};
let photoWall = [];

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
// Serve repo root directly: index.html and images/ are both at root level
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// ── Root route ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Upload photo ──────────────────────────────────────────────────────────────
app.post('/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const uploader = req.body.name || 'אורח';
  const avatarId = parseInt(req.body.avatarId) || 1;
  const pageId = req.body.pageId || 'general';
  const photoEntry = {
    url: '/uploads/' + req.file.filename,
    uploadedBy: uploader,
    avatarId: avatarId,
    pageId: pageId,
    timestamp: new Date().toISOString()
  };
  photoWall.push(photoEntry);
  broadcastState();
  res.json({ ok: true, photo: photoEntry });
});

// ── Admin reset ───────────────────────────────────────────────────────────────
app.get('/reset', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  fs.readdirSync(UPLOADS_DIR).forEach(file => {
    fs.unlinkSync(path.join(UPLOADS_DIR, file));
  });
  photoWall = [];
  broadcast({ type: 'force_logout' });
  connectedUsers = {};
  res.json({ ok: true, message: 'Reset complete — all users logged out, photos deleted' });
});

// ── State endpoint ────────────────────────────────────────────────────────────
app.get('/state', (req, res) => {
  res.json({ users: Object.values(connectedUsers), photos: photoWall });
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
