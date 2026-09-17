const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const os = require('os');

const PORT = process.env.PORT || 3000;

// Determine writable data directory (Handle Vercel / AWS Lambda read-only environment)
let DATA_DIR = path.join(__dirname, 'data');
let isFilesystemWritable = true;

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const testPath = path.join(DATA_DIR, '.write_test');
  fs.writeFileSync(testPath, 'ok');
  fs.unlinkSync(testPath);
} catch (e) {
  // __dirname is read-only (e.g. Vercel Serverless /var/task) -> use os.tmpdir()
  DATA_DIR = path.join(os.tmpdir(), 'mediaart_data');
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not create temp data dir, using in-memory mode:', err);
    isFilesystemWritable = false;
  }
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

// Default Admin Config (Persistent)
const DEFAULT_CONFIG = {
  theme: 'ocean', // 'ocean', 'space', 'forest', 'custom'
  customBackgroundUrl: '',
  lifetimeSeconds: 180, // Default 3 minutes (PRD: 3~5 min, configurable)
  speedMultiplier: 1.0
};

let currentConfig = { ...DEFAULT_CONFIG };
try {
  const bundledConfig = path.join(__dirname, 'data', 'config.json');
  if (fs.existsSync(bundledConfig)) {
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(bundledConfig, 'utf-8')) };
  } else if (fs.existsSync(CONFIG_FILE)) {
    currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
  }
} catch (err) {
  console.warn('Config load fallback to defaults:', err.message);
}

function saveConfig(newConfig) {
  currentConfig = { ...currentConfig, ...newConfig };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write config to disk (in-memory mode active):', err.message);
  }
}

// ----------------------------------------------------
// Custom Coloring Templates Storage (PRD P0-1 & Admin Ext)
// ----------------------------------------------------
const DEFAULT_TEMPLATES = [
  { id: 'dolphin', name: '제주 돌고래', icon: '🐬', motionType: 'swim', isBuiltin: true },
  { id: 'tangerine', name: '감귤 요정', icon: '🍊', motionType: 'walk', isBuiltin: true },
  { id: 'astronaut', name: '우주 탐험가', icon: '🧑‍🚀', motionType: 'walk', isBuiltin: true },
  { id: 'turtle', name: '바다 거북이', icon: '🐢', motionType: 'swim', isBuiltin: true }
];

let customTemplates = [];
try {
  const bundledTemplates = path.join(__dirname, 'data', 'templates.json');
  if (fs.existsSync(bundledTemplates)) {
    customTemplates = JSON.parse(fs.readFileSync(bundledTemplates, 'utf-8'));
  } else if (fs.existsSync(TEMPLATES_FILE)) {
    customTemplates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
  }
} catch (err) {
  console.warn('Templates load fallback to empty custom array:', err.message);
  customTemplates = [];
}

function getCombinedTemplates() {
  return [...DEFAULT_TEMPLATES, ...customTemplates];
}

function saveCustomTemplates() {
  try {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(customTemplates, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not write templates to disk (in-memory mode active):', err.message);
  }
}

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
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

// Templates API
app.get('/api/templates', (req, res) => {
  res.json({ success: true, templates: getCombinedTemplates() });
});

app.post('/api/templates', (req, res) => {
  const { name, icon, motionType, imageUrl, dataUrl, svgData, image, skeleton } = req.body;
  let imageSource = imageUrl || dataUrl || image;

  if (!imageSource && svgData) {
    if (typeof svgData === 'string' && svgData.startsWith('data:')) {
      imageSource = svgData;
    } else {
      imageSource = 'data:image/svg+xml;utf8,' + encodeURIComponent(svgData);
    }
  }

  if (!name || !imageSource) {
    return res.status(400).json({ success: false, error: '도안 이름과 이미지 파일이 필요합니다.' });
  }

  const newTemplate = {
    id: 'tmpl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    name: name.trim(),
    icon: icon ? icon.trim() : '🎨',
    motionType: motionType || 'walk',
    imageUrl: imageSource,
    skeleton: skeleton || null,
    isBuiltin: false,
    createdAt: Date.now()
  };

  customTemplates.push(newTemplate);
  saveCustomTemplates();

  const allTemplates = getCombinedTemplates();
  broadcast({
    type: 'TEMPLATES_UPDATED',
    templates: allTemplates
  });

  res.json({ success: true, template: newTemplate, templates: allTemplates });
});

app.delete('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const initialLen = customTemplates.length;
  customTemplates = customTemplates.filter(t => t.id !== id);

  if (customTemplates.length === initialLen) {
    return res.status(404).json({ success: false, error: '해당 도안을 찾을 수 없거나 기본 제공 도안입니다.' });
  }

  saveCustomTemplates();
  const allTemplates = getCombinedTemplates();
  broadcast({
    type: 'TEMPLATES_UPDATED',
    templates: allTemplates
  });

  res.json({ success: true, templates: allTemplates });
});

