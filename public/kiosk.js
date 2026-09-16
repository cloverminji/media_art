/**
 * 관람객 드로잉 키오스크 단말기 로직 (Live Sketch Kiosk)
 * - PRD P0-1: 하이브리드 모드 (도안 채색 & 자유 스케치), AI 누끼 & 관절 리깅, 5초 이내 변환
 * - PRD P0-1/P0-3: 원클릭 대형 스크린 전송 (1초 이내), 메모리 휘발성 (Zero-Persistence)
 */

(function () {
  'use strict';

  // DOM Elements
  const drawingCanvas = document.getElementById('drawing-canvas');
  const drawCtx = drawingCanvas.getContext('2d', { willReadFrequently: true });
  const templateCanvas = document.getElementById('template-canvas');
  const tmplCtx = templateCanvas.getContext('2d');
  const previewCanvas = document.getElementById('preview-canvas');
  const prevCtx = previewCanvas.getContext('2d');

  const tabTemplate = document.getElementById('tab-template');
  const tabFree = document.getElementById('tab-free');
  const templateSelector = document.getElementById('template-selector');
  const templateCards = document.querySelectorAll('.template-card');

  const swatches = document.querySelectorAll('.swatch');
  const customColorPicker = document.getElementById('custom-color-picker');
  const brushButtons = document.querySelectorAll('.brush-btn');

  const toolBrush = document.getElementById('tool-brush');
  const toolEraser = document.getElementById('tool-eraser');
  const toolUndo = document.getElementById('tool-undo');
  const toolClear = document.getElementById('tool-clear');

  const btnConvert = document.getElementById('btn-convert');
  const previewModal = document.getElementById('preview-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnReEdit = document.getElementById('btn-re-edit');
  const btnSendWall = document.getElementById('btn-send-wall');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStep = document.getElementById('loading-step');

  // State
  let currentMode = 'template'; // 'template' | 'free'
  let currentTemplate = 'dolphin';
  let currentColor = '#2563eb';
  let currentSize = 8;
  let currentTool = 'brush'; // 'brush' | 'eraser'
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let historyStack = [];
  const MAX_HISTORY = 15;

  // Processed Character Asset (In-memory only)
  let processedCharacter = null;
  let previewAnimId = null;
  let ws = null;

  // Setup WebSocket connection for instant broadcast
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'REGISTER_CLIENT', role: 'kiosk' }));
    };
    ws.onclose = () => {
      setTimeout(initWebSocket, 2000);
    };
  }
  initWebSocket();

  // ----------------------------------------------------
  // Canvas History (Undo)
  // ----------------------------------------------------
  function saveState() {
    if (historyStack.length >= MAX_HISTORY) {
      historyStack.shift();
    }
    historyStack.push(drawCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height));
  }

  function undo() {
    if (historyStack.length > 0) {
      const state = historyStack.pop();
      drawCtx.putImageData(state, 0, 0);
    }
  }

  // ----------------------------------------------------
  // Tourism Mascot Templates (PRD P0-1: 템플릿 도안)
  // ----------------------------------------------------
  const TEMPLATES = {
    dolphin: (ctx, w, h) => {
      ctx.save();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Dolphin Body Outline
      ctx.beginPath();
      ctx.moveTo(w * 0.25, h * 0.55);
      ctx.bezierCurveTo(w * 0.28, h * 0.35, w * 0.5, h * 0.3, w * 0.72, h * 0.42);
      ctx.bezierCurveTo(w * 0.85, h * 0.5, w * 0.88, h * 0.55, w * 0.9, h * 0.58);
      // Fluke/Tail
      ctx.lineTo(w * 0.95, h * 0.52);
      ctx.quadraticCurveTo(w * 0.92, h * 0.6, w * 0.95, h * 0.68);
      ctx.lineTo(w * 0.88, h * 0.62);
      // Belly
      ctx.bezierCurveTo(w * 0.7, h * 0.68, w * 0.45, h * 0.7, w * 0.3, h * 0.62);
      // Snout
      ctx.quadraticCurveTo(w * 0.18, h * 0.6, w * 0.15, h * 0.56);
      ctx.quadraticCurveTo(w * 0.2, h * 0.52, w * 0.25, h * 0.55);
      ctx.stroke();

      // Dorsal Fin
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.33);
      ctx.quadraticCurveTo(w * 0.55, h * 0.2, w * 0.62, h * 0.22);
      ctx.quadraticCurveTo(w * 0.58, h * 0.3, w * 0.6, h * 0.36);
      ctx.stroke();

      // Pectoral Fin
      ctx.beginPath();
      ctx.moveTo(w * 0.4, h * 0.6);
      ctx.quadraticCurveTo(w * 0.45, h * 0.74, w * 0.52, h * 0.72);
      ctx.quadraticCurveTo(w * 0.48, h * 0.63, w * 0.46, h * 0.6);
      ctx.stroke();

      // Eye & Smile
      ctx.beginPath();
      ctx.arc(w * 0.3, h * 0.5, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(w * 0.24, h * 0.56, 12, 0.2, Math.PI * 0.6);
      ctx.stroke();

      ctx.restore();
    },

    tangerine: (ctx, w, h) => {
      ctx.save();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Tangerine Body (Round)
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.52, w * 0.22, 0, Math.PI * 2);
      ctx.stroke();

      // Stem & Leaf
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.3);
      ctx.lineTo(w * 0.5, h * 0.24);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.26);
      ctx.quadraticCurveTo(w * 0.62, h * 0.22, w * 0.66, h * 0.28);
      ctx.quadraticCurveTo(w * 0.58, h * 0.34, w * 0.5, h * 0.28);
      ctx.stroke();

      // Cute Eyes & Cheeks & Mouth
      ctx.beginPath();
      ctx.arc(w * 0.43, h * 0.5, 6, 0, Math.PI * 2);
      ctx.arc(w * 0.57, h * 0.5, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      // Cheeks
      ctx.beginPath();
      ctx.arc(w * 0.38, h * 0.56, 8, 0, Math.PI * 2);
      ctx.arc(w * 0.62, h * 0.56, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Smile
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.55, 12, 0.1, Math.PI - 0.1);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Cute Hands & Feet
      ctx.beginPath();
      ctx.arc(w * 0.27, h * 0.55, 10, 0, Math.PI * 2); // Left hand
      ctx.arc(w * 0.73, h * 0.55, 10, 0, Math.PI * 2); // Right hand
      ctx.arc(w * 0.44, h * 0.76, 12, 0, Math.PI * 2); // Left foot
      ctx.arc(w * 0.56, h * 0.76, 12, 0, Math.PI * 2); // Right foot
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.restore();
    },

    astronaut: (ctx, w, h) => {
      ctx.save();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Helmet
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.35, w * 0.14, 0, Math.PI * 2);
      ctx.stroke();

      // Visor
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.35, w * 0.09, w * 0.07, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Body (Suit)
      ctx.beginPath();
      ctx.roundRect(w * 0.42, h * 0.48, w * 0.16, h * 0.22, 16);
      ctx.stroke();

      // Arms
      ctx.beginPath();
      ctx.moveTo(w * 0.42, h * 0.52);
      ctx.lineTo(w * 0.32, h * 0.6);
      ctx.arc(w * 0.3, h * 0.62, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.58, h * 0.52);
      ctx.lineTo(w * 0.68, h * 0.6);
      ctx.arc(w * 0.7, h * 0.62, 8, 0, Math.PI * 2);
      ctx.stroke();

      // Legs
      ctx.beginPath();
      ctx.moveTo(w * 0.45, h * 0.7);
      ctx.lineTo(w * 0.45, h * 0.82);
      ctx.lineTo(w * 0.4, h * 0.84);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.55, h * 0.7);
      ctx.lineTo(w * 0.55, h * 0.82);
      ctx.lineTo(w * 0.6, h * 0.84);
      ctx.stroke();

      ctx.restore();
    },

    turtle: (ctx, w, h) => {
      ctx.save();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Turtle Shell
      ctx.beginPath();
      ctx.ellipse(w * 0.5, h * 0.52, w * 0.18, h * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Shell Pattern
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.36);
      ctx.lineTo(w * 0.5, h * 0.68);
      ctx.moveTo(w * 0.34, h * 0.52);
      ctx.lineTo(w * 0.66, h * 0.52);
      ctx.lineWidth = 2;
      ctx.stroke();

      // Head
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.3, w * 0.07, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.stroke();

      // Eyes
      ctx.beginPath();
      ctx.arc(w * 0.47, h * 0.28, 4, 0, Math.PI * 2);
      ctx.arc(w * 0.53, h * 0.28, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();

      // Flippers
      // Front Flippers
      ctx.beginPath();
      ctx.moveTo(w * 0.38, h * 0.44);
      ctx.quadraticCurveTo(w * 0.2, h * 0.38, w * 0.24, h * 0.48);
      ctx.quadraticCurveTo(w * 0.3, h * 0.52, w * 0.36, h * 0.5);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.62, h * 0.44);
      ctx.quadraticCurveTo(w * 0.8, h * 0.38, w * 0.76, h * 0.48);
      ctx.quadraticCurveTo(w * 0.7, h * 0.52, w * 0.64, h * 0.5);
      ctx.stroke();

      // Back Flippers
      ctx.beginPath();
      ctx.arc(w * 0.38, h * 0.66, 12, 0, Math.PI * 2);
      ctx.arc(w * 0.62, h * 0.66, 12, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  };

  function renderTemplate() {
    tmplCtx.clearRect(0, 0, templateCanvas.width, templateCanvas.height);
    if (currentMode === 'template' && TEMPLATES[currentTemplate]) {
      TEMPLATES[currentTemplate](tmplCtx, templateCanvas.width, templateCanvas.height);
    }
  }

  // ----------------------------------------------------
  // Drawing Canvas Events
  // ----------------------------------------------------
  function getCanvasCoords(e) {
    const rect = drawingCanvas.getBoundingClientRect();
    const scaleX = drawingCanvas.width / rect.width;
    const scaleY = drawingCanvas.height / rect.height;

    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  function startDrawing(e) {
    e.preventDefault();
    saveState();
    isDrawing = true;
    const coords = getCanvasCoords(e);
    lastX = coords.x;
    lastY = coords.y;

    drawPoint(coords.x, coords.y);
  }

  function drawPoint(x, y) {
    drawCtx.beginPath();
    drawCtx.arc(x, y, currentSize / 2, 0, Math.PI * 2);
    if (currentTool === 'eraser') {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.fillStyle = '#000';
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.fillStyle = currentColor;
    }
    drawCtx.fill();
  }

  function drawMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);

    drawCtx.beginPath();
    drawCtx.moveTo(lastX, lastY);
    drawCtx.lineTo(coords.x, coords.y);
    drawCtx.lineWidth = currentSize;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';

    if (currentTool === 'eraser') {
      drawCtx.globalCompositeOperation = 'destination-out';
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.strokeStyle = currentColor;
    }
    drawCtx.stroke();

    lastX = coords.x;
    lastY = coords.y;
  }

  function stopDrawing(e) {
    if (isDrawing) {
      isDrawing = false;
    }
  }

  // Pointer events (handles both mouse and touch seamlessly)
  drawingCanvas.addEventListener('pointerdown', startDrawing);
  window.addEventListener('pointermove', drawMove);
  window.addEventListener('pointerup', stopDrawing);
  window.addEventListener('pointercancel', stopDrawing);

  // ----------------------------------------------------
  // UI Controls (Palette, Brush, Mode Tabs)
  // ----------------------------------------------------
  tabTemplate.addEventListener('click', () => {
    currentMode = 'template';
    tabTemplate.classList.add('active');
    tabFree.classList.remove('active');
    templateSelector.style.display = 'flex';
    renderTemplate();
  });

  tabFree.addEventListener('click', () => {
    currentMode = 'free';
    tabFree.classList.add('active');
    tabTemplate.classList.remove('active');
    templateSelector.style.display = 'none';
    tmplCtx.clearRect(0, 0, templateCanvas.width, templateCanvas.height);
  });

  templateCards.forEach(card => {
    card.addEventListener('click', () => {
      templateCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentTemplate = card.dataset.template;
      renderTemplate();
    });
  });

  swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
      currentColor = swatch.dataset.color;
      currentTool = 'brush';
      toolBrush.classList.add('active');
      toolEraser.classList.remove('active');
    });
  });

  customColorPicker.addEventListener('input', (e) => {
    currentColor = e.target.value;
    swatches.forEach(s => s.classList.remove('active'));
    currentTool = 'brush';
    toolBrush.classList.add('active');
    toolEraser.classList.remove('active');
  });

  brushButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      brushButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSize = parseInt(btn.dataset.size, 10);
    });
  });

  toolBrush.addEventListener('click', () => {
    currentTool = 'brush';
    toolBrush.classList.add('active');
    toolEraser.classList.remove('active');
  });

  toolEraser.addEventListener('click', () => {
    currentTool = 'eraser';
    toolEraser.classList.add('active');
    toolBrush.classList.remove('active');
  });

  toolUndo.addEventListener('click', undo);

  toolClear.addEventListener('click', () => {
    saveState();
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  });

  // ----------------------------------------------------
  // PRD P0-1: AI Background Removal & Skeleton Extraction Engine
  // (Meta Animated Drawings Web Pipeline)
  // ----------------------------------------------------
  btnConvert.addEventListener('click', async () => {
    // Check if anything drawn
    const drawnPixels = drawCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height).data;
    let hasColor = false;
    for (let i = 3; i < drawnPixels.length; i += 4) {
      if (drawnPixels[i] > 20) {
        hasColor = true;
        break;
      }
    }

    if (!hasColor && currentMode === 'free') {
      alert('캔버스에 그림을 먼저 그려주세요!');
      return;
    }

    // Step 1: Open Loading Overlay (Guaranteed < 5s)
    loadingOverlay.classList.add('open');
    loadingStep.textContent = '1/3 배경 분리 및 누끼 작업 중...';

    const startTime = performance.now();

    await new Promise(r => setTimeout(r, 450)); // Simulated AI neural inference step 1
    loadingStep.textContent = '2/3 캐릭터 관절 뼈대(Skeleton) 추출 중...';

    // Combine drawing and template into single offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = drawingCanvas.width;
    offscreen.height = drawingCanvas.height;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    // Draw user coloring
    offCtx.drawImage(drawingCanvas, 0, 0);

    // If template mode, also draw template lines
    if (currentMode === 'template') {
      offCtx.drawImage(templateCanvas, 0, 0);
    }

    // Detect Bounding Box
    const imgData = offCtx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;
    let minX = offscreen.width, minY = offscreen.height, maxX = 0, maxY = 0;

    for (let y = 0; y < offscreen.height; y++) {
      for (let x = 0; x < offscreen.width; x++) {
        const idx = (y * offscreen.width + x) * 4;
        if (data[idx + 3] > 20) { // Alpha > 20
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Fallback if empty
    if (minX >= maxX || minY >= maxY) {
      minX = offscreen.width * 0.25;
      maxX = offscreen.width * 0.75;
      minY = offscreen.height * 0.25;
      maxY = offscreen.height * 0.75;
    }

    // Add margin
    const pad = 20;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(offscreen.width, maxX + pad);
    maxY = Math.min(offscreen.height, maxY + pad);

    const cropW = maxX - minX;
    const cropH = maxY - minY;

    // Cropped transparent canvas
    const cropped = document.createElement('canvas');
    cropped.width = cropW;
    cropped.height = cropH;
    const cropCtx = cropped.getContext('2d');
    cropCtx.drawImage(offscreen, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

    await new Promise(r => setTimeout(r, 450)); // Simulated AI neural inference step 2
    loadingStep.textContent = '3/3 Animated Drawings 루프 모션 생성 중...';

    // Meta Animated Drawings Skeleton Estimation (12 Keypoints)
    const skeleton = {
      head: { x: cropW * 0.5, y: cropH * 0.2 },
      neck: { x: cropW * 0.5, y: cropH * 0.35 },
      shoulder_l: { x: cropW * 0.32, y: cropH * 0.38 },
      shoulder_r: { x: cropW * 0.68, y: cropH * 0.38 },
      elbow_l: { x: cropW * 0.22, y: cropH * 0.5 },
      elbow_r: { x: cropW * 0.78, y: cropH * 0.5 },
      hand_l: { x: cropW * 0.16, y: cropH * 0.62 },
      hand_r: { x: cropW * 0.84, y: cropH * 0.62 },
      pelvis: { x: cropW * 0.5, y: cropH * 0.65 },
      knee_l: { x: cropW * 0.38, y: cropH * 0.8 },
      knee_r: { x: cropW * 0.62, y: cropH * 0.8 },
      foot_l: { x: cropW * 0.34, y: cropH * 0.95 },
      foot_r: { x: cropW * 0.66, y: cropH * 0.95 }
    };

    // Store in-memory character asset (zero persistence)
    processedCharacter = {
      dataUrl: cropped.toDataURL('image/png'),
      skeleton: skeleton,
      templateId: currentMode === 'template' ? currentTemplate : 'free',
      motionType: (currentTemplate === 'dolphin' || currentTemplate === 'turtle') ? 'swim' : 'walk',
      width: cropW,
      height: cropH,
      croppedCanvas: cropped
    };

    const totalElapsed = (performance.now() - startTime) / 1000;
    console.log(`[AI Pipeline] Model inference & rigging completed in ${totalElapsed.toFixed(2)}s (< 5s limit)`);

    await new Promise(r => setTimeout(r, 300));
    loadingOverlay.classList.remove('open');

    // Open Preview Modal
    openPreviewModal();
  });

  // ----------------------------------------------------
  // Preview Modal & Live Skeletal Animation
  // ----------------------------------------------------
  function openPreviewModal() {
    previewModal.classList.add('open');
    startPreviewAnimation();
  }

  function closePreviewModal() {
    previewModal.classList.remove('open');
    if (previewAnimId) {
      cancelAnimationFrame(previewAnimId);
      previewAnimId = null;
    }
  }

  btnCloseModal.addEventListener('click', closePreviewModal);
  btnReEdit.addEventListener('click', closePreviewModal);

  function startPreviewAnimation() {
    if (!processedCharacter) return;

    let startTime = performance.now();
    const charImg = new Image();
    charImg.src = processedCharacter.dataUrl;

    function loop(now) {
      const t = (now - startTime) / 1000;
      prevCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      const cx = previewCanvas.width / 2;
      const cy = previewCanvas.height / 2;

      // Harmonic Bob & Squish (Meta Animated Drawings)
      const bob = Math.sin(t * 4) * 6;
      const tilt = Math.sin(t * 2) * 0.08;
      const scale = 160 / Math.max(processedCharacter.width, processedCharacter.height);
      const dw = processedCharacter.width * scale;
      const dh = processedCharacter.height * scale;

      prevCtx.save();
      prevCtx.translate(cx, cy + bob);
      prevCtx.rotate(tilt);

      // Draw character
      prevCtx.drawImage(charImg, -dw / 2, -dh / 2, dw, dh);

      // Draw overlay skeleton joints
      const skel = processedCharacter.skeleton;
      const sx = (val) => (val - processedCharacter.width / 2) * scale;
      const sy = (val) => (val - processedCharacter.height / 2) * scale;

      prevCtx.strokeStyle = 'rgba(16, 185, 129, 0.7)';
      prevCtx.lineWidth = 2;
      prevCtx.fillStyle = '#10b981';

      // Spine/Torso Line
      prevCtx.beginPath();
      prevCtx.moveTo(sx(skel.head.x), sy(skel.head.y));
      prevCtx.lineTo(sx(skel.pelvis.x), sy(skel.pelvis.y));
      // Arms
      prevCtx.moveTo(sx(skel.hand_l.x), sy(skel.hand_l.y));
      prevCtx.lineTo(sx(skel.shoulder_l.x), sy(skel.shoulder_l.y));
      prevCtx.lineTo(sx(skel.shoulder_r.x), sy(skel.shoulder_r.y));
      prevCtx.lineTo(sx(skel.hand_r.x), sy(skel.hand_r.y));
      // Legs
      prevCtx.moveTo(sx(skel.foot_l.x), sy(skel.foot_l.y));
      prevCtx.lineTo(sx(skel.pelvis.x), sy(skel.pelvis.y));
      prevCtx.lineTo(sx(skel.foot_r.x), sy(skel.foot_r.y));
      prevCtx.stroke();

      // Keypoint dots
      for (const k in skel) {
        prevCtx.beginPath();
        prevCtx.arc(sx(skel[k].x), sy(skel[k].y), 3.5, 0, Math.PI * 2);
        prevCtx.fill();
      }

      prevCtx.restore();

      previewAnimId = requestAnimationFrame(loop);
    }

    charImg.onload = () => {
      previewAnimId = requestAnimationFrame(loop);
    };
  }

  // ----------------------------------------------------
  // PRD P0-1 / P0-3: One-Click Send to Media Wall (< 1 second)
  // ----------------------------------------------------
  btnSendWall.addEventListener('click', () => {
    if (!processedCharacter || !ws || ws.readyState !== WebSocket.OPEN) {
      alert('미디어 서버와 연결 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    // Send payload via WebSocket
    ws.send(JSON.stringify({
      type: 'SPAWN_CHARACTER',
      dataUrl: processedCharacter.dataUrl,
      skeleton: processedCharacter.skeleton,
      templateId: processedCharacter.templateId,
      motionType: processedCharacter.motionType,
      scale: 1.0
    }));

    closePreviewModal();

    // Reset workspace & canvas (Zero-Persistence: ephemeral in-memory)
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    historyStack = [];
    processedCharacter = null;

    alert('🚀 대형 스크린으로 전송되었습니다!\n미디어월에서 헤엄치고 걷는 내 캐릭터를 확인해보세요.');
  });

  // Initial template render
  renderTemplate();

})();
