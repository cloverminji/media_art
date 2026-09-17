/**
 * 실시간 인터랙티브 미디어월 렌더링 & 생명주기 관리 엔진 (MediaWall Canvas Engine)
 * - PRD P0-2: 다중 테마 및 웹 소싱 배경 실시간 전환 (새로고침 없는 즉각 반영)
 * - PRD P0-3: 캐릭터 자율 루프 애니메이션(60fps) 및 페이드아웃 생명주기 관리 (메모리 해제)
 */

(function () {
  'use strict';

  // DOM Elements
  const canvas = document.getElementById('mediawall-canvas');
  const ctx = canvas.getContext('2d');
  const bgLayer = document.getElementById('bg-layer');
  const ambientLayer = document.getElementById('ambient-particles');
  const hudTheme = document.getElementById('hud-theme');
  const hudCount = document.getElementById('hud-count');
  const hudFps = document.getElementById('hud-fps');
  const toastContainer = document.getElementById('toast-container');

  // State
  let characters = [];
  let ambientParticles = [];
  let currentTheme = 'ocean';
  let defaultLifetime = 180; // 3 minutes
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let currentFps = 60;
  let ws = null;

  // Resize canvas for crisp high-DPI displays
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);
  }
  window.addEventListener('resize', () => {
    resizeCanvas();
    initAmbientParticles();
  });
  resizeCanvas();

  // ----------------------------------------------------
  // PRD P0-2: Theme & Background Management
  // ----------------------------------------------------
  const THEME_NAMES = {
    ocean: '바다 (Ocean)',
    space: '우주 (Cosmos)',
    forest: '신비의 숲 (Forest)',
    custom: '웹 소싱 배경 (Custom)'
  };

  function applyTheme(config) {
    currentTheme = config.theme || 'ocean';
    document.body.className = `theme-${currentTheme}`;

    if (currentTheme === 'custom' && config.customBackgroundUrl) {
      bgLayer.style.backgroundImage = `url('${config.customBackgroundUrl}')`;
    } else {
      bgLayer.style.backgroundImage = '';
    }

    hudTheme.textContent = THEME_NAMES[currentTheme] || currentTheme;
    initAmbientParticles();
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>✨</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ----------------------------------------------------
  // Ambient Particles (Theme Atmosphere)
  // ----------------------------------------------------
  function initAmbientParticles() {
    ambientParticles = [];
    const count = currentTheme === 'space' ? 80 : 45;
    for (let i = 0; i < count; i++) {
      ambientParticles.push(createAmbientParticle(true));
    }
  }

  function createAmbientParticle(randomY = false) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return {
      x: Math.random() * w,
      y: randomY ? Math.random() * h : (currentTheme === 'ocean' ? h + 20 : Math.random() * h),
      size: Math.random() * 4 + 1.5,
      speedY: currentTheme === 'ocean' ? -(Math.random() * 1.5 + 0.5) : (Math.random() - 0.5) * 0.6,
      speedX: (Math.random() - 0.5) * 0.8,
      alpha: Math.random() * 0.6 + 0.2,
      pulse: Math.random() * Math.PI,
      color: currentTheme === 'ocean' ? 'rgba(125, 211, 252,' :
             currentTheme === 'space' ? 'rgba(236, 72, 153,' : 'rgba(134, 239, 172,'
    };
  }

  function updateAndDrawAmbient(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = 0; i < ambientParticles.length; i++) {
      const p = ambientParticles[i];
      p.x += p.speedX;
      p.y += p.speedY;
      p.pulse += dt * 2;

      // Wrap around
      if (p.y < -30) p.y = h + 20;
      if (p.y > h + 30) p.y = -20;
      if (p.x < -30) p.x = w + 20;
      if (p.x > w + 30) p.x = -20;

      const currentAlpha = p.alpha * (0.6 + 0.4 * Math.sin(p.pulse));
      ctx.fillStyle = `${p.color} ${currentAlpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ----------------------------------------------------
  // PRD P0-1 & P0-3: Character Simulation & Lifecycle
  // ----------------------------------------------------
  class LiveCharacter {
    constructor(data) {
      this.id = data.id;
      this.dataUrl = data.dataUrl;
      this.videoUrl = data.videoUrl || null;
      this.mediaType = data.mediaType || (typeof data.dataUrl === 'string' && (data.dataUrl.startsWith('data:video/') || data.dataUrl.includes('.mp4')) ? 'video' : 'image');
      this.isVideo = (this.mediaType === 'video') || !!this.videoUrl;
      this.skeleton = data.skeleton || null;
      this.motionType = data.motionType || (currentTheme === 'ocean' ? 'swim' : 'walk');
      this.lifetimeSeconds = data.lifetimeSeconds || defaultLifetime;
      this.age = 0; // seconds elapsed
      this.state = 'active'; // 'spawning', 'active', 'fading', 'dead'
      this.opacity = 0; // starts with fade-in

      // Motion & physics bounds
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.x = Math.random() * (w - 300) + 150;
      this.y = (this.motionType === 'swim' || currentTheme === 'ocean' || currentTheme === 'space') 
               ? Math.random() * (h - 300) + 150 
               : h - 180; // Walk along ground in forest/earth
      this.baseY = this.y;
      this.vx = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 55 + 45); // pixels per sec
      this.vy = 0;
      this.facing = this.vx >= 0 ? 1 : -1;
      this.phase = Math.random() * Math.PI * 2;

      this.imageLoaded = false;
      this.drawable = null;

      if (this.isVideo) {
        // HTML5 Video with Real-Time Offscreen Chroma-Key (Animated Drawings MP4)
        this.video = document.createElement('video');
        this.video.src = this.videoUrl || this.dataUrl;
        this.video.crossOrigin = 'anonymous';
        this.video.autoplay = true;
        this.video.loop = true;
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.setAttribute('webkit-playsinline', 'true');
        this.video.setAttribute('playsinline', 'true');
        this.video.setAttribute('muted', 'true');

        this.chromaCanvas = document.createElement('canvas');
        this.chromaCtx = this.chromaCanvas.getContext('2d', { willReadFrequently: true });

        const onVideoReady = () => {
          if (this.imageLoaded) return;
          const nw = this.video.videoWidth || 320;
          const nh = this.video.videoHeight || 320;
          this.width = 180 * (data.scale || 1.0);
          this.height = (nh / nw) * this.width;
          this.chromaCanvas.width = nw;
          this.chromaCanvas.height = nh;
          this.imageLoaded = true;
          this.video.play().catch(e => console.warn('Video autoplay:', e));
        };

        this.video.addEventListener('loadedmetadata', onVideoReady);
        this.video.addEventListener('canplay', onVideoReady);
        this.video.load();
      } else {
        // Static Image element loaded in memory (zero persistence)
        this.image = new Image();
        this.image.onload = () => {
          const nw = this.image.naturalWidth;
          const nh = this.image.naturalHeight;

          try {
            const testCanvas = document.createElement('canvas');
            testCanvas.width = nw;
            testCanvas.height = nh;
            const tCtx = testCanvas.getContext('2d', { willReadFrequently: true });
            tCtx.drawImage(this.image, 0, 0);
            const imgData = tCtx.getImageData(0, 0, nw, nh);
            const d = imgData.data;
            // Only remove background if outer corners are solid white AND not transparent
            const corners = [0, (nw - 1) * 4, ((nh - 1) * nw) * 4, ((nh * nw) - 1) * 4];
            const hasOpaqueCorners = corners.every(idx => d[idx + 3] > 200);
            const isWhiteBg = hasOpaqueCorners && corners.every(idx => d[idx] > 230 && d[idx + 1] > 230 && d[idx + 2] > 230);

            if (isWhiteBg) {
              for (let i = 0; i < d.length; i += 4) {
                if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 225) {
                  d[i + 3] = 0;
                }
              }
              tCtx.putImageData(imgData, 0, 0);
              this.drawable = testCanvas;
            } else {
              this.drawable = this.image;
            }
          } catch (e) {
            this.drawable = this.image;
          }

          this.imageLoaded = true;
          this.width = 160 * (data.scale || 1.0);
          this.height = (nh / nw) * this.width;
        };
        this.image.src = data.dataUrl;
      }
    }

    dispose() {
      if (this.video) {
        try {
          this.video.pause();
          this.video.src = '';
          this.video.load();
        } catch (e) {}
        this.video = null;
      }
      if (this.chromaCanvas) {
        this.chromaCanvas.width = 1;
        this.chromaCanvas.height = 1;
        this.chromaCanvas = null;
        this.chromaCtx = null;
      }
      this.drawable = null;
      this.image = null;
    }

    update(dt) {
      this.age += dt;
      const remaining = this.lifetimeSeconds - this.age;

      // Fade-in at start (0 to 1 over 0.8s)
      if (this.age < 0.8) {
        this.opacity = Math.min(1, this.age / 0.8);
      } else if (remaining <= 10) {
        // PRD P0-3: Smooth Fade-out in last 10 seconds before complete disposal
        this.state = 'fading';
        this.opacity = Math.max(0, remaining / 10.0);
      } else {
        this.opacity = 1.0;
        this.state = 'active';
      }

      if (remaining <= 0) {
        this.state = 'dead';
        return;
      }

      const w = window.innerWidth;
      const h = window.innerHeight;

      // Dynamic motion physics per motionType & theme
      this.phase += dt * 3.5;
      const ground = h - this.height - 40;

      if (this.motionType === 'dance_full' || this.motionType === 'dance') {
        // 1. 전신 댄스: 리드미컬 상하좌우 그루브, 비트 탄성 바운스
        this.x += this.vx * dt * 0.45;
        this.y = ground - Math.abs(Math.sin(this.phase * 1.6)) * 32;
      } else if (this.motionType === 'dance_lower') {
        // 2. 하체 댄스: 통통 튀는 스쿼트 앤 팝, 빠른 셔플 킥
        this.x += this.vx * dt * 0.65;
        const hop = Math.sin(this.phase * 2.2);
        this.y = ground - (hop > 0 ? hop * 35 : 0);
      } else if (this.motionType === 'funny') {
        // 3. 웃긴: 젤리 같은 비선형 왜곡, 뒤뚱거리는 코믹 바운스
        this.x += this.vx * dt * (0.8 + Math.sin(this.phase * 2.0) * 0.4);
        this.y = (ground - 20) - Math.abs(Math.sin(this.phase * 1.3)) * 45;
      } else if (this.motionType === 'swim' || (currentTheme === 'ocean' && !this.motionType)) {
        // 해양 자율 유영
        this.x += this.vx * dt;
        this.y = this.baseY + Math.sin(this.phase) * 35;
      } else if (this.motionType === 'space' || (currentTheme === 'space' && !this.motionType)) {
        // 무중력 유영
        this.x += this.vx * dt * 0.7;
        this.y = this.baseY + Math.cos(this.phase * 0.7) * 45;
      } else {
        // 4. 워킹 (walk, default): 안정적인 보행 주기
        this.x += this.vx * dt;
        this.y = ground - Math.abs(Math.sin(this.phase * 1.5)) * 24;
      }

      // Boundary bouncing
      if (this.x < 80) {
        this.x = 80;
        this.vx = Math.abs(this.vx);
        this.facing = 1;
      } else if (this.x > w - this.width - 80) {
        this.x = w - this.width - 80;
        this.vx = -Math.abs(this.vx);
        this.facing = -1;
      }
    }

    draw(ctx) {
      if (!this.imageLoaded || this.opacity <= 0) return;

      ctx.save();
      ctx.globalAlpha = this.opacity;

      const centerX = this.x + this.width / 2;
      const centerY = this.y + this.height / 2;

      ctx.translate(centerX, centerY);

      // Facing flip
      ctx.scale(this.facing, 1);

      // Articulated Motion Dynamics: tilt, bob, squash & stretch
      let tilt = 0;
      let bob = 0;
      let squishX = 1;
      let squishY = 1;

      if (this.motionType === 'dance_full' || this.motionType === 'dance') {
        tilt = Math.sin(this.phase * 1.4) * 0.16;
        bob = -Math.abs(Math.sin(this.phase * 2.8)) * 8;
        squishY = 1 + Math.sin(this.phase * 2.8) * 0.08;
        squishX = 1 - Math.sin(this.phase * 2.8) * 0.06;
      } else if (this.motionType === 'dance_lower') {
        tilt = Math.sin(this.phase * 1.8) * 0.10;
        const bounce = Math.max(0, Math.sin(this.phase * 2.5));
        bob = -bounce * 10;
        squishY = 1 - bounce * 0.12;
        squishX = 1 + bounce * 0.10;
      } else if (this.motionType === 'funny') {
        tilt = Math.sin(this.phase * 3.0) * 0.22 + Math.sin(this.phase * 0.8) * 0.12;
        bob = Math.sin(this.phase * 1.8) * 12;
        squishY = 1 + Math.sin(this.phase * 3.6) * 0.18;
        squishX = 1 - Math.sin(this.phase * 3.6) * 0.15;
      } else if (this.motionType === 'swim') {
        tilt = Math.sin(this.phase * 0.9) * 0.12;
        bob = Math.sin(this.phase * 1.8) * 6;
        squishY = 1 + Math.sin(this.phase * 1.8) * 0.04;
        squishX = 1 - Math.sin(this.phase * 1.8) * 0.03;
      } else {
        // walk
        tilt = (this.vx / 120) * 0.08 + Math.sin(this.phase * 0.8) * 0.07;
        bob = -Math.abs(Math.sin(this.phase * 2.4)) * 6;
        squishY = 1 + Math.sin(this.phase * 2.4) * 0.04;
        squishX = 1 - Math.sin(this.phase * 2.4) * 0.03;
      }

      ctx.rotate(tilt);

      // Draw shadow/glow under character
      ctx.save();
      ctx.scale(1, 0.25);
      const shadowGrad = ctx.createRadialGradient(0, this.height * 1.8, 5, 0, this.height * 1.8, this.width * 0.5);
      shadowGrad.addColorStop(0, 'rgba(0,0,0,0.35)');
      shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadowGrad;
      ctx.beginPath();
      ctx.arc(0, this.height * 1.8, this.width * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Render Character Graphic
      if (this.isVideo) {
        // Video frame with real-time chroma-key background removal
        if (this.video && this.video.readyState >= 2 && this.chromaCtx) {
          const cw = this.chromaCanvas.width;
          const ch = this.chromaCanvas.height;
          this.chromaCtx.drawImage(this.video, 0, 0, cw, ch);
          const imgData = this.chromaCtx.getImageData(0, 0, cw, ch);
          const d = imgData.data;
          const len = d.length;
          for (let i = 0; i < len; i += 4) {
            if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) {
              d[i + 3] = 0;
            }
          }
          this.chromaCtx.putImageData(imgData, 0, 0);

          ctx.drawImage(
            this.chromaCanvas,
            (-this.width / 2) * squishX,
            (-this.height / 2 + bob) * squishY,
            this.width * squishX,
            this.height * squishY
          );
        }
      } else {
        // High-definition Drawing Image
        ctx.drawImage(
          this.drawable || this.image,
          (-this.width / 2) * squishX,
          (-this.height / 2 + bob) * squishY,
          this.width * squishX,
          this.height * squishY
        );
      }

      // Subtle skeletal glow during entrance (first 2.5 seconds) to highlight custom rigging
      if (this.age < 2.5 && this.skeleton) {
        const glowAlpha = Math.max(0, (2.5 - this.age) / 2.5) * 0.6;
        const scaleX = this.width / ((this.image && this.image.naturalWidth) || this.width);
        const scaleY = this.height / ((this.image && this.image.naturalHeight) || this.height);

        ctx.save();
        ctx.globalAlpha = this.opacity * glowAlpha;
        ctx.translate(-this.width / 2, -this.height / 2 + bob);

        const skel = this.skeleton;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';

        // Connect spine
        if (skel.head && skel.pelvis) {
          ctx.beginPath();
          ctx.moveTo(skel.head.x * scaleX, skel.head.y * scaleY);
          ctx.lineTo(skel.pelvis.x * scaleX, skel.pelvis.y * scaleY);
          ctx.stroke();
        }
        // Connect arms
        if (skel.hand_l && skel.shoulder_l && skel.shoulder_r && skel.hand_r) {
          ctx.beginPath();
          ctx.moveTo(skel.hand_l.x * scaleX, skel.hand_l.y * scaleY);
          ctx.lineTo(skel.shoulder_l.x * scaleX, skel.shoulder_l.y * scaleY);
          ctx.lineTo(skel.shoulder_r.x * scaleX, skel.shoulder_r.y * scaleY);
          ctx.lineTo(skel.hand_r.x * scaleX, skel.hand_r.y * scaleY);
          ctx.stroke();
        }
        // Connect legs
        if (skel.foot_l && skel.pelvis && skel.foot_r) {
          ctx.beginPath();
          ctx.moveTo(skel.foot_l.x * scaleX, skel.foot_l.y * scaleY);
          ctx.lineTo(skel.pelvis.x * scaleX, skel.pelvis.y * scaleY);
          ctx.lineTo(skel.foot_r.x * scaleX, skel.foot_r.y * scaleY);
          ctx.stroke();
        }

        // Joints
        ctx.fillStyle = '#38bdf8';
        for (const k in skel) {
          ctx.beginPath();
          ctx.arc(skel[k].x * scaleX, skel[k].y * scaleY, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.restore();
    }
  }

  // ----------------------------------------------------
  // Animation Loop (Solid 60 FPS Target)
  // ----------------------------------------------------
  function animate(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Calculate FPS
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 1.0) {
      currentFps = Math.round(frameCount / fpsTimer);
      hudFps.textContent = currentFps;
      frameCount = 0;
      fpsTimer = 0;

      // Report active metrics to admin
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'REPORT_METRICS',
          activeCount: characters.length,
          fps: currentFps
        }));
      }
    }

    // Clear Canvas
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Draw Ambient Particles
    updateAndDrawAmbient(dt);

    // Update & Draw Characters with Lifecycle Garbage Collection
    for (let i = characters.length - 1; i >= 0; i--) {
      const char = characters[i];
      char.update(dt);
      if (char.state === 'dead') {
        char.dispose();
        characters.splice(i, 1);
      } else {
        char.draw(ctx);
      }
    }

    hudCount.textContent = characters.length;

    requestAnimationFrame(animate);
  }

  // ----------------------------------------------------
  // Multi-Channel Real-Time Sync Engine (Vercel Serverless + Local WebSocket)
  // ----------------------------------------------------
  const spawnedCharIds = new Set();

  function handleIncomingAction(data) {
    if (!data) return;

    switch (data.type) {
      case 'INIT_STATE':
        if (data.config) {
          defaultLifetime = data.config.lifetimeSeconds || 180;
          applyTheme(data.config);
        }
        break;

      case 'SPAWN_CHARACTER':
        // PRD P0-1: Immediate spawn on Media Wall (< 1 second)
        const charData = data.character || data;
        if (charData && charData.dataUrl) {
          const cid = charData.id || ('char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
          if (spawnedCharIds.has(cid)) return; // Prevent duplicate spawn across multiple channels
          spawnedCharIds.add(cid);

          const char = new LiveCharacter({
            ...charData,
            id: cid,
            lifetimeSeconds: charData.lifetimeSeconds || defaultLifetime
          });
          characters.push(char);
          showToast('새로운 드로잉 캐릭터가 미디어월에 등장했습니다!');
        }
        break;

      case 'THEME_CHANGED':
      case 'CONFIG_UPDATED':
        // PRD P0-2: Real-time theme change without reload
        if (data.config) {
          applyTheme(data.config);
          showToast(`테마가 '${THEME_NAMES[data.config.theme] || data.config.theme}'(으)로 변경되었습니다.`);
        } else if (data.theme) {
          applyTheme({ theme: data.theme });
          showToast(`테마가 '${THEME_NAMES[data.theme] || data.theme}'(으)로 변경되었습니다.`);
        }
        break;

      case 'LIFECYCLE_UPDATED':
        const newLifetime = (data.config && data.config.lifetimeSeconds) || data.lifetimeSeconds;
        if (newLifetime) {
          defaultLifetime = newLifetime;
          characters.forEach(c => {
            c.lifetimeSeconds = defaultLifetime;
          });
          showToast(`캐릭터 수명이 ${defaultLifetime}초로 업데이트되었습니다.`);
        }
        break;

      case 'CLEAR_ALL_CHARACTERS':
        // Fast fade out for all active characters
        characters.forEach(c => {
          c.age = Math.max(c.age, c.lifetimeSeconds - 3); // trigger fade-out in 3s
        });
        showToast('모든 캐릭터 퇴장 프로세스를 시작합니다.');
        break;
    }
  }

  // 1. BroadcastChannel (Instant 0ms peer-to-peer across tabs on the same machine/browser)
  let syncChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel('mediaart_live_sync');
      syncChannel.onmessage = (event) => {
        handleIncomingAction(event.data);
      };
    } catch (e) {
      console.warn('BroadcastChannel not available:', e);
    }
  }

  // 2. WebSocket Connection (Local / Dedicated server with persistent WS)
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[MediaWall] WebSocket connected');
        ws.send(JSON.stringify({
          type: 'REGISTER_CLIENT',
          role: 'mediawall'
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleIncomingAction(data);
        } catch (e) {
          console.error('[MediaWall] Error parsing WS message:', e);
        }
      };

      ws.onerror = () => {
        // Silently ignore in serverless environment
      };

      ws.onclose = () => {
        setTimeout(initWebSocket, 5000);
      };
    } catch (e) {
      console.warn('[MediaWall] WebSocket skipped, using polling/BroadcastChannel:', e);
    }
  }

  // 3. HTTP Polling Fallback (For Vercel Serverless where WebSocket is not supported)
  let lastPollTime = Date.now();

  async function pollServerForUpdates() {
    const isWsOpen = ws && ws.readyState === WebSocket.OPEN;
    const pollInterval = isWsOpen ? 6000 : 1500;

    try {
      const res = await fetch(`/api/characters/poll?since=${lastPollTime}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.serverTime) {
            lastPollTime = data.serverTime;
          }
          if (data.config && data.config.theme && data.config.theme !== currentTheme) {
            applyTheme(data.config);
          }
          if (Array.isArray(data.characters)) {
            data.characters.forEach(c => {
              handleIncomingAction({
                type: 'SPAWN_CHARACTER',
                character: c
              });
            });
          }
        }
      }
    } catch (e) {
      // Silently ignore temporary network hiccups
    } finally {
      setTimeout(pollServerForUpdates, pollInterval);
    }
  }

  // Start System
  initAmbientParticles();
  initWebSocket();
  pollServerForUpdates();
  requestAnimationFrame(animate);

})();