// ----------------------------------------------------
// Character Spawning & Real-Time Sync API (Vercel Serverless + REST Fallback)
// ----------------------------------------------------
let spawnedCharactersQueue = [];

function pruneSpawnQueue() {
  const now = Date.now();
  spawnedCharactersQueue = spawnedCharactersQueue.filter(item => (now - item.timestamp) < 90000);
}

app.post('/api/spawn', (req, res) => {
  const characterData = req.body;
  if (!characterData || !characterData.dataUrl) {
    return res.status(400).json({ success: false, error: 'Character data with dataUrl is required' });
  }

  const charItem = {
    id: characterData.id || ('char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)),
    dataUrl: characterData.dataUrl,
    videoUrl: characterData.videoUrl || null,
    mediaType: characterData.mediaType || (characterData.dataUrl && characterData.dataUrl.startsWith('data:video/') ? 'video' : 'image'),
    skeleton: characterData.skeleton || null,
    templateId: characterData.templateId || 'custom',
    motionType: characterData.motionType || 'walk',
    scale: characterData.scale || 1.0,
    lifetimeSeconds: characterData.lifetimeSeconds || currentConfig.lifetimeSeconds || 180,
    timestamp: Date.now()
  };

  pruneSpawnQueue();
  spawnedCharactersQueue.push(charItem);

  // Broadcast to connected WebSocket clients (Local/VPS)
  broadcast({
    type: 'SPAWN_CHARACTER',
    character: charItem
  });

  res.json({ success: true, id: charItem.id });
});

app.get('/api/characters/poll', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  pruneSpawnQueue();
  const newCharacters = spawnedCharactersQueue.filter(item => item.timestamp > since);
  res.json({
    success: true,
    characters: newCharacters,
    config: currentConfig,
    serverTime: Date.now()
  });
});

app.post('/api/action', (req, res) => {
  const { action, payload } = req.body || {};
  if (action === 'CLEAR_ALL_CHARACTERS') {
    broadcast({ type: 'CLEAR_ALL_CHARACTERS' });
  } else if (action === 'SET_THEME' && payload && payload.theme) {
    saveConfig({ theme: payload.theme });
    broadcast({ type: 'THEME_CHANGED', theme: payload.theme });
  } else if (action === 'UPDATE_LIFECYCLE' && payload && payload.lifetimeSeconds) {
    saveConfig({ lifetimeSeconds: Number(payload.lifetimeSeconds) });
    broadcast({ type: 'LIFECYCLE_UPDATED', config: currentConfig });
  }
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

  // Send initial config and templates to newly connected client
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    config: currentConfig,
    templates: getCombinedTemplates()
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
              id: data.id || ('char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
              spawnTime: Date.now(),
              lifetimeSeconds: data.lifetimeSeconds || currentConfig.lifetimeSeconds,
              dataUrl: data.dataUrl, // base64 transparent PNG or video data
              videoUrl: data.videoUrl || null,
              mediaType: data.mediaType || (data.dataUrl && data.dataUrl.startsWith('data:video/') ? 'video' : 'image'),
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

// Express Error Handling Middleware for JSON payloads & Entity Too Large
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      success: false,
      error: '이미지 용량이 너무 큽니다. (최대 20MB)'
    });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: '올바르지 않은 JSON 요청 데이터입니다.'
    });
  }
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: '서버 내부 오류가 발생했습니다.' });
});

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`[MediaArt Server] Live Sketch System running at http://localhost:${PORT}`);
    console.log(`- Media Wall Display: http://localhost:${PORT}/`);
    console.log(`- Visitor Drawing Kiosk: http://localhost:${PORT}/kiosk`);
    console.log(`- Master Admin Dashboard: http://localhost:${PORT}/admin`);
  });
}

module.exports = app;

