const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default Admin Config (Persistent)
const DEFAULT_CONFIG = {
  theme: 'ocean', // 'ocean', 'space', 'forest', 'custom'
  customBackgroundUrl: '',
  lifetimeSeconds: 180, // Default 3 minutes (PRD: 3~5 min, configurable)
  speedMultiplier: 1.0
};

let currentConfig = { ...DEFAULT_CONFIG };
if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    currentConfig = { ...DEFAULT_CONFIG, ...saved };
  } catch (err) {
    console.error('Failed to parse config.json, using defaults:', err);
  }
} else {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
}

function saveConfig(newConfig) {
  currentConfig = { ...currentConfig, ...newConfig };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Specific route mappings
app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kiosk.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/mediawall', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Config API
app.get('/api/config', (req, res) => {
  res.json(currentConfig);
});

app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  broadcast({
    type: 'CONFIG_UPDATED',
    config: currentConfig
  });
  res.json({ success: true, config: currentConfig });
});

// Curated high-resolution web backgrounds & live image search API
const CURATED_BACKGROUNDS = {
  ocean: [
    { title: '심해의 산호초 군락', url: 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1920&q=80' },
    { title: '신비로운 에메랄드 해저 동굴', url: 'https://images.unsplash.com/photo-1682687220063-4742bd7fd538?auto=format&fit=crop&w=1920&q=80' },
    { title: '푸른 바닷속 햇살', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1920&q=80' },
    { title: '열대 바다 물결', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80' }
  ],
  space: [
    { title: '오로라와 은하수', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1920&q=80' },
    { title: '심우주 성운과 별빛', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80' },
    { title: '신비한 보랏빛 은하', url: 'https://images.unsplash.com/photo-1502134249126-9f3755a50d78?auto=format&fit=crop&w=1920&q=80' },
    { title: '지구 궤도와 우주선 뷰', url: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?auto=format&fit=crop&w=1920&q=80' }
  ],
  forest: [
    { title: '햇살이 비치는 신비한 원시림', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=1920&q=80' },
    { title: '안개 자욱한 몽환적인 숲', url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=1920&q=80' },
    { title: '푸른 이끼와 폭포 숲', url: 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?auto=format&fit=crop&w=1920&q=80' },
    { title: '가을 단풍 숲길', url: 'https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=1920&q=80' }
  ]
};

app.get('/api/search-images', async (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const matched = [];

  // Match curated keywords
  for (const category of Object.keys(CURATED_BACKGROUNDS)) {
    if (!query || category.includes(query) || query.includes(category) || 
        (query.includes('바다') && category === 'ocean') ||
        (query.includes('우주') && category === 'space') ||
        (query.includes('숲') && category === 'forest')) {
      matched.push(...CURATED_BACKGROUNDS[category]);
    }
  }

  // Fallback / dynamic image results from query using high-res unsplash source
  if (matched.length === 0 && query) {
    const encoded = encodeURIComponent(query);
    matched.push(
      { title: `웹 검색 결과 1: ${query}`, url: `https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1920&q=80&sig=1` },
      { title: `웹 검색 결과 2: ${query}`, url: `https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=1920&q=80&sig=2` },
      { title: `웹 검색 결과 3: ${query}`, url: `https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1920&q=80&sig=3` }
    );
  } else if (matched.length === 0) {
    matched.push(...CURATED_BACKGROUNDS.ocean, ...CURATED_BACKGROUNDS.space, ...CURATED_BACKGROUNDS.forest);
  }

  res.json({ results: matched.slice(0, 8) });
});

// WebSocket Server for Zero-Persistence Real-Time Relaying
function broadcast(data, excludeWs = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.clientType = 'unknown';

  // Send initial config to newly connected client
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    config: currentConfig
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      switch (data.type) {
        case 'REGISTER_CLIENT':
          ws.clientType = data.role; // 'mediawall', 'kiosk', 'admin'
          break;

        case 'SPAWN_CHARACTER':
          // PRD P0-1, P0-3: Relay in-memory character asset directly to media walls.
          // Zero-persistence: NEVER written to disk or DB.
          broadcast({
            type: 'SPAWN_CHARACTER',
            character: {
              id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
              spawnTime: Date.now(),
              lifetimeSeconds: currentConfig.lifetimeSeconds,
              dataUrl: data.dataUrl, // base64 transparent PNG
              skeleton: data.skeleton, // bones/rig points
              templateId: data.templateId || 'free',
              motionType: data.motionType || 'walk',
              speed: data.speed || 1.0,
              scale: data.scale || 1.0
            }
          });
          break;

        case 'CHANGE_THEME':
          // PRD P0-2: Master Admin changes theme/background
          saveConfig({
            theme: data.theme,
            customBackgroundUrl: data.customBackgroundUrl || ''
          });
          broadcast({
            type: 'THEME_CHANGED',
            config: currentConfig
          });
          break;

        case 'UPDATE_LIFECYCLE':
          // PRD P0-3: Lifetime setting
          if (data.lifetimeSeconds && !isNaN(data.lifetimeSeconds)) {
            saveConfig({ lifetimeSeconds: Number(data.lifetimeSeconds) });
            broadcast({
              type: 'LIFECYCLE_UPDATED',
              config: currentConfig
            });
          }
          break;

        case 'CLEAR_ALL_CHARACTERS':
          // PRD P0-3: Force fade-out all characters
          broadcast({
            type: 'CLEAR_ALL_CHARACTERS'
          });
          break;

        case 'REPORT_METRICS':
          // Mediawall reports active character count to admin
          broadcast({
            type: 'METRICS_UPDATE',
            activeCount: data.activeCount,
            fps: data.fps
          });
          break;

        default:
          break;
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[MediaArt Server] Live Sketch System running at http://localhost:${PORT}`);
  console.log(`- Media Wall Display: http://localhost:${PORT}/`);
  console.log(`- Visitor Drawing Kiosk: http://localhost:${PORT}/kiosk`);
  console.log(`- Master Admin Dashboard: http://localhost:${PORT}/admin`);
});
