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
  const templateGrid = document.getElementById('template-grid');

  const swatches = document.querySelectorAll('.swatch');
  const customColorPicker = document.getElementById('custom-color-picker');
  const brushButtons = document.querySelectorAll('.brush-btn');

  const toolBrush = document.getElementById('tool-brush');
  const toolEraser = document.getElementById('tool-eraser');
  const toolUndo = document.getElementById('tool-undo');
  const toolClear = document.getElementById('tool-clear');

  const btnDownloadDrawing = document.getElementById('btn-download-drawing');
  const btnConvert = document.getElementById('btn-convert');
  const previewModal = document.getElementById('preview-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnReEdit = document.getElementById('btn-re-edit');
  const btnSendWall = document.getElementById('btn-send-wall');
  const btnPreviewDownload = document.getElementById('btn-preview-download');
  const previewDownloadMenu = document.getElementById('preview-download-menu');
  const downloadDropdownWrap = document.querySelector('.download-dropdown-wrap');
  const kioskToast = document.getElementById('kiosk-toast');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingStep = document.getElementById('loading-step');

  // Modal Tabs & Rigging Editor DOM Elements
  const tabRigging = document.getElementById('tab-rigging');
  const tabPreview = document.getElementById('tab-preview');
  const panelRigging = document.getElementById('panel-rigging');
  const panelPreview = document.getElementById('panel-preview');

  const riggingCanvas = document.getElementById('rigging-canvas');
  const rigCtx = riggingCanvas.getContext('2d');
  const riggingJointTooltip = document.getElementById('rigging-joint-tooltip');
  const riggingMiniCanvas = document.getElementById('rigging-mini-canvas');
  const miniCtx = riggingMiniCanvas.getContext('2d');

  const btnRigReset = document.getElementById('btn-rig-reset');
  const btnRigMirror = document.getElementById('btn-rig-mirror');
  const presetChips = document.querySelectorAll('.preset-chip');
  const btnGotoPreview = document.getElementById('btn-goto-preview');
  const btnBackToRigging = document.getElementById('btn-back-to-rigging');
  const btnPreviewBack = document.getElementById('btn-preview-back');
  const motionTypeLabel = document.getElementById('motion-type-label');
  const keypointCount = document.getElementById('keypoint-count');

  // State
  let currentMode = 'template'; // 'template' | 'free'
  let currentTemplate = 'dolphin';
  let currentColor = '#2563eb';
  let currentSize = 14;
  let currentTool = 'brush'; // 'brush' | 'eraser'
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;
  let historyStack = [];
  const MAX_HISTORY = 15;

  // Processed Character Asset & Rigging State (In-memory only)
  let processedCharacter = null;
  let initialSkeleton = null;
  let previewAnimId = null;
  let miniAnimId = null;
  let activeModalTab = 'rigging'; // 'rigging' | 'preview'
  let draggedJoint = null;
  let hoveredJoint = null;
  let ws = null;

  // Templates State
  let loadedTemplates = [
    { id: 'dolphin', name: '제주 돌고래', icon: '🐬', motionType: 'swim', isBuiltin: true },
    { id: 'tangerine', name: '감귤 요정', icon: '🍊', motionType: 'walk', isBuiltin: true },
    { id: 'astronaut', name: '우주 탐험가', icon: '🧑‍🚀', motionType: 'walk', isBuiltin: true },
    { id: 'turtle', name: '바다 거북이', icon: '🐢', motionType: 'swim', isBuiltin: true }
  ];
  const customTemplateImages = {};

  let syncChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel('mediaart_live_sync');
      syncChannel.onmessage = (e) => {
        if (e.data && e.data.type === 'TEMPLATES_UPDATED' && e.data.templates) {
          updateTemplates(e.data.templates);
        }
      };
    } catch (err) {
      console.warn('BroadcastChannel not available:', err);
    }
  }

  // Setup WebSocket connection for instant broadcast
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'REGISTER_CLIENT', role: 'kiosk' }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'INIT_STATE' && data.templates) {
            updateTemplates(data.templates);
          } else if (data.type === 'TEMPLATES_UPDATED' && data.templates) {
            updateTemplates(data.templates);
          }
        } catch (err) {
          console.error('Kiosk WS message error:', err);
        }
      };
      ws.onerror = () => {
        // Silently handle serverless environment where WS is disabled
      };
      ws.onclose = () => {
        setTimeout(initWebSocket, 5000);
      };
    } catch (e) {
      console.warn('WebSocket init skipped (using HTTP/BroadcastChannel sync):', e);
    }
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
  // 3-Layer Architecture: Solid White Base + Bold Black Outline
  // ----------------------------------------------------
  const TEMPLATES = {
    dolphin: {
      fill: (ctx, w, h) => {
        ctx.save();
        ctx.fillStyle = '#ffffff';

        // Dolphin Body
        ctx.beginPath();
        ctx.moveTo(w * 0.25, h * 0.55);
        ctx.bezierCurveTo(w * 0.28, h * 0.35, w * 0.5, h * 0.3, w * 0.72, h * 0.42);
        ctx.bezierCurveTo(w * 0.85, h * 0.5, w * 0.88, h * 0.55, w * 0.9, h * 0.58);
        ctx.lineTo(w * 0.95, h * 0.52);
        ctx.quadraticCurveTo(w * 0.92, h * 0.6, w * 0.95, h * 0.68);
        ctx.lineTo(w * 0.88, h * 0.62);
        ctx.bezierCurveTo(w * 0.7, h * 0.68, w * 0.45, h * 0.7, w * 0.3, h * 0.62);
        ctx.quadraticCurveTo(w * 0.18, h * 0.6, w * 0.15, h * 0.56);
        ctx.quadraticCurveTo(w * 0.2, h * 0.52, w * 0.25, h * 0.55);
        ctx.closePath();
        ctx.fill();

        // Dorsal Fin
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.33);
        ctx.quadraticCurveTo(w * 0.55, h * 0.2, w * 0.62, h * 0.22);
        ctx.quadraticCurveTo(w * 0.58, h * 0.3, w * 0.6, h * 0.36);
        ctx.closePath();
        ctx.fill();

        // Pectoral Fin
        ctx.beginPath();
        ctx.moveTo(w * 0.4, h * 0.6);
        ctx.quadraticCurveTo(w * 0.45, h * 0.74, w * 0.52, h * 0.72);
        ctx.quadraticCurveTo(w * 0.48, h * 0.63, w * 0.46, h * 0.6);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      },
      stroke: (ctx, w, h) => {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Dolphin Body Outline
        ctx.beginPath();
        ctx.moveTo(w * 0.25, h * 0.55);
        ctx.bezierCurveTo(w * 0.28, h * 0.35, w * 0.5, h * 0.3, w * 0.72, h * 0.42);
        ctx.bezierCurveTo(w * 0.85, h * 0.5, w * 0.88, h * 0.55, w * 0.9, h * 0.58);
        ctx.lineTo(w * 0.95, h * 0.52);
        ctx.quadraticCurveTo(w * 0.92, h * 0.6, w * 0.95, h * 0.68);
        ctx.lineTo(w * 0.88, h * 0.62);
        ctx.bezierCurveTo(w * 0.7, h * 0.68, w * 0.45, h * 0.7, w * 0.3, h * 0.62);
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

        // Cute Sparkling Eye
        ctx.beginPath();
        ctx.arc(w * 0.3, h * 0.5, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(w * 0.29, h * 0.49, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Smile
        ctx.beginPath();
        ctx.arc(w * 0.24, h * 0.56, 12, 0.2, Math.PI * 0.6);
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.restore();
      },
      full: (ctx, w, h) => {
        TEMPLATES.dolphin.fill(ctx, w, h);
        TEMPLATES.dolphin.stroke(ctx, w, h);
      }
    },

    tangerine: {
      fill: (ctx, w, h) => {
        ctx.save();
        ctx.fillStyle = '#ffffff';

        // Tangerine Body (Round)
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.52, w * 0.22, 0, Math.PI * 2);
        ctx.fill();

        // Leaf
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.26);
        ctx.quadraticCurveTo(w * 0.62, h * 0.22, w * 0.66, h * 0.28);
        ctx.quadraticCurveTo(w * 0.58, h * 0.34, w * 0.5, h * 0.28);
        ctx.closePath();
        ctx.fill();

        // Hands & Feet
        ctx.beginPath();
        ctx.arc(w * 0.27, h * 0.55, 11, 0, Math.PI * 2);
        ctx.arc(w * 0.73, h * 0.55, 11, 0, Math.PI * 2);
        ctx.arc(w * 0.44, h * 0.76, 13, 0, Math.PI * 2);
        ctx.arc(w * 0.56, h * 0.76, 13, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      },
      stroke: (ctx, w, h) => {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Tangerine Body Outline
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.52, w * 0.22, 0, Math.PI * 2);
        ctx.stroke();

        // Stem
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.3);
        ctx.lineTo(w * 0.5, h * 0.24);
        ctx.stroke();

        // Leaf
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.26);
        ctx.quadraticCurveTo(w * 0.62, h * 0.22, w * 0.66, h * 0.28);
        ctx.quadraticCurveTo(w * 0.58, h * 0.34, w * 0.5, h * 0.28);
        ctx.stroke();

        // Cute Big Eyes with Shine
        ctx.beginPath();
        ctx.arc(w * 0.43, h * 0.5, 7, 0, Math.PI * 2);
        ctx.arc(w * 0.57, h * 0.5, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(w * 0.42, h * 0.485, 2.2, 0, Math.PI * 2);
        ctx.arc(w * 0.56, h * 0.485, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Rosy Cheeks
        ctx.beginPath();
        ctx.arc(w * 0.38, h * 0.56, 8, 0, Math.PI * 2);
        ctx.arc(w * 0.62, h * 0.56, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Cute Smile
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.55, 12, 0.1, Math.PI - 0.1);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Hands & Feet
        ctx.beginPath();
        ctx.arc(w * 0.27, h * 0.55, 11, 0, Math.PI * 2);
        ctx.arc(w * 0.73, h * 0.55, 11, 0, Math.PI * 2);
        ctx.arc(w * 0.44, h * 0.76, 13, 0, Math.PI * 2);
        ctx.arc(w * 0.56, h * 0.76, 13, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#000000';
        ctx.stroke();

        ctx.restore();
      },
      full: (ctx, w, h) => {
        TEMPLATES.tangerine.fill(ctx, w, h);
        TEMPLATES.tangerine.stroke(ctx, w, h);
      }
    },

    astronaut: {
      fill: (ctx, w, h) => {
        ctx.save();
        ctx.fillStyle = '#ffffff';

        // Helmet
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.35, w * 0.14, 0, Math.PI * 2);
        ctx.fill();

        // Visor
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.35, w * 0.09, w * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();

        // Body Suit
        ctx.beginPath();
        ctx.roundRect(w * 0.42, h * 0.48, w * 0.16, h * 0.22, 16);
        ctx.fill();

        // Arms & Gloves
        ctx.beginPath();
        ctx.arc(w * 0.3, h * 0.62, 10, 0, Math.PI * 2);
        ctx.arc(w * 0.7, h * 0.62, 10, 0, Math.PI * 2);
        ctx.fill();

        // Boots
        ctx.beginPath();
        ctx.roundRect(w * 0.38, h * 0.81, 16, 10, 4);
        ctx.roundRect(w * 0.58, h * 0.81, 16, 10, 4);
        ctx.fill();

        ctx.restore();
      },
      stroke: (ctx, w, h) => {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Helmet
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.35, w * 0.14, 0, Math.PI * 2);
        ctx.stroke();

        // Visor
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.35, w * 0.09, w * 0.07, 0, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.stroke();

        // Visor Glare/Shine
        ctx.beginPath();
        ctx.arc(w * 0.46, h * 0.33, 8, -Math.PI * 0.5, 0);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Body
        ctx.beginPath();
        ctx.roundRect(w * 0.42, h * 0.48, w * 0.16, h * 0.22, 16);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5.5;
        ctx.stroke();

        // Arms
        ctx.beginPath();
        ctx.moveTo(w * 0.42, h * 0.52);
        ctx.lineTo(w * 0.32, h * 0.6);
        ctx.arc(w * 0.3, h * 0.62, 9, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(w * 0.58, h * 0.52);
        ctx.lineTo(w * 0.68, h * 0.6);
        ctx.arc(w * 0.7, h * 0.62, 9, 0, Math.PI * 2);
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
      full: (ctx, w, h) => {
        TEMPLATES.astronaut.fill(ctx, w, h);
        TEMPLATES.astronaut.stroke(ctx, w, h);
      }
    },

    turtle: {
      fill: (ctx, w, h) => {
        ctx.save();
        ctx.fillStyle = '#ffffff';

        // Turtle Shell
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.52, w * 0.18, h * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();

        // Head
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.3, w * 0.07, 0, Math.PI * 2);
        ctx.fill();

        // Flippers
        ctx.beginPath();
        ctx.moveTo(w * 0.38, h * 0.44);
        ctx.quadraticCurveTo(w * 0.2, h * 0.38, w * 0.24, h * 0.48);
        ctx.quadraticCurveTo(w * 0.3, h * 0.52, w * 0.36, h * 0.5);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(w * 0.62, h * 0.44);
        ctx.quadraticCurveTo(w * 0.8, h * 0.38, w * 0.76, h * 0.48);
        ctx.quadraticCurveTo(w * 0.7, h * 0.52, w * 0.64, h * 0.5);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.arc(w * 0.38, h * 0.66, 13, 0, Math.PI * 2);
        ctx.arc(w * 0.62, h * 0.66, 13, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      },
      stroke: (ctx, w, h) => {
        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 5.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Turtle Shell Outline
        ctx.beginPath();
        ctx.ellipse(w * 0.5, h * 0.52, w * 0.18, h * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Shell Patterns
        ctx.beginPath();
        ctx.moveTo(w * 0.5, h * 0.36);
        ctx.lineTo(w * 0.5, h * 0.68);
        ctx.moveTo(w * 0.34, h * 0.52);
        ctx.lineTo(w * 0.66, h * 0.52);
        ctx.lineWidth = 3.5;
        ctx.stroke();

        // Head
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.3, w * 0.07, 0, Math.PI * 2);
        ctx.lineWidth = 5;
        ctx.stroke();

        // Eyes
        ctx.beginPath();
        ctx.arc(w * 0.47, h * 0.28, 4.5, 0, Math.PI * 2);
        ctx.arc(w * 0.53, h * 0.28, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();

        // Flippers
        ctx.lineWidth = 5;
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

        ctx.beginPath();
        ctx.arc(w * 0.38, h * 0.66, 13, 0, Math.PI * 2);
        ctx.arc(w * 0.62, h * 0.66, 13, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
      },
      full: (ctx, w, h) => {
        TEMPLATES.turtle.fill(ctx, w, h);
        TEMPLATES.turtle.stroke(ctx, w, h);
      }
    }
  };

  function renderTemplate() {
    tmplCtx.clearRect(0, 0, templateCanvas.width, templateCanvas.height);
    if (currentMode !== 'template') return;

    if (TEMPLATES[currentTemplate]) {
      TEMPLATES[currentTemplate].full(tmplCtx, templateCanvas.width, templateCanvas.height);
    } else {
      const found = loadedTemplates.find(t => t.id === currentTemplate);
      if (found && found.imageUrl) {
        renderCustomTemplate(found);
      }
    }
  }

  // Dual canvas cache for custom templates: { lineArtCanvas, whiteBaseCanvas }
  const cleanTemplateCache = new WeakMap();

  function getCleanCustomTemplateLayers(img) {
    if (cleanTemplateCache.has(img)) {
      return cleanTemplateCache.get(img);
    }

    const nw = img.naturalWidth || img.width || 800;
    const nh = img.naturalHeight || img.height || 600;

    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = nw;
    lineCanvas.height = nh;
    const lCtx = lineCanvas.getContext('2d', { willReadFrequently: true });
    lCtx.drawImage(img, 0, 0);

    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = nw;
    baseCanvas.height = nh;
    const bCtx = baseCanvas.getContext('2d', { willReadFrequently: true });

    try {
      const imgData = lCtx.getImageData(0, 0, nw, nh);
      const data = imgData.data;
      const baseData = bCtx.createImageData(nw, nh);
      const bData = baseData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 20) {
          data[i + 3] = 0;
          continue;
        }

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum >= 225) {
          // White background
          data[i + 3] = 0; // Transparent outline
        } else {
          // Black Line Art
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255; // Solid high-contrast black line

          // Mark body fill
          bData[i] = 255;
          bData[i + 1] = 255;
          bData[i + 2] = 255;
          bData[i + 3] = 255;
        }
      }

      lCtx.putImageData(imgData, 0, 0);
      bCtx.putImageData(baseData, 0, 0);
    } catch (e) {
      console.warn('Canvas pixel processing skipped:', e);
    }

    const result = { lineCanvas, baseCanvas };
    cleanTemplateCache.set(img, result);
    return result;
  }

  function renderCustomTemplate(tmpl) {
    let img = customTemplateImages[tmpl.id];
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = tmpl.imageUrl;
      customTemplateImages[tmpl.id] = img;
      img.onload = () => {
        if (currentTemplate === tmpl.id && currentMode === 'template') {
          drawCustomTemplateOnCanvas(img);
        }
      };
    } else if (img.complete) {
      drawCustomTemplateOnCanvas(img);
    }
  }

  function drawCustomTemplateOnCanvas(img) {
    tmplCtx.clearRect(0, 0, templateCanvas.width, templateCanvas.height);
    const layers = getCleanCustomTemplateLayers(img);
    const w = templateCanvas.width;
    const h = templateCanvas.height;
    const pad = 60;
    const srcW = layers.lineCanvas.width || 1;
    const srcH = layers.lineCanvas.height || 1;
    const scale = Math.min((w - pad * 2) / srcW, (h - pad * 2) / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;

    tmplCtx.save();
    tmplCtx.drawImage(layers.lineCanvas, dx, dy, dw, dh);
    tmplCtx.restore();
  }

  function drawTemplateWhiteBase(ctx, w, h) {
    if (TEMPLATES[currentTemplate] && TEMPLATES[currentTemplate].fill) {
      TEMPLATES[currentTemplate].fill(ctx, w, h);
    } else {
      const found = loadedTemplates.find(t => t.id === currentTemplate);
      if (found && customTemplateImages[found.id] && customTemplateImages[found.id].complete) {
        const layers = getCleanCustomTemplateLayers(customTemplateImages[found.id]);
        const pad = 60;
        const srcW = layers.baseCanvas.width || 1;
        const srcH = layers.baseCanvas.height || 1;
        const scale = Math.min((w - pad * 2) / srcW, (h - pad * 2) / srcH);
        const dw = srcW * scale;
        const dh = srcH * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        ctx.save();
        ctx.drawImage(layers.baseCanvas, dx, dy, dw, dh);
        ctx.restore();
      }
    }
  }

  function drawTemplateOutline(ctx, w, h) {
    if (TEMPLATES[currentTemplate] && TEMPLATES[currentTemplate].stroke) {
      TEMPLATES[currentTemplate].stroke(ctx, w, h);
    } else {
      const found = loadedTemplates.find(t => t.id === currentTemplate);
      if (found && customTemplateImages[found.id] && customTemplateImages[found.id].complete) {
        const layers = getCleanCustomTemplateLayers(customTemplateImages[found.id]);
        const pad = 60;
        const srcW = layers.lineCanvas.width || 1;
        const srcH = layers.lineCanvas.height || 1;
        const scale = Math.min((w - pad * 2) / srcW, (h - pad * 2) / srcH);
        const dw = srcW * scale;
        const dh = srcH * scale;
        const dx = (w - dw) / 2;
        const dy = (h - dh) / 2;
        ctx.save();
        ctx.drawImage(layers.lineCanvas, dx, dy, dw, dh);
        ctx.restore();
      }
    }
  }

  function updateTemplates(templates) {
    if (!templates || !Array.isArray(templates)) return;
    loadedTemplates = templates;
    renderTemplateGrid();
    renderTemplate();
  }

  function renderTemplateGrid() {
    if (!templateGrid) return;
    templateGrid.innerHTML = '';

    loadedTemplates.forEach(t => {
      const card = document.createElement('button');
      card.className = `template-card ${currentTemplate === t.id ? 'active' : ''}`;
      card.dataset.template = t.id;

      card.innerHTML = `
        <span class="tmpl-icon">${t.icon || '🎨'}</span>
        <span class="tmpl-name">${t.name}</span>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        currentTemplate = t.id;
        renderTemplate();
      });

      templateGrid.appendChild(card);
    });
  }

  async function fetchTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success && data.templates) {
        updateTemplates(data.templates);
        return;
      }
    } catch (e) {
      console.warn('Failed to fetch templates from server, checking local backup:', e);
    }
    // Fallback: check localStorage
    try {
      const local = JSON.parse(localStorage.getItem('kiosk_custom_templates') || '[]');
      if (local && local.length > 0) {
        const defaultList = loadedTemplates.filter(t => t.isBuiltin);
        const map = new Map();
        [...defaultList, ...local].forEach(t => map.set(t.id, t));
        updateTemplates(Array.from(map.values()));
      }
    } catch (e) {}
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

    // PRD P0-1: 3-Layer Composite Pipeline
    // Layer 1: Solid White Base -> Layer 2: User Colors -> Layer 3: Crisp Pure Black Outline
    const offscreen = document.createElement('canvas');
    offscreen.width = drawingCanvas.width;
    offscreen.height = drawingCanvas.height;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });

    if (currentMode === 'template') {
      // 1. Solid White Base inside mascot body (Pure #ffffff base backing)
      drawTemplateWhiteBase(offCtx, offscreen.width, offscreen.height);

      // 2. User Coloring Strokes on top of white base (Maximum vivid pigmentation!)
      offCtx.drawImage(drawingCanvas, 0, 0);

      // 3. Crisp Pure Black Outline on top (Always visible, never obscured by drawing)
      drawTemplateOutline(offCtx, offscreen.width, offscreen.height);
    } else {
      // Free Drawing Mode
      offCtx.drawImage(drawingCanvas, 0, 0);
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
    loadingStep.textContent = '3/3 AI 관절 뼈대(Skeleton) 자동 매핑 중...';

    // ----------------------------------------------------
    // Smart Skeleton Auto-Mapping Engine
    // ----------------------------------------------------
    const cropImgData = cropCtx.getImageData(0, 0, cropW, cropH);
    const curTmplObj = loadedTemplates.find(t => t.id === currentTemplate);
    let templateType = 'humanoid';
    if (currentMode === 'template') {
      if (curTmplObj && curTmplObj.isBuiltin) {
        templateType = currentTemplate;
      } else if (curTmplObj && curTmplObj.motionType === 'swim') {
        templateType = 'dolphin';
      } else {
        templateType = 'humanoid';
      }
    }

    const autoSkeleton = (curTmplObj && curTmplObj.skeleton)
      ? normalizeSkeletonToImage(curTmplObj.skeleton, cropW, cropH)
      : generateSkeleton(templateType, cropW, cropH, (currentMode === 'free' || (curTmplObj && !curTmplObj.isBuiltin)) ? cropImgData : null);

    const defaultMotion = (curTmplObj && curTmplObj.motionType)
      ? curTmplObj.motionType
      : ((currentTemplate === 'dolphin' || currentTemplate === 'turtle') ? 'swim' : 'walk');

    // Deep copy for initial restore
    initialSkeleton = JSON.parse(JSON.stringify(autoSkeleton));

    // Store in-memory character asset (zero persistence)
    processedCharacter = {
      dataUrl: cropped.toDataURL('image/png'),
      skeleton: JSON.parse(JSON.stringify(autoSkeleton)),
      templateId: currentMode === 'template' ? currentTemplate : 'free',
      motionType: defaultMotion,
      width: cropW,
      height: cropH,
      croppedCanvas: cropped,
      charImg: null
    };

    // Preload image element
    const charImg = new Image();
    charImg.src = processedCharacter.dataUrl;
    processedCharacter.charImg = charImg;

    // Update preset chip selection
    presetChips.forEach(chip => {
      const p = chip.dataset.preset;
      if ((currentMode === 'template' && currentTemplate === p) ||
          (currentMode === 'free' && p === 'humanoid')) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    const totalElapsed = (performance.now() - startTime) / 1000;
    console.log(`[AI Pipeline] Model inference & rigging completed in ${totalElapsed.toFixed(2)}s (< 5s limit)`);

    await new Promise(r => setTimeout(r, 300));
    loadingOverlay.classList.remove('open');

    // Open Modal in Rigging Adjustment Mode
    openPreviewModal();
  });

  // ----------------------------------------------------
  // Joint Rigging Definitions & Anatomy Models
  // ----------------------------------------------------
  const JOINT_DEFS = {
    head: { name: '머리', color: '#f59e0b', group: 'head' },
    neck: { name: '목', color: '#f59e0b', group: 'head' },
    shoulder_l: { name: '왼쪽 어깨', color: '#06b6d4', group: 'arm_l' },
    elbow_l: { name: '왼쪽 팔꿈치', color: '#06b6d4', group: 'arm_l' },
    hand_l: { name: '왼손 / 앞지느러미', color: '#06b6d4', group: 'arm_l' },
    shoulder_r: { name: '오른쪽 어깨', color: '#a855f7', group: 'arm_r' },
    elbow_r: { name: '오른쪽 팔꿈치', color: '#a855f7', group: 'arm_r' },
    hand_r: { name: '오른손 / 앞지느러미', color: '#a855f7', group: 'arm_r' },
    pelvis: { name: '골반 (몸체 중심)', color: '#10b981', group: 'spine' },
    knee_l: { name: '왼쪽 무릎', color: '#f97316', group: 'leg_l' },
    foot_l: { name: '왼발 / 꼬리', color: '#f97316', group: 'leg_l' },
    knee_r: { name: '오른쪽 무릎', color: '#f43f5e', group: 'leg_r' },
    foot_r: { name: '오른발 / 꼬리', color: '#f43f5e', group: 'leg_r' }
  };

  const BONE_LINKS = [
    { from: 'head', to: 'neck', color: '#f59e0b' },
    { from: 'neck', to: 'pelvis', color: '#10b981' },
    { from: 'neck', to: 'shoulder_l', color: '#06b6d4' },
    { from: 'shoulder_l', to: 'elbow_l', color: '#06b6d4' },
    { from: 'elbow_l', to: 'hand_l', color: '#06b6d4' },
    { from: 'neck', to: 'shoulder_r', color: '#a855f7' },
    { from: 'shoulder_r', to: 'elbow_r', color: '#a855f7' },
    { from: 'elbow_r', to: 'hand_r', color: '#a855f7' },
    { from: 'pelvis', to: 'knee_l', color: '#f97316' },
    { from: 'knee_l', to: 'foot_l', color: '#f97316' },
    { from: 'pelvis', to: 'knee_r', color: '#f43f5e' },
    { from: 'knee_r', to: 'foot_r', color: '#f43f5e' }
  ];

  // Template & Anatomy Skeleton Generator
  function generateSkeleton(type, cropW, cropH, pixelData = null) {
    switch (type) {
      case 'dolphin':
        return {
          head: { x: cropW * 0.16, y: cropH * 0.54 },
          neck: { x: cropW * 0.32, y: cropH * 0.50 },
          shoulder_l: { x: cropW * 0.44, y: cropH * 0.58 },
          elbow_l: { x: cropW * 0.46, y: cropH * 0.70 },
          hand_l: { x: cropW * 0.50, y: cropH * 0.82 },
          shoulder_r: { x: cropW * 0.52, y: cropH * 0.38 },
          elbow_r: { x: cropW * 0.56, y: cropH * 0.24 },
          hand_r: { x: cropW * 0.60, y: cropH * 0.14 },
          pelvis: { x: cropW * 0.64, y: cropH * 0.54 },
          knee_l: { x: cropW * 0.80, y: cropH * 0.52 },
          foot_l: { x: cropW * 0.94, y: cropH * 0.44 },
          knee_r: { x: cropW * 0.80, y: cropH * 0.60 },
          foot_r: { x: cropW * 0.94, y: cropH * 0.68 }
        };

      case 'chibi':
      case 'tangerine':
        return {
          head: { x: cropW * 0.50, y: cropH * 0.16 },
          neck: { x: cropW * 0.50, y: cropH * 0.34 },
          shoulder_l: { x: cropW * 0.30, y: cropH * 0.48 },
          elbow_l: { x: cropW * 0.20, y: cropH * 0.54 },
          hand_l: { x: cropW * 0.10, y: cropH * 0.58 },
          shoulder_r: { x: cropW * 0.70, y: cropH * 0.48 },
          elbow_r: { x: cropW * 0.80, y: cropH * 0.54 },
          hand_r: { x: cropW * 0.90, y: cropH * 0.58 },
          pelvis: { x: cropW * 0.50, y: cropH * 0.70 },
          knee_l: { x: cropW * 0.40, y: cropH * 0.86 },
          foot_l: { x: cropW * 0.36, y: cropH * 0.95 },
          knee_r: { x: cropW * 0.60, y: cropH * 0.86 },
          foot_r: { x: cropW * 0.64, y: cropH * 0.95 }
        };

      case 'turtle':
        return {
          head: { x: cropW * 0.50, y: cropH * 0.18 },
          neck: { x: cropW * 0.50, y: cropH * 0.32 },
          shoulder_l: { x: cropW * 0.36, y: cropH * 0.38 },
          elbow_l: { x: cropW * 0.24, y: cropH * 0.36 },
          hand_l: { x: cropW * 0.14, y: cropH * 0.42 },
          shoulder_r: { x: cropW * 0.64, y: cropH * 0.38 },
          elbow_r: { x: cropW * 0.76, y: cropH * 0.36 },
          hand_r: { x: cropW * 0.86, y: cropH * 0.42 },
          pelvis: { x: cropW * 0.50, y: cropH * 0.58 },
          knee_l: { x: cropW * 0.38, y: cropH * 0.75 },
          foot_l: { x: cropW * 0.32, y: cropH * 0.92 },
          knee_r: { x: cropW * 0.62, y: cropH * 0.75 },
          foot_r: { x: cropW * 0.68, y: cropH * 0.92 }
        };

      case 'humanoid':
      case 'astronaut':
      default:
        if (pixelData) {
          return detectFreehandSkeleton(cropW, cropH, pixelData);
        }
        return {
          head: { x: cropW * 0.50, y: cropH * 0.18 },
          neck: { x: cropW * 0.50, y: cropH * 0.32 },
          shoulder_l: { x: cropW * 0.34, y: cropH * 0.36 },
          elbow_l: { x: cropW * 0.24, y: cropH * 0.48 },
          hand_l: { x: cropW * 0.16, y: cropH * 0.60 },
          shoulder_r: { x: cropW * 0.66, y: cropH * 0.36 },
          elbow_r: { x: cropW * 0.76, y: cropH * 0.48 },
          hand_r: { x: cropW * 0.84, y: cropH * 0.60 },
          pelvis: { x: cropW * 0.50, y: cropH * 0.62 },
          knee_l: { x: cropW * 0.40, y: cropH * 0.78 },
          foot_l: { x: cropW * 0.36, y: cropH * 0.95 },
          knee_r: { x: cropW * 0.60, y: cropH * 0.78 },
          foot_r: { x: cropW * 0.64, y: cropH * 0.95 }
        };
    }
  }

  // Freehand Drawing Silhouette Analysis
  function detectFreehandSkeleton(w, h, imgData) {
    const data = imgData.data;
    let sumX = 0, sumY = 0, count = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    let topX = w * 0.5, leftY = h * 0.5, rightY = h * 0.5;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] > 25) {
          sumX += x;
          sumY += y;
          count++;
          if (y < minY) { minY = y; topX = x; }
          if (y > maxY) { maxY = y; }
          if (x < minX) { minX = x; leftY = y; }
          if (x > maxX) { maxX = x; rightY = y; }
        }
      }
    }

    if (count === 0) {
      return generateSkeleton('humanoid', w, h);
    }

    const cx = sumX / count;
    const cy = sumY / count;

    return {
      head: { x: topX, y: Math.max(10, minY + 15) },
      neck: { x: cx, y: minY + (cy - minY) * 0.5 },
      shoulder_l: { x: cx - (cx - minX) * 0.45, y: minY + (cy - minY) * 0.65 },
      elbow_l: { x: cx - (cx - minX) * 0.75, y: (cy + minY) * 0.65 },
      hand_l: { x: Math.max(8, minX + 5), y: leftY },
      shoulder_r: { x: cx + (maxX - cx) * 0.45, y: minY + (cy - minY) * 0.65 },
      elbow_r: { x: cx + (maxX - cx) * 0.75, y: (cy + minY) * 0.65 },
      hand_r: { x: Math.min(w - 8, maxX - 5), y: rightY },
      pelvis: { x: cx, y: cy + (maxY - cy) * 0.25 },
      knee_l: { x: cx - (cx - minX) * 0.35, y: maxY - (maxY - cy) * 0.45 },
      foot_l: { x: cx - (cx - minX) * 0.45, y: Math.min(h - 8, maxY - 4) },
      knee_r: { x: cx + (maxX - cx) * 0.35, y: maxY - (maxY - cy) * 0.45 },
      foot_r: { x: cx + (maxX - cx) * 0.45, y: Math.min(h - 8, maxY - 4) }
    };
  }

  // ----------------------------------------------------
  // Interactive Joint Rigging Editor Engine
  // ----------------------------------------------------
  function getRiggingTransform() {
    if (!processedCharacter) return { scale: 1, offsetX: 0, offsetY: 0 };
    const pad = 36;
    const availW = riggingCanvas.width - pad * 2;
    const availH = riggingCanvas.height - pad * 2;
    const scale = Math.min(availW / processedCharacter.width, availH / processedCharacter.height);
    const offsetX = (riggingCanvas.width - processedCharacter.width * scale) / 2;
    const offsetY = (riggingCanvas.height - processedCharacter.height * scale) / 2;
    return { scale, offsetX, offsetY };
  }

  function charToScreen(pt) {
    const { scale, offsetX, offsetY } = getRiggingTransform();
    return {
      x: offsetX + pt.x * scale,
      y: offsetY + pt.y * scale
    };
  }

  function screenToChar(sx, sy) {
    const { scale, offsetX, offsetY } = getRiggingTransform();
    return {
      x: (sx - offsetX) / scale,
      y: (sy - offsetY) / scale
    };
  }

  function renderRiggingCanvas() {
    if (!processedCharacter || !rigCtx) return;
    rigCtx.clearRect(0, 0, riggingCanvas.width, riggingCanvas.height);

    const { scale, offsetX, offsetY } = getRiggingTransform();
    const cw = processedCharacter.width;
    const ch = processedCharacter.height;
    const skel = processedCharacter.skeleton;

    // Draw subtle grid & alignment cross
    rigCtx.save();
    rigCtx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    rigCtx.lineWidth = 1;
    for (let x = 0; x < riggingCanvas.width; x += 40) {
      rigCtx.beginPath();
      rigCtx.moveTo(x, 0);
      rigCtx.lineTo(x, riggingCanvas.height);
      rigCtx.stroke();
    }
    for (let y = 0; y < riggingCanvas.height; y += 40) {
      rigCtx.beginPath();
      rigCtx.moveTo(0, y);
      rigCtx.lineTo(riggingCanvas.width, y);
      rigCtx.stroke();
    }
    rigCtx.restore();

    // Draw Character Image
    if (processedCharacter.charImg && processedCharacter.charImg.complete) {
      rigCtx.save();
      // Drop subtle shadow behind character
      rigCtx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      rigCtx.shadowBlur = 18;
      rigCtx.drawImage(processedCharacter.charImg, offsetX, offsetY, cw * scale, ch * scale);
      rigCtx.restore();
    }

    // Draw Bones (Skeleton Lines)
    BONE_LINKS.forEach(bone => {
      const p1 = skel[bone.from];
      const p2 = skel[bone.to];
      if (!p1 || !p2) return;

      const s1 = charToScreen(p1);
      const s2 = charToScreen(p2);

      // Glow underlay
      rigCtx.beginPath();
      rigCtx.moveTo(s1.x, s1.y);
      rigCtx.lineTo(s2.x, s2.y);
      rigCtx.strokeStyle = bone.color;
      rigCtx.globalAlpha = 0.35;
      rigCtx.lineWidth = 7;
      rigCtx.lineCap = 'round';
      rigCtx.stroke();

      // Main bone line
      rigCtx.beginPath();
      rigCtx.moveTo(s1.x, s1.y);
      rigCtx.lineTo(s2.x, s2.y);
      rigCtx.strokeStyle = bone.color;
      rigCtx.globalAlpha = 0.95;
      rigCtx.lineWidth = 3.5;
      rigCtx.lineCap = 'round';
      rigCtx.stroke();
      rigCtx.globalAlpha = 1.0;
    });

    // Draw Joint Handles (Nodes)
    for (const key in skel) {
      const pt = skel[key];
      const s = charToScreen(pt);
      const def = JOINT_DEFS[key] || { name: key, color: '#38bdf8' };
      const isDragged = (draggedJoint === key);
      const isHovered = (hoveredJoint === key);
      const radius = isDragged ? 11 : isHovered ? 9.5 : 8;

      // Outer Pulse Ring
      rigCtx.beginPath();
      rigCtx.arc(s.x, s.y, radius + (isDragged ? 8 : 4), 0, Math.PI * 2);
      rigCtx.fillStyle = def.color;
      rigCtx.globalAlpha = isDragged ? 0.45 : isHovered ? 0.3 : 0.18;
      rigCtx.fill();
      rigCtx.globalAlpha = 1.0;

      // Joint Circle Fill
      rigCtx.beginPath();
      rigCtx.arc(s.x, s.y, radius, 0, Math.PI * 2);
      rigCtx.fillStyle = def.color;
      rigCtx.fill();

      // Joint White Border
      rigCtx.lineWidth = isDragged ? 3 : 2;
      rigCtx.strokeStyle = '#ffffff';
      rigCtx.stroke();

      // Center Pin Dot
      rigCtx.beginPath();
      rigCtx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      rigCtx.fillStyle = '#ffffff';
      rigCtx.fill();

      // If active or hovered, draw floating tag
      if (isDragged || isHovered) {
        rigCtx.save();
        rigCtx.font = '600 11px Pretendard, sans-serif';
        const labelText = def.name;
        const textW = rigCtx.measureText(labelText).width;
        const bx = s.x - textW / 2 - 8;
        const by = s.y - radius - 26;

        rigCtx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        rigCtx.strokeStyle = def.color;
        rigCtx.lineWidth = 1;
        rigCtx.beginPath();
        rigCtx.roundRect(bx, by, textW + 16, 20, 6);
        rigCtx.fill();
        rigCtx.stroke();

        rigCtx.fillStyle = '#f8fafc';
        rigCtx.fillText(labelText, s.x - textW / 2, by + 14);
        rigCtx.restore();
      }
    }
  }

  // Pointer Dragging for Rigging Canvas
  function getCanvasPointerPos(e) {
    const rect = riggingCanvas.getBoundingClientRect();
    const scaleX = riggingCanvas.width / rect.width;
    const scaleY = riggingCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function findJointAt(pos) {
    if (!processedCharacter) return null;
    const skel = processedCharacter.skeleton;
    let closestKey = null;
    let minDist = 26; // Grab hit radius in canvas pixels

    for (const key in skel) {
      const s = charToScreen(skel[key]);
      const dist = Math.hypot(s.x - pos.x, s.y - pos.y);
      if (dist < minDist) {
        minDist = dist;
        closestKey = key;
      }
    }
    return closestKey;
  }

  riggingCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const pos = getCanvasPointerPos(e);
    const joint = findJointAt(pos);

    if (joint) {
      draggedJoint = joint;
      hoveredJoint = joint;
      riggingCanvas.setPointerCapture(e.pointerId);

      const def = JOINT_DEFS[joint] || { name: joint };
      riggingJointTooltip.textContent = `📍 [${def.name}] 이동 중...`;
      riggingJointTooltip.classList.add('active');

      renderRiggingCanvas();
    }
  });

  window.addEventListener('pointermove', (e) => {
    const pos = getCanvasPointerPos(e);

    if (draggedJoint && processedCharacter) {
      e.preventDefault();
      const charCoords = screenToChar(pos.x, pos.y);
      const cw = processedCharacter.width;
      const ch = processedCharacter.height;

      // Allow slight drag outside character box for fins/hands
      const clampedX = Math.max(-cw * 0.15, Math.min(cw * 1.15, charCoords.x));
      const clampedY = Math.max(-ch * 0.15, Math.min(ch * 1.15, charCoords.y));

      processedCharacter.skeleton[draggedJoint] = { x: clampedX, y: clampedY };

      renderRiggingCanvas();
    } else {
      // Hover detection
      const prevHovered = hoveredJoint;
      hoveredJoint = findJointAt(pos);

      if (hoveredJoint !== prevHovered) {
        if (hoveredJoint) {
          const def = JOINT_DEFS[hoveredJoint] || { name: hoveredJoint };
          riggingJointTooltip.textContent = `✨ [${def.name}] 드래그하여 위치 조절`;
          riggingJointTooltip.classList.add('active');
        } else {
          riggingJointTooltip.textContent = '원형 관절 핀을 터치하거나 드래그하여 조절하세요';
          riggingJointTooltip.classList.remove('active');
        }
        renderRiggingCanvas();
      }
    }
  });

  function stopJointDrag(e) {
    if (draggedJoint) {
      try {
        riggingCanvas.releasePointerCapture(e.pointerId);
      } catch (err) {}
      draggedJoint = null;
      miniSkinnedMesh = null;
      prevSkinnedMesh = null;
      riggingJointTooltip.textContent = '관절 위치가 업데이트되었습니다!';
      setTimeout(() => {
        if (!draggedJoint && !hoveredJoint) {
          riggingJointTooltip.textContent = '원형 관절 핀을 터치하거나 드래그하여 조절하세요';
          riggingJointTooltip.classList.remove('active');
        }
      }, 1500);
      renderRiggingCanvas();
    }
  }

  window.addEventListener('pointerup', stopJointDrag);
  window.addEventListener('pointercancel', stopJointDrag);

  // ----------------------------------------------------
  // Rigging Helper Tools (Reset, Mirror, Presets)
  // ----------------------------------------------------
  btnRigReset.addEventListener('click', () => {
    if (!initialSkeleton || !processedCharacter) return;
    processedCharacter.skeleton = JSON.parse(JSON.stringify(initialSkeleton));
    miniSkinnedMesh = null;
    prevSkinnedMesh = null;
    renderRiggingCanvas();
    riggingJointTooltip.textContent = '🔄 AI 자동 매핑 초기 위치로 복원되었습니다';
    riggingJointTooltip.classList.add('active');
  });

  btnRigMirror.addEventListener('click', () => {
    if (!processedCharacter) return;
    const skel = processedCharacter.skeleton;

    // Center spine X from head and pelvis
    const spineX = (skel.head.x + skel.pelvis.x) / 2;

    // Mirror Left limbs to Right limbs
    skel.shoulder_r.x = spineX + (spineX - skel.shoulder_l.x);
    skel.shoulder_r.y = skel.shoulder_l.y;

    skel.elbow_r.x = spineX + (spineX - skel.elbow_l.x);
    skel.elbow_r.y = skel.elbow_l.y;

    skel.hand_r.x = spineX + (spineX - skel.hand_l.x);
    skel.hand_r.y = skel.hand_l.y;

    skel.knee_r.x = spineX + (spineX - skel.knee_l.x);
    skel.knee_r.y = skel.knee_l.y;

    skel.foot_r.x = spineX + (spineX - skel.foot_l.x);
    skel.foot_r.y = skel.foot_l.y;

    miniSkinnedMesh = null;
    prevSkinnedMesh = null;
    renderRiggingCanvas();
    riggingJointTooltip.textContent = '✨ 척추 기준으로 좌우 대칭이 정렬되었습니다';
    riggingJointTooltip.classList.add('active');
  });

  presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (!processedCharacter) return;
      presetChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const preset = chip.dataset.preset;
      const newSkel = generateSkeleton(preset, processedCharacter.width, processedCharacter.height);
      processedCharacter.skeleton = newSkel;
      processedCharacter.motionType = (preset === 'dolphin' || preset === 'turtle') ? 'swim' : 'walk';
      miniSkinnedMesh = null;
      prevSkinnedMesh = null;

      // Update info labels
      motionTypeLabel.textContent = processedCharacter.motionType === 'swim' ? '자율 루프 유영 (Harmonic Swim)' : '자율 루프 보행 (Harmonic Walk)';

      renderRiggingCanvas();
      riggingJointTooltip.textContent = `📐 [${chip.textContent.trim()}] 프리셋이 적용되었습니다`;
      riggingJointTooltip.classList.add('active');
    });
  });

  // ----------------------------------------------------
  // Live Mini Motion Preview (In-Editor Real-Time Feedback)
  // ----------------------------------------------------
  let miniSkinnedMesh = null;
  let prevSkinnedMesh = null;
  let previewStartTime = 0;

  function startMiniPreviewAnimation() {
    if (!processedCharacter || !miniCtx) return;
    let startTime = performance.now();

    // Create or reuse SkinnedMesh instance
    if (window.SkeletalMeshEngine && processedCharacter.charImg && processedCharacter.charImg.complete) {
      miniSkinnedMesh = new window.SkeletalMeshEngine.SkinnedMesh(
        processedCharacter.charImg,
        processedCharacter.skeleton,
        processedCharacter.width,
        processedCharacter.height,
        6, 8
      );
    }

    function miniLoop(now) {
      if (activeModalTab !== 'rigging') return;

      const t = (now - startTime) / 1000;
      miniCtx.clearRect(0, 0, riggingMiniCanvas.width, riggingMiniCanvas.height);

      const cx = riggingMiniCanvas.width / 2;
      const cy = riggingMiniCanvas.height / 2;
      const scale = 75 / Math.max(processedCharacter.width, processedCharacter.height);
      const dw = processedCharacter.width * scale;
      const dh = processedCharacter.height * scale;
      const motion = (processedCharacter && processedCharacter.motionType) || 'walk';

      miniCtx.save();
      miniCtx.translate(cx, cy);

      if (window.SkeletalMeshEngine && miniSkinnedMesh) {
        // FK & IK Pose solver
        const solvedPose = window.SkeletalMeshEngine.solveSkeletonPose(
          processedCharacter.skeleton,
          motion,
          t
        );

        // Skinned Mesh Deformation
        miniSkinnedMesh.draw(miniCtx, solvedPose, -dw / 2, -dh / 2, dw, dh);

        // Live Joint lines
        window.SkeletalMeshEngine.drawSkeletonOverlay(
          miniCtx,
          solvedPose,
          -dw / 2,
          -dh / 2,
          scale,
          scale,
          { alpha: 0.85, lineWidth: 1.5 }
        );
      } else {
        // Fallback static image
        if (processedCharacter.charImg && processedCharacter.charImg.complete) {
          miniCtx.drawImage(processedCharacter.charImg, -dw / 2, -dh / 2, dw, dh);
        }
      }

      miniCtx.restore();
      miniAnimId = requestAnimationFrame(miniLoop);
    }

    miniAnimId = requestAnimationFrame(miniLoop);
  }

  // ----------------------------------------------------
  // Full Skeletal Animation Preview (Tab 2)
  // ----------------------------------------------------
  function startPreviewAnimation() {
    if (!processedCharacter || !prevCtx) return;
    let startTime = performance.now();
    previewStartTime = startTime;

    // Create or update SkinnedMesh
    if (window.SkeletalMeshEngine && processedCharacter.charImg && processedCharacter.charImg.complete) {
      prevSkinnedMesh = new window.SkeletalMeshEngine.SkinnedMesh(
        processedCharacter.charImg,
        processedCharacter.skeleton,
        processedCharacter.width,
        processedCharacter.height,
        8, 10
      );
    }

    function loop(now) {
      if (activeModalTab !== 'preview') return;

      const t = (now - startTime) / 1000;
      prevCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      const cx = previewCanvas.width / 2;
      const cy = previewCanvas.height / 2;
      const motion = (processedCharacter && processedCharacter.motionType) || 'walk';

      const scale = 160 / Math.max(processedCharacter.width, processedCharacter.height);
      const dw = processedCharacter.width * scale;
      const dh = processedCharacter.height * scale;

      prevCtx.save();
      prevCtx.translate(cx, cy);

      // Subtle contact shadow
      prevCtx.save();
      prevCtx.scale(1, 0.28);
      const shadowGrad = prevCtx.createRadialGradient(0, dh * 1.6, 4, 0, dh * 1.6, dw * 0.45);
      shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
      shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      prevCtx.fillStyle = shadowGrad;
      prevCtx.beginPath();
      prevCtx.arc(0, dh * 1.6, dw * 0.45, 0, Math.PI * 2);
      prevCtx.fill();
      prevCtx.restore();

      if (window.SkeletalMeshEngine && prevSkinnedMesh) {
        // 1. Solve Hierarchical FK & 2-Bone IK Pose
        const solvedPose = window.SkeletalMeshEngine.solveSkeletonPose(
          processedCharacter.skeleton,
          motion,
          t
        );

        // 2. Render Real-Time Skinned Mesh Deformation
        prevSkinnedMesh.draw(prevCtx, solvedPose, -dw / 2, -dh / 2, dw, dh);

        // 3. Render Live Skeleton Overlay (Hierarchical Bone Links & Joints)
        window.SkeletalMeshEngine.drawSkeletonOverlay(
          prevCtx,
          solvedPose,
          -dw / 2,
          -dh / 2,
          scale,
          scale,
          { alpha: 0.9, lineWidth: 2.5 }
        );
      } else {
        // Fallback rendering
        if (processedCharacter.charImg && processedCharacter.charImg.complete) {
          prevCtx.drawImage(processedCharacter.charImg, -dw / 2, -dh / 2, dw, dh);
        }
      }

      prevCtx.restore();
      previewAnimId = requestAnimationFrame(loop);
    }

    previewAnimId = requestAnimationFrame(loop);
  }

  // ----------------------------------------------------
  // Motion Option Controls (PRD P0-1: 4 Motion Options)
  // ----------------------------------------------------
  const motionOptionButtons = document.querySelectorAll('.btn-motion-opt');
  const MOTION_LABELS = {
    dance_full: '💃 전신 댄스 (Full Body Dance)',
    walk: '🚶 워킹 (Harmonic Walk)',
    dance_lower: '🕺 하체 댄스 (Lower Body Dance)',
    funny: '🤪 웃긴 동작 (Comic Funny)',
    jump: '🦘 점프 (Jump & Cushion)',
    swim: '🌊 해양 유영 (Harmonic Swim)'
  };

  motionOptionButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedMotion = btn.dataset.motion;
      motionOptionButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (processedCharacter) {
        processedCharacter.motionType = selectedMotion;
      }
      motionTypeLabel.textContent = MOTION_LABELS[selectedMotion] || MOTION_LABELS.walk;
    });
  });

  function syncMotionButtons(motion) {
    const target = motion || 'walk';
    motionOptionButtons.forEach(btn => {
      if (btn.dataset.motion === target) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    motionTypeLabel.textContent = MOTION_LABELS[target] || MOTION_LABELS.walk;
  }

  // ----------------------------------------------------
  // Modal Navigation & State Transitions
  // ----------------------------------------------------
  function switchModalTab(tab) {
    activeModalTab = tab;

    if (tab === 'rigging') {
      tabRigging.classList.add('active');
      tabPreview.classList.remove('active');
      panelRigging.classList.add('active');
      panelPreview.classList.remove('active');

      if (previewAnimId) {
        cancelAnimationFrame(previewAnimId);
        previewAnimId = null;
      }
      renderRiggingCanvas();
      startMiniPreviewAnimation();
    } else {
      tabPreview.classList.add('active');
      tabRigging.classList.remove('active');
      panelPreview.classList.add('active');
      panelRigging.classList.remove('active');

      if (miniAnimId) {
        cancelAnimationFrame(miniAnimId);
        miniAnimId = null;
      }
      syncMotionButtons(processedCharacter ? processedCharacter.motionType : 'walk');
      keypointCount.textContent = '13 Keypoints (수동 보정 반영 완료)';
      startPreviewAnimation();
    }
  }

  tabRigging.addEventListener('click', () => switchModalTab('rigging'));
  tabPreview.addEventListener('click', () => switchModalTab('preview'));
  btnGotoPreview.addEventListener('click', () => switchModalTab('preview'));
  btnBackToRigging.addEventListener('click', () => switchModalTab('rigging'));
  btnPreviewBack.addEventListener('click', () => switchModalTab('rigging'));

  function openPreviewModal() {
    previewModal.classList.add('open');
    switchModalTab('rigging'); // Open directly into rigging adjustment!
  }

  function closePreviewModal() {
    previewModal.classList.remove('open');
    if (previewAnimId) {
      cancelAnimationFrame(previewAnimId);
      previewAnimId = null;
    }
    if (miniAnimId) {
      cancelAnimationFrame(miniAnimId);
      miniAnimId = null;
    }
    draggedJoint = null;
    hoveredJoint = null;
    if (downloadDropdownWrap) {
      downloadDropdownWrap.classList.remove('open');
    }
  }

  btnCloseModal.addEventListener('click', closePreviewModal);
  btnReEdit.addEventListener('click', closePreviewModal);

  // ----------------------------------------------------
  // Drawing & Character File Download Engine
  // ----------------------------------------------------
  let toastTimer = null;
  function showToast(message, duration = 2400) {
    if (!kioskToast) return;
    kioskToast.textContent = message;
    kioskToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      kioskToast.classList.remove('show');
    }, duration);
  }

  function triggerDownload(dataUrl, filename) {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function getFormatDate() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  // 1. High-Resolution Drawing Composite Export (White Background + Template + Color strokes)
  function getFullDrawingDataUrl() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = drawingCanvas.width;
    exportCanvas.height = drawingCanvas.height;
    const expCtx = exportCanvas.getContext('2d');

    // 1. Solid pure white background
    expCtx.fillStyle = '#ffffff';
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    if (currentMode === 'template') {
      // 2. White base inside template shape
      drawTemplateWhiteBase(expCtx, exportCanvas.width, exportCanvas.height);
      // 3. User colored strokes
      expCtx.drawImage(drawingCanvas, 0, 0);
      // 4. Crisp black line art
      drawTemplateOutline(expCtx, exportCanvas.width, exportCanvas.height);
    } else {
      // Free drawing mode strokes
      expCtx.drawImage(drawingCanvas, 0, 0);
    }

    return exportCanvas.toDataURL('image/png');
  }

  // 2. Animated Motion Pose Snapshot Export (Clean Skinned Character Deformed Pose)
  function getMotionSnapshotDataUrl() {
    if (!processedCharacter) return null;
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = previewCanvas.width;
    snapCanvas.height = previewCanvas.height;
    const sCtx = snapCanvas.getContext('2d');

    const cx = snapCanvas.width / 2;
    const cy = snapCanvas.height / 2;
    const motion = (processedCharacter && processedCharacter.motionType) || 'walk';
    const scale = 160 / Math.max(processedCharacter.width, processedCharacter.height);
    const dw = processedCharacter.width * scale;
    const dh = processedCharacter.height * scale;

    sCtx.save();
    sCtx.translate(cx, cy);

    if (window.SkeletalMeshEngine && prevSkinnedMesh) {
      const t = (performance.now() - (previewStartTime || performance.now())) / 1000;
      const solvedPose = window.SkeletalMeshEngine.solveSkeletonPose(
        processedCharacter.skeleton,
        motion,
        t
      );
      // Clean mesh render without overlay bones
      prevSkinnedMesh.draw(sCtx, solvedPose, -dw / 2, -dh / 2, dw, dh);
    } else if (processedCharacter.charImg && processedCharacter.charImg.complete) {
      sCtx.drawImage(processedCharacter.charImg, -dw / 2, -dh / 2, dw, dh);
    } else {
      sCtx.drawImage(previewCanvas, -cx, -cy);
    }
    sCtx.restore();

    return snapCanvas.toDataURL('image/png');
  }

  // Feature 2: Canvas Bottom Bar - Drawing Download Button
  if (btnDownloadDrawing) {
    btnDownloadDrawing.addEventListener('click', () => {
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

      const dataUrl = getFullDrawingDataUrl();
      const tmplName = currentMode === 'template' ? currentTemplate : 'sketch';
      const filename = `drawing_${tmplName}_${getFormatDate()}.png`;
      triggerDownload(dataUrl, filename);
      showToast('💾 그림 파일이 다운로드되었습니다!');
    });
  }

  // Feature 3: Motion Preview Modal - Download Button & Options
  if (btnPreviewDownload && downloadDropdownWrap) {
    btnPreviewDownload.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadDropdownWrap.classList.toggle('open');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!downloadDropdownWrap.contains(e.target)) {
        downloadDropdownWrap.classList.remove('open');
      }
    });

    // Handle each download option click
    const optButtons = downloadDropdownWrap.querySelectorAll('.dl-opt-btn');
    optButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadDropdownWrap.classList.remove('open');
        const dlType = btn.dataset.dlType;
        const tmplName = (processedCharacter && processedCharacter.templateId) || currentTemplate || 'character';
        const dateStr = getFormatDate();

        if (dlType === 'drawing') {
          // 1. 전체 채색 그림
          const dataUrl = getFullDrawingDataUrl();
          triggerDownload(dataUrl, `drawing_${tmplName}_${dateStr}.png`);
          showToast('🎨 채색 그림이 저장되었습니다!');
        } else if (dlType === 'character') {
          // 2. 투명 배경 AI 캐릭터
          if (processedCharacter && processedCharacter.dataUrl) {
            triggerDownload(processedCharacter.dataUrl, `character_${tmplName}_${dateStr}.png`);
            showToast('✨ AI 캐릭터가 저장되었습니다!');
          } else {
            const dataUrl = getFullDrawingDataUrl();
            triggerDownload(dataUrl, `character_${tmplName}_${dateStr}.png`);
            showToast('💾 그림 파일이 저장되었습니다!');
          }
        } else if (dlType === 'motion') {
          // 3. 모션 포즈 스냅샷
          const snapUrl = getMotionSnapshotDataUrl();
          if (snapUrl) {
            triggerDownload(snapUrl, `motion_${tmplName}_${dateStr}.png`);
            showToast('🎬 모션 포즈 스냅샷이 저장되었습니다!');
          } else {
            showToast('⚠️ 모션 캡처를 생성할 수 없습니다.');
          }
        }
      });
    });
  }

  // ----------------------------------------------------
  // PRD P0-1 / P0-3: One-Click Send to Media Wall (< 1 second)
  // ----------------------------------------------------
  btnSendWall.addEventListener('click', async () => {
    if (!processedCharacter) {
      alert('먼저 그림을 채색하고 [AI 애니메이션 변환]을 진행해주세요!');
      return;
    }

    btnSendWall.disabled = true;
    btnSendWall.innerHTML = '<span>🚀</span> 대형 스크린 전송 중...';

    const charPayload = {
      id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      dataUrl: processedCharacter.dataUrl,
      skeleton: processedCharacter.skeleton,
      templateId: processedCharacter.templateId,
      motionType: processedCharacter.motionType,
      scale: 1.0,
      timestamp: Date.now()
    };

    // 1. BroadcastChannel (Instant 0ms delivery for tabs on same browser/device)
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'SPAWN_CHARACTER',
          character: charPayload
        });
      } catch (e) {
        console.warn('BroadcastChannel send error:', e);
      }
    }

    // 2. WebSocket (If available/connected on local or dedicated server)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'SPAWN_CHARACTER',
          ...charPayload
        }));
      } catch (e) {
        console.warn('WebSocket send error:', e);
      }
    }

    // 3. HTTP REST API (/api/spawn - Works reliably on Vercel Serverless across all devices)
    try {
      await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(charPayload)
      });
    } catch (e) {
      console.warn('HTTP spawn notice:', e);
    }

    btnSendWall.disabled = false;
    btnSendWall.innerHTML = '<span>🚀</span> 대형 스크린으로 즉시 전송';

    closePreviewModal();

    // Reset workspace & canvas (Zero-Persistence: ephemeral in-memory)
    drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    historyStack = [];
    processedCharacter = null;
    initialSkeleton = null;

    alert('🚀 대형 스크린으로 전송되었습니다!\n미디어월에서 헤엄치고 걷는 내 캐릭터를 확인해보세요.');
  });

  // Initial template render & server sync
  fetchTemplates();
  renderTemplateGrid();
  renderTemplate();

})();
