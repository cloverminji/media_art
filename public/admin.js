/**
 * 마스터 관리자 대시보드 로직 (Live Sketch Admin Console)
 * - PRD P0-2: 테마 프리셋 전환 및 웹 검색 연동 배경 소싱
 * - PRD P0-3: 화면 최적화 및 캐릭터 생명 주기(체류 시간) 조절 및 상태 모니터링
 */

(function () {
  'use strict';

  // DOM Elements
  const themeCards = document.querySelectorAll('.theme-card');
  const inputSearchQuery = document.getElementById('input-search-query');
  const btnSearchImages = document.getElementById('btn-search-images');
  const searchResultsGrid = document.getElementById('search-results-grid');
  const searchResultCount = document.getElementById('search-result-count');
  const inputCustomUrl = document.getElementById('input-custom-url');
  const btnApplyCustomUrl = document.getElementById('btn-apply-custom-url');

  const rangeLifetime = document.getElementById('range-lifetime');
  const valLifetime = document.getElementById('val-lifetime');
  const valLifetimeMin = document.getElementById('val-lifetime-min');
  const presetButtons = document.querySelectorAll('.preset-btn');

  const metricActiveCount = document.getElementById('metric-active-count');
  const metricFps = document.getElementById('metric-fps');
  const btnClearAll = document.getElementById('btn-clear-all');

  let ws = null;
  let currentConfig = {
    theme: 'ocean',
    customBackgroundUrl: '',
    lifetimeSeconds: 180
  };

  let syncChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel('mediaart_live_sync');
      syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'TEMPLATES_UPDATED' && event.data.templates) {
          renderAdminTemplates(event.data.templates);
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not available:', e);
    }
  }

  // ----------------------------------------------------
  // WebSocket Connection (Local/VPS Persistent WS)
  // ----------------------------------------------------
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${protocol}//${window.location.host}`);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'REGISTER_CLIENT', role: 'admin' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'INIT_STATE':
            case 'CONFIG_UPDATED':
            case 'THEME_CHANGED':
            case 'LIFECYCLE_UPDATED':
              if (data.config) {
                currentConfig = { ...currentConfig, ...data.config };
                syncUI();
              }
              break;

            case 'METRICS_UPDATE':
              if (data.activeCount !== undefined) {
                metricActiveCount.textContent = data.activeCount;
              }
              if (data.fps !== undefined) {
                metricFps.textContent = data.fps;
              }
              break;
          }
        } catch (e) {
          console.error('Error in WS message:', e);
        }
      };

      ws.onerror = () => {
        // Silently handled in serverless environment
      };

      ws.onclose = () => {
        setTimeout(initWebSocket, 5000);
      };
    } catch (e) {
      console.warn('WebSocket init skipped (using HTTP/BroadcastChannel sync):', e);
    }
  }

  // ----------------------------------------------------
  // Sync UI with Server State
  // ----------------------------------------------------
  function syncUI() {
    // Sync Theme Cards
    themeCards.forEach(card => {
      const theme = card.dataset.theme;
      if (theme === currentConfig.theme) {
        card.classList.add('active');
        card.querySelector('.btn-apply-theme').textContent = '적용 중';
      } else {
        card.classList.remove('active');
        card.querySelector('.btn-apply-theme').textContent = '적용하기';
      }
    });

    // Sync Lifetime
    if (currentConfig.lifetimeSeconds) {
      rangeLifetime.value = currentConfig.lifetimeSeconds;
      updateLifetimeDisplay(currentConfig.lifetimeSeconds);

      presetButtons.forEach(btn => {
        if (parseInt(btn.dataset.time, 10) === currentConfig.lifetimeSeconds) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    if (currentConfig.customBackgroundUrl) {
      inputCustomUrl.value = currentConfig.customBackgroundUrl;
    }
  }

  function updateLifetimeDisplay(sec) {
    valLifetime.textContent = sec;
    const min = (sec / 60).toFixed(1);
    valLifetimeMin.textContent = `(${min}분)`;
  }

  // ----------------------------------------------------
  // PRD P0-2: Theme Selection
  // ----------------------------------------------------
  themeCards.forEach(card => {
    const btn = card.querySelector('.btn-apply-theme');
    btn.addEventListener('click', () => {
      const theme = card.dataset.theme;
      applyTheme(theme, '');
    });
  });

  function applyTheme(theme, customUrl = '') {
    currentConfig.theme = theme;
    if (customUrl) currentConfig.customBackgroundUrl = customUrl;

    // 1. BroadcastChannel (Instant sync across tabs/windows)
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'THEME_CHANGED',
          config: { theme: theme, customBackgroundUrl: customUrl }
        });
      } catch (e) {}
    }

    // 2. WebSocket (Local/VPS)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'CHANGE_THEME',
          theme: theme,
          customBackgroundUrl: customUrl
        }));
      } catch (e) {}
    }

    // 3. HTTP REST API (Vercel Serverless persistence)
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: theme, customBackgroundUrl: customUrl })
    }).catch(e => console.warn('Config save notice:', e));
  }

  // ----------------------------------------------------
  // PRD P0-2: Web Image Search & Sourcing
  // ----------------------------------------------------
  async function searchImages(query) {
    try {
      btnSearchImages.disabled = true;
      btnSearchImages.innerHTML = '<span>⏳</span> 검색 중...';

      const res = await fetch(`/api/search-images?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      renderGallery(data.results || []);
    } catch (e) {
      console.error('Image search error:', e);
      alert('이미지 검색 중 오류가 발생했습니다.');
    } finally {
      btnSearchImages.disabled = false;
      btnSearchImages.innerHTML = '<span>🔎</span> 검색';
    }
  }

  function renderGallery(images) {
    searchResultsGrid.innerHTML = '';
    searchResultCount.textContent = `${images.length}개 발견`;

    images.forEach(img => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.innerHTML = `
        <img src="${img.url}" alt="${img.title}" loading="lazy">
        <div class="overlay-title">${img.title}</div>
      `;
      item.addEventListener('click', () => {
        applyTheme('custom', img.url);
        inputCustomUrl.value = img.url;
        alert(`🖼️ 미디어월 배경에 '${img.title}' 이미지가 실시간 적용되었습니다!`);
      });
      searchResultsGrid.appendChild(item);
    });
  }

  btnSearchImages.addEventListener('click', () => {
    const q = inputSearchQuery.value.trim();
    searchImages(q);
  });

  inputSearchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      searchImages(inputSearchQuery.value.trim());
    }
  });

  btnApplyCustomUrl.addEventListener('click', () => {
    const url = inputCustomUrl.value.trim();
    if (!url) {
      alert('유효한 이미지 URL을 입력해주세요.');
      return;
    }
    applyTheme('custom', url);
    alert('🖼️ 입력한 URL 이미지가 미디어월 배경으로 실시간 적용되었습니다!');
  });

  // ----------------------------------------------------
  // PRD P0-3: Lifetime Control
  // ----------------------------------------------------
  rangeLifetime.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    updateLifetimeDisplay(val);
  });

  rangeLifetime.addEventListener('change', (e) => {
    const val = parseInt(e.target.value, 10);
    setLifetime(val);
  });

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.time, 10);
      setLifetime(val);
    });
  });

  function setLifetime(val) {
    presetButtons.forEach(b => b.classList.remove('active'));
    presetButtons.forEach(b => {
      if (parseInt(b.dataset.time, 10) === val) b.classList.add('active');
    });

    updateLifetimeDisplay(val);

    // 1. BroadcastChannel
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'LIFECYCLE_UPDATED',
          lifetimeSeconds: val
        });
      } catch (e) {}
    }

    // 2. WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'UPDATE_LIFECYCLE',
          lifetimeSeconds: val
        }));
      } catch (e) {}
    }

    // 3. HTTP REST API
    fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'UPDATE_LIFECYCLE', payload: { lifetimeSeconds: val } })
    }).catch(e => {});
  }

  // Clear all characters
  btnClearAll.addEventListener('click', () => {
    if (confirm('현재 미디어월의 모든 캐릭터를 즉시 페이드아웃 퇴장시키겠습니까?')) {
      // 1. BroadcastChannel
      if (syncChannel) {
        try {
          syncChannel.postMessage({ type: 'CLEAR_ALL_CHARACTERS' });
        } catch (e) {}
      }

      // 2. WebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'CLEAR_ALL_CHARACTERS' }));
        } catch (e) {}
      }

      // 3. HTTP REST API
      fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CLEAR_ALL_CHARACTERS' })
      }).catch(e => {});
    }
  });

  // ----------------------------------------------------
  // Section 4: Custom Coloring Templates Management
  // ----------------------------------------------------
  const templateDropzone = document.getElementById('template-dropzone');
  const inputTemplateFile = document.getElementById('input-template-file');
  const templateDropzonePrompt = document.getElementById('template-dropzone-prompt');
  const templateDropzonePreview = document.getElementById('template-dropzone-preview');
  const imgTemplatePreview = document.getElementById('img-template-preview');
  const btnChangeTemplateFile = document.getElementById('btn-change-template-file');

  const badgeOptStatus = document.getElementById('badge-opt-status');
  const optSizeInfo = document.getElementById('opt-size-info');
  const chkRemoveBg = document.getElementById('chk-remove-bg');
  const rangeThreshold = document.getElementById('range-threshold');
  const valThreshold = document.getElementById('val-threshold');
  const sliderThresholdRow = document.getElementById('slider-threshold-row');

  const inputTemplateName = document.getElementById('input-template-name');
  const inputTemplateIcon = document.getElementById('input-template-icon');
  const selectTemplateMotion = document.getElementById('select-template-motion');
  const btnSubmitTemplate = document.getElementById('btn-submit-template');

  const badgeTemplateCount = document.getElementById('badge-template-count');
  const adminTemplatesGrid = document.getElementById('admin-templates-grid');

  let uploadedTemplateDataUrl = '';
  let originalTemplateImg = null;
  let originalFileSize = 0;
  let allAdminTemplates = [];

  // Dropzone events for template upload
  templateDropzone.addEventListener('click', () => inputTemplateFile.click());

  templateDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    templateDropzone.classList.add('drag-over');
  });

  templateDropzone.addEventListener('dragleave', () => {
    templateDropzone.classList.remove('drag-over');
  });

  templateDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    templateDropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleTemplateFile(e.dataTransfer.files[0]);
    }
  });

  inputTemplateFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleTemplateFile(e.target.files[0]);
    }
  });

  btnChangeTemplateFile.addEventListener('click', (e) => {
    e.stopPropagation();
    inputTemplateFile.click();
  });

  // Client-side Smart Line Art Processor (Transparency & Downscaling)
  function processTemplateImage(img, options = {}) {
    const removeWhiteBg = options.removeWhiteBg !== false;
    const threshold = options.threshold !== undefined ? options.threshold : 225;
    const maxDim = options.maxWidth || 1024;

    const naturalW = img.naturalWidth || img.width || 800;
    const naturalH = img.naturalHeight || img.height || 600;

    let scale = 1;
    if (naturalW > maxDim || naturalH > maxDim) {
      scale = Math.min(maxDim / naturalW, maxDim / naturalH);
    }

    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.drawImage(img, 0, 0, w, h);

    if (removeWhiteBg) {
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 10) continue; // Already transparent

        // Perceived luminance
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (lum >= threshold) {
          // White or light background -> 100% transparent
          data[i + 3] = 0;
        } else {
          // Line art ink pixel: smooth antialiasing and high contrast dark ink
          const alphaRatio = 1 - (lum / threshold);
          data[i] = 30;
          data[i + 1] = 41;
          data[i + 2] = 59;
          data[i + 3] = Math.round(Math.min(255, Math.pow(alphaRatio, 0.85) * 255));
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    return canvas.toDataURL('image/png');
  }

  function updateProcessedPreview() {
    if (!originalTemplateImg) return;

    const removeBg = chkRemoveBg ? chkRemoveBg.checked : true;
    const threshold = rangeThreshold ? parseInt(rangeThreshold.value, 10) : 225;

    if (sliderThresholdRow) {
      sliderThresholdRow.style.display = removeBg ? 'flex' : 'none';
    }

    uploadedTemplateDataUrl = processTemplateImage(originalTemplateImg, {
      removeWhiteBg: removeBg,
      threshold: threshold,
      maxWidth: 1024,
      maxHeight: 1024
    });

    imgTemplatePreview.src = uploadedTemplateDataUrl;

    // Approximate size in KB
    const optimizedBytes = Math.round((uploadedTemplateDataUrl.length * 3) / 4);
    const origKB = originalFileSize > 0 ? (originalFileSize / 1024).toFixed(0) + 'KB' : '';
    const optKB = (optimizedBytes / 1024).toFixed(0) + 'KB';

    if (badgeOptStatus) {
      badgeOptStatus.textContent = removeBg ? '⚡ 투명 도안 최적화 완료' : '⚡ 원본 비율 최적화 완료';
    }
    if (optSizeInfo) {
      if (originalFileSize > 0) {
        const savedPercent = Math.max(0, Math.round((1 - optimizedBytes / originalFileSize) * 100));
        optSizeInfo.textContent = `용량: ${origKB} ➔ ${optKB} (${savedPercent}% 압축)`;
      } else {
        optSizeInfo.textContent = `용량: ${optKB}`;
      }
    }
  }

  if (chkRemoveBg) {
    chkRemoveBg.addEventListener('change', updateProcessedPreview);
  }

  if (rangeThreshold && valThreshold) {
    rangeThreshold.addEventListener('input', (e) => {
      valThreshold.textContent = e.target.value;
      updateProcessedPreview();
    });
  }

  function handleTemplateFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일(PNG, JPG, SVG)만 업로드 가능합니다.');
      return;
    }

    originalFileSize = file.size;

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawDataUrl = event.target.result;
      const img = new Image();
      img.onload = () => {
        originalTemplateImg = img;
        updateProcessedPreview();

        templateDropzonePrompt.style.display = 'none';
        templateDropzonePreview.style.display = 'flex';

        // Auto fill name if empty
        if (!inputTemplateName.value.trim()) {
          const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
          inputTemplateName.value = baseName;
        }
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  }

  // Submit Template
  btnSubmitTemplate.addEventListener('click', async () => {
    const name = inputTemplateName.value.trim();
    const icon = inputTemplateIcon.value.trim() || '🎨';
    const motionType = selectTemplateMotion.value;

    if (!uploadedTemplateDataUrl) {
      alert('먼저 도안 이미지 파일을 업로드해주세요.');
      return;
    }
    if (!name) {
      alert('도안 명칭을 입력해주세요.');
      inputTemplateName.focus();
      return;
    }

    btnSubmitTemplate.disabled = true;
    btnSubmitTemplate.innerHTML = '<span>⏳</span> 도안 등록 중...';

    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          icon: icon,
          motionType: motionType,
          dataUrl: uploadedTemplateDataUrl
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (jsonErr) {
        throw new Error(res.status === 413 ? '이미지 파일 용량이 서버 한도를 초과했습니다.' : `서버 응답 오류 (HTTP ${res.status})`);
      }

      if (res.ok && data.success) {
        alert(`🎉 '${name}' 도안이 성공적으로 등록되었습니다!\n키오스크 단말기에 실시간 반영되었습니다.`);
        // Persist to local backup for serverless persistence
        try {
          if (data.template) {
            const cached = JSON.parse(localStorage.getItem('kiosk_custom_templates') || '[]');
            const filtered = cached.filter(t => t.id !== data.template.id);
            filtered.push(data.template);
            localStorage.setItem('kiosk_custom_templates', JSON.stringify(filtered));
          }
        } catch (storageErr) {}

        // Reset form
        uploadedTemplateDataUrl = '';
        originalTemplateImg = null;
        originalFileSize = 0;
        imgTemplatePreview.src = '';
        templateDropzonePrompt.style.display = 'flex';
        templateDropzonePreview.style.display = 'none';
        inputTemplateName.value = '';
        inputTemplateFile.value = '';
        renderAdminTemplates(data.templates);
      } else {
        alert('도안 등록 실패: ' + (data.error || '알 수 없는 오류'));
      }
    } catch (e) {
      console.error('Template upload error:', e);
      alert('도안 등록 오류: ' + (e.message || '서버 통신 중 문제가 발생했습니다.'));
    } finally {
      btnSubmitTemplate.disabled = false;
      btnSubmitTemplate.innerHTML = '<span>➕</span> 키오스크 도안으로 등록 및 실시간 전파';
    }
  });

  async function fetchTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success && data.templates) {
        renderAdminTemplates(data.templates);
        return;
      }
    } catch (err) {
      console.warn('Failed to fetch templates from server, checking local fallback:', err);
    }
    // Fallback: check localStorage
    try {
      const local = JSON.parse(localStorage.getItem('kiosk_custom_templates') || '[]');
      if (local && local.length > 0) {
        const defaultList = [
          { id: 'dolphin', name: '제주 돌고래', icon: '🐬', motionType: 'swim', isBuiltin: true },
          { id: 'tangerine', name: '감귤 요정', icon: '🍊', motionType: 'walk', isBuiltin: true },
          { id: 'astronaut', name: '우주 탐험가', icon: '🧑‍🚀', motionType: 'walk', isBuiltin: true },
          { id: 'turtle', name: '바다 거북이', icon: '🐢', motionType: 'swim', isBuiltin: true }
        ];
        renderAdminTemplates([...defaultList, ...local]);
      }
    } catch (e) {}
  }

  function renderAdminTemplates(templates) {
    allAdminTemplates = templates || [];
    badgeTemplateCount.textContent = `${allAdminTemplates.length}개 운영 중`;
    adminTemplatesGrid.innerHTML = '';

    allAdminTemplates.forEach(t => {
      const card = document.createElement('div');
      card.className = 'admin-template-card';

      const isCustom = !t.isBuiltin;
      const motionKor = t.motionType === 'swim' ? '🌊 유영' : t.motionType === 'space' ? '🪐 부유' : '🚶 보행';

      // Thumbnail
      let thumbHtml = '';
      if (t.imageUrl) {
        thumbHtml = `<img src="${t.imageUrl}" alt="${t.name}">`;
      } else {
        // Builtin vector mascot placeholder
        thumbHtml = `<span style="font-size: 2.2rem;">${t.icon}</span>`;
      }

      card.innerHTML = `
        <div class="card-top-row">
          <span class="card-icon">${t.icon}</span>
          <span class="card-tag ${isCustom ? 'custom' : ''}">${isCustom ? '커스텀 추가' : '기본 프리셋'}</span>
        </div>
        <div class="card-preview-thumb">
          ${thumbHtml}
        </div>
        <div class="card-name" title="${t.name}">${t.name}</div>
        <div class="card-motion">${motionKor}</div>
        ${isCustom ? `<button class="btn-delete-template" data-id="${t.id}">🗑️ 삭제</button>` : ''}
      `;

      if (isCustom) {
        const delBtn = card.querySelector('.btn-delete-template');
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`'${t.name}' 도안을 정말 삭제하시겠습니까?\n키오스크 목록에서도 제거됩니다.`)) {
            try {
              const res = await fetch(`/api/templates/${t.id}`, { method: 'DELETE' });
              const resData = await res.json();
              if (resData.success) {
                renderAdminTemplates(resData.templates);
              }
            } catch (err) {
              console.error('Delete template error:', err);
            }
          }
        });
      }

      adminTemplatesGrid.appendChild(card);
    });
  }

  // ----------------------------------------------------
  // Section 5: Animated Drawings File Import & Spawn Studio
  // ----------------------------------------------------
  const adDropzone = document.getElementById('ad-dropzone');
  const adFileInput = document.getElementById('ad-file-input');
  const adPreviewCard = document.getElementById('ad-preview-card');
  const adPreviewCanvas = document.getElementById('ad-preview-canvas');
  const adCtx = adPreviewCanvas.getContext('2d');

  const adCharName = document.getElementById('ad-char-name');
  const adJointCount = document.getElementById('ad-joint-count');
  const adSourceFilename = document.getElementById('ad-source-filename');
  const adRiggingStatus = document.getElementById('ad-rigging-status');
  const adMotionSelect = document.getElementById('ad-motion-select');
  const btnAdSpawn = document.getElementById('btn-ad-spawn');
  const btnAdAddTemplate = document.getElementById('btn-ad-add-template');

  let importedChar = null; // { dataUrl, skeleton, motionType, name, width, height, charImg }
  let adAnimId = null;

  adDropzone.addEventListener('click', () => adFileInput.click());

  adDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    adDropzone.classList.add('drag-over');
  });

  adDropzone.addEventListener('dragleave', () => {
    adDropzone.classList.remove('drag-over');
  });

  adDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    adDropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleADFiles(Array.from(e.dataTransfer.files));
    }
  });

  adFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleADFiles(Array.from(e.target.files));
    }
  });

  async function handleADFiles(fileList) {
    try {
      let imageFile = null;
      let configFile = null;
      let zipFile = null;

      fileList.forEach(f => {
        const name = f.name.toLowerCase();
        if (name.endsWith('.zip')) {
          zipFile = f;
        } else if (f.type.startsWith('image/') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
          imageFile = f;
        } else if (name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json')) {
          configFile = f;
        }
      });

      let imageDataUrl = '';
      let rawConfigText = '';
      let sourceInfo = '';

      // Case 1: ZIP Archive
      if (zipFile && window.JSZip) {
        sourceInfo = zipFile.name;
        const zip = await JSZip.loadAsync(zipFile);
        let foundImg = null;
        let foundCfg = null;

        zip.forEach((relPath, entry) => {
          const lower = relPath.toLowerCase();
          if (!entry.dir) {
            if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
              foundImg = entry;
            } else if (lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json')) {
              foundCfg = entry;
            }
          }
        });

        if (foundImg) {
          const imgBlob = await foundImg.async('blob');
          imageDataUrl = await blobToDataURL(imgBlob);
        }
        if (foundCfg) {
          rawConfigText = await foundCfg.async('text');
        }
      } 
      // Case 2: Individual Image + Config files
      else {
        if (imageFile) {
          imageDataUrl = await fileToDataURL(imageFile);
          sourceInfo = imageFile.name;
        }
        if (configFile) {
          rawConfigText = await fileToText(configFile);
          sourceInfo += (sourceInfo ? ' + ' : '') + configFile.name;
        }
      }

      if (!imageDataUrl && configFile && rawConfigText) {
        // Maybe config contains embedded image data
        try {
          const parsed = JSON.parse(rawConfigText);
          if (parsed.image || parsed.dataUrl) {
            imageDataUrl = parsed.image || parsed.dataUrl;
          }
        } catch (e) {}
      }

      if (!imageDataUrl) {
        alert('Animated Drawings 캐릭터 이미지 파일(PNG/JPG) 또는 압축 파일(.ZIP)을 포함해주세요.');
        return;
      }

      // Parse and normalize skeleton
      const parsedSkeleton = parseAnimatedDrawingsConfig(rawConfigText);

      // Load image to get dimensions
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        // Check if image has solid white background and sanitize if needed
        let finalDataUrl = imageDataUrl;
        let finalImg = img;

        try {
          const testCanvas = document.createElement('canvas');
          testCanvas.width = Math.min(w, 400);
          testCanvas.height = Math.min(h, 400);
          const tCtx = testCanvas.getContext('2d', { willReadFrequently: true });
          tCtx.drawImage(img, 0, 0, testCanvas.width, testCanvas.height);
          const tData = tCtx.getImageData(0, 0, testCanvas.width, testCanvas.height).data;
          // Sample corner pixels
          const corners = [0, (testCanvas.width - 1) * 4, ((testCanvas.height - 1) * testCanvas.width) * 4, (testCanvas.height * testCanvas.width - 1) * 4];
          const isWhiteBg = corners.every(idx => tData[idx] > 230 && tData[idx + 1] > 230 && tData[idx + 2] > 230 && tData[idx + 3] > 200);

          if (isWhiteBg) {
            finalDataUrl = processTemplateImage(img, { removeWhiteBg: true, threshold: 225 });
            finalImg = new Image();
            finalImg.src = finalDataUrl;
          }
        } catch (e) {
          console.warn('Corner check skipped:', e);
        }

        // Scale/adjust skeleton if given in absolute or normalized format
        const finalSkeleton = normalizeSkeletonToImage(parsedSkeleton, w, h);

        importedChar = {
          dataUrl: finalDataUrl,
          skeleton: finalSkeleton,
          motionType: adMotionSelect.value || 'walk',
          name: imageFile ? imageFile.name.replace(/\.[^/.]+$/, '') : 'Animated Character',
          width: w,
          height: h,
          charImg: finalImg
        };

        // Update UI details
        adCharName.textContent = importedChar.name;
        adSourceFilename.textContent = sourceInfo || 'Animated Drawings 에셋';
        adRiggingStatus.textContent = parsedSkeleton ? 'Meta Animated Drawings 관절 매핑 완료' : 'AI 인체 관절 자동 리깅 적용됨';
        adJointCount.textContent = '13 Keypoints';

        adPreviewCard.style.display = 'flex';
        startAdPreviewLoop();

        adPreviewCard.scrollIntoView({ behavior: 'smooth' });
      };
      img.src = imageDataUrl;

    } catch (err) {
      console.error('Error importing Animated Drawings files:', err);
      alert('파일 분석 중 오류가 발생했습니다: ' + err.message);
    }
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  // Meta Animated Drawings char_cfg.yaml / JSON parser
  function parseAnimatedDrawingsConfig(text) {
    if (!text || !text.trim()) return null;

    let parsed = null;
    // Try js-yaml if loaded
    if (window.jsyaml) {
      try {
        parsed = window.jsyaml.load(text);
      } catch (e) {}
    }

    // Try JSON
    if (!parsed) {
      try {
        parsed = JSON.parse(text);
      } catch (e) {}
    }

    // Extract skeleton list/map
    if (!parsed) return null;

    const jointMap = {};

    // Standard Animated Drawings format: skeleton: [ { name: "neck", loc: [x, y] }, ... ]
    const list = parsed.skeleton || parsed.joints || (Array.isArray(parsed) ? parsed : null);

    if (Array.isArray(list)) {
      list.forEach(node => {
        if (node.name && node.loc) {
          jointMap[node.name.toLowerCase()] = { x: node.loc[0], y: node.loc[1] };
        }
      });
    } else if (typeof list === 'object') {
      for (const k in list) {
        const val = list[k];
        if (Array.isArray(val) && val.length >= 2) {
          jointMap[k.toLowerCase()] = { x: val[0], y: val[1] };
        } else if (val && typeof val.x === 'number' && typeof val.y === 'number') {
          jointMap[k.toLowerCase()] = { x: val.x, y: val.y };
        }
      }
    }

    return Object.keys(jointMap).length > 0 ? jointMap : null;
  }

  // Map Animated Drawings joint names to our standard 13-point skeleton
  function normalizeSkeletonToImage(jointMap, w, h) {
    // Default standard humanoid template
    const def = {
      head: { x: w * 0.5, y: h * 0.18 },
      neck: { x: w * 0.5, y: h * 0.32 },
      shoulder_l: { x: w * 0.34, y: h * 0.36 },
      elbow_l: { x: w * 0.24, y: h * 0.48 },
      hand_l: { x: w * 0.16, y: h * 0.60 },
      shoulder_r: { x: w * 0.66, y: h * 0.36 },
      elbow_r: { x: w * 0.76, y: h * 0.48 },
      hand_r: { x: w * 0.84, y: h * 0.60 },
      pelvis: { x: w * 0.5, y: h * 0.62 },
      knee_l: { x: w * 0.40, y: h * 0.78 },
      foot_l: { x: w * 0.36, y: h * 0.95 },
      knee_r: { x: w * 0.60, y: h * 0.78 },
      foot_r: { x: w * 0.64, y: h * 0.95 }
    };

    if (!jointMap) return def;

    const findLoc = (...aliases) => {
      for (const a of aliases) {
        if (jointMap[a]) return jointMap[a];
      }
      return null;
    };

    const out = { ...def };

    const headPt = findLoc('head', 'nose');
    if (headPt) out.head = { x: headPt.x, y: headPt.y };

    const neckPt = findLoc('neck', 'torso', 'chest');
    if (neckPt) out.neck = { x: neckPt.x, y: neckPt.y };

    const shL = findLoc('left_shoulder', 'shoulder_l', 'l_shoulder');
    if (shL) out.shoulder_l = { x: shL.x, y: shL.y };

    const elL = findLoc('left_elbow', 'elbow_l', 'l_elbow');
    if (elL) out.elbow_l = { x: elL.x, y: elL.y };

    const hdL = findLoc('left_wrist', 'left_hand', 'hand_l', 'l_wrist', 'l_hand');
    if (hdL) out.hand_l = { x: hdL.x, y: hdL.y };

    const shR = findLoc('right_shoulder', 'shoulder_r', 'r_shoulder');
    if (shR) out.shoulder_r = { x: shR.x, y: shR.y };

    const elR = findLoc('right_elbow', 'elbow_r', 'r_elbow');
    if (elR) out.elbow_r = { x: elR.x, y: elR.y };

    const hdR = findLoc('right_wrist', 'right_hand', 'hand_r', 'r_wrist', 'r_hand');
    if (hdR) out.hand_r = { x: hdR.x, y: hdR.y };

    const pel = findLoc('hip', 'root', 'pelvis', 'mid_hip');
    if (pel) out.pelvis = { x: pel.x, y: pel.y };

    const knL = findLoc('left_knee', 'knee_l', 'l_knee');
    if (knL) out.knee_l = { x: knL.x, y: knL.y };

    const ftL = findLoc('left_ankle', 'left_foot', 'foot_l', 'l_ankle', 'l_foot');
    if (ftL) out.foot_l = { x: ftL.x, y: ftL.y };

    const knR = findLoc('right_knee', 'knee_r', 'r_knee');
    if (knR) out.knee_r = { x: knR.x, y: knR.y };

    const ftR = findLoc('right_ankle', 'right_foot', 'foot_r', 'r_ankle', 'r_foot');
    if (ftR) out.foot_r = { x: ftR.x, y: ftR.y };

    return out;
  }

  // Live Animation Loop in Admin Studio
  function startAdPreviewLoop() {
    if (!importedChar || !adCtx) return;
    if (adAnimId) cancelAnimationFrame(adAnimId);

    const startTime = performance.now();

    function loop(now) {
      const t = (now - startTime) / 1000;
      adCtx.clearRect(0, 0, adPreviewCanvas.width, adPreviewCanvas.height);

      const cx = adPreviewCanvas.width / 2;
      const cy = adPreviewCanvas.height / 2;

      const motion = adMotionSelect.value || 'walk';
      const isSwim = (motion === 'swim');
      const isSpace = (motion === 'space');

      const bobSpeed = isSwim ? 3.5 : isSpace ? 2.0 : 4.5;
      const bob = Math.sin(t * bobSpeed) * 6;
      const tilt = Math.sin(t * 2.2) * (isSwim ? 0.1 : 0.07);

      const scale = 140 / Math.max(importedChar.width, importedChar.height);
      const dw = importedChar.width * scale;
      const dh = importedChar.height * scale;

      adCtx.save();
      adCtx.translate(cx, cy + bob);
      adCtx.rotate(tilt);

      // Draw character
      if (importedChar.charImg && importedChar.charImg.complete) {
        adCtx.drawImage(importedChar.charImg, -dw / 2, -dh / 2, dw, dh);
      }

      // Draw Skeleton Bones overlay
      const skel = importedChar.skeleton;
      const sx = (val) => (val - importedChar.width / 2) * scale;
      const sy = (val) => (val - importedChar.height / 2) * scale;

      adCtx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
      adCtx.lineWidth = 2.2;
      adCtx.lineCap = 'round';

      // Spine
      adCtx.beginPath();
      adCtx.moveTo(sx(skel.head.x), sy(skel.head.y));
      adCtx.lineTo(sx(skel.pelvis.x), sy(skel.pelvis.y));
      // Arms
      adCtx.moveTo(sx(skel.hand_l.x), sy(skel.hand_l.y));
      adCtx.lineTo(sx(skel.shoulder_l.x), sy(skel.shoulder_l.y));
      adCtx.lineTo(sx(skel.shoulder_r.x), sy(skel.shoulder_r.y));
      adCtx.lineTo(sx(skel.hand_r.x), sy(skel.hand_r.y));
      // Legs
      adCtx.moveTo(sx(skel.foot_l.x), sy(skel.foot_l.y));
      adCtx.lineTo(sx(skel.pelvis.x), sy(skel.pelvis.y));
      adCtx.lineTo(sx(skel.foot_r.x), sy(skel.foot_r.y));
      adCtx.stroke();

      // Joints
      adCtx.fillStyle = '#10b981';
      for (const k in skel) {
        adCtx.beginPath();
        adCtx.arc(sx(skel[k].x), sy(skel[k].y), 3.5, 0, Math.PI * 2);
        adCtx.fill();
      }

      adCtx.restore();

      adAnimId = requestAnimationFrame(loop);
    }

    adAnimId = requestAnimationFrame(loop);
  }

  adMotionSelect.addEventListener('change', () => {
    if (importedChar) {
      importedChar.motionType = adMotionSelect.value;
    }
  });

  // Action: Spawn to Media Wall
  btnAdSpawn.addEventListener('click', async () => {
    if (!importedChar) {
      alert('먼저 Animated Drawings 파일을 업로드해주세요.');
      return;
    }

    btnAdSpawn.disabled = true;
    btnAdSpawn.innerHTML = '<span>⏳</span> 미디어월 송출 중...';

    const charPayload = {
      id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      dataUrl: importedChar.dataUrl,
      skeleton: importedChar.skeleton,
      templateId: 'animated_drawings',
      motionType: adMotionSelect.value,
      scale: 1.0,
      timestamp: Date.now()
    };

    // 1. BroadcastChannel (Instant peer-to-peer across tabs)
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'SPAWN_CHARACTER',
          character: charPayload
        });
      } catch (e) {}
    }

    // 2. WebSocket (Local/VPS)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'SPAWN_CHARACTER',
          ...charPayload
        }));
      } catch (e) {}
    }

    // 3. HTTP REST API (/api/spawn - Vercel Serverless persistence)
    try {
      await fetch('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(charPayload)
      });
    } catch (e) {
      console.warn('HTTP spawn error:', e);
    }

    btnAdSpawn.disabled = false;
    btnAdSpawn.innerHTML = '<span>🚀</span> 미디어월 대형 스크린으로 즉시 송출';

    alert(`🚀 '${importedChar.name}' 캐릭터가 대형 미디어월 스크린에 즉시 등장했습니다!\n미디어월 화면을 확인해보세요.`);
  });

  // Action: Add to Kiosk Templates
  btnAdAddTemplate.addEventListener('click', async () => {
    if (!importedChar) return;

    if (confirm(`'${importedChar.name}' 캐릭터를 관람객 키오스크의 채색 도안으로 등록하시겠습니까?`)) {
      try {
        const res = await fetch('/api/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: importedChar.name,
            icon: '🎨',
            motionType: adMotionSelect.value,
            dataUrl: importedChar.dataUrl,
            skeleton: importedChar.skeleton
          })
        });

        const data = await res.json();
        if (data.success) {
          alert(`🎨 '${importedChar.name}' 도안이 성공적으로 등록되었습니다!\n키오스크 단말기에서 바로 채색할 수 있습니다.`);
          renderAdminTemplates(data.templates);
        } else {
          alert('도안 등록 실패: ' + (data.error || '알 수 없는 오류'));
        }
      } catch (err) {
        console.error('Failed to register template from AD:', err);
        alert('도안 등록 중 오류가 발생했습니다.');
      }
    }
  });

  // Init
  initWebSocket();
  searchImages('바다');
  fetchTemplates();

})();

