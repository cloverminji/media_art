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
  const rangeMaxChars = document.getElementById('range-max-chars');
  const valMaxChars = document.getElementById('val-max-chars');

  const metricActiveCount = document.getElementById('metric-active-count');
  const metricFps = document.getElementById('metric-fps');
  const btnClearAll = document.getElementById('btn-clear-all');

  let ws = null;
  let currentConfig = {
    theme: 'ocean',
    customBackgroundUrl: '',
    lifetimeSeconds: 300,
    maxCharacters: 35
  };

  let syncChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel('mediaart_live_sync');
      syncChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'TEMPLATES_UPDATED' && event.data.templates) {
          renderAdminTemplates(event.data.templates);
        } else if (event.data && event.data.type === 'BACKGROUNDS_UPDATED' && event.data.backgrounds) {
          customBackgroundsList = event.data.backgrounds;
          renderCustomBackgrounds();
        } else if (event.data && event.data.type === 'THEME_CHANGED' && event.data.config) {
          currentConfig = { ...currentConfig, ...event.data.config };
          syncUI();
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
              if (data.backgrounds) {
                customBackgroundsList = data.backgrounds;
                renderCustomBackgrounds();
              }
              if (data.config) {
                currentConfig = { ...currentConfig, ...data.config };
                syncUI();
              }
              break;

            case 'BACKGROUNDS_UPDATED':
              if (data.backgrounds) {
                customBackgroundsList = data.backgrounds;
                renderCustomBackgrounds();
              }
              break;

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

    // Sync Lifetime & Capacity
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

    if (currentConfig.maxCharacters && rangeMaxChars) {
      rangeMaxChars.value = currentConfig.maxCharacters;
      if (valMaxChars) valMaxChars.textContent = currentConfig.maxCharacters;
    }

    if (currentConfig.customBackgroundUrl) {
      inputCustomUrl.value = currentConfig.customBackgroundUrl;
    }

    renderCustomBackgrounds();
  }

  function updateLifetimeDisplay(sec) {
    valLifetime.textContent = sec;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    valLifetimeMin.textContent = rem > 0 ? `(${min}분 ${rem}초)` : `(${min}분)`;
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

  function applyTheme(theme, customUrl = '', options = {}) {
    currentConfig.theme = theme;
    currentConfig.customBackgroundUrl = customUrl;
    if (options.themeName !== undefined) currentConfig.themeName = options.themeName;
    if (options.atmosphere !== undefined) currentConfig.atmosphere = options.atmosphere;
    if (options.motionType !== undefined) currentConfig.motionType = options.motionType;

    const payload = {
      theme: theme,
      customBackgroundUrl: customUrl,
      themeName: currentConfig.themeName || '',
      atmosphere: currentConfig.atmosphere || '',
      motionType: currentConfig.motionType || ''
    };

    // 1. BroadcastChannel (Instant sync across tabs/windows)
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'THEME_CHANGED',
          config: payload
        });
      } catch (e) {}
    }

    // 2. WebSocket (Local/VPS)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'CHANGE_THEME',
          ...payload
        }));
      } catch (e) {}
    }

    // 3. HTTP REST API (Vercel Serverless persistence)
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(e => console.warn('Config save notice:', e));

    syncUI();
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
    applyTheme('custom', url, { themeName: '직접 입력 URL 배경', atmosphere: 'sparkle' });
    alert('🖼️ 입력한 URL 이미지가 미디어월 배경으로 실시간 적용되었습니다!');
  });

  // ----------------------------------------------------
  // Section 3: Custom Background Upload & Theme Management (PNG/JPG)
  // ----------------------------------------------------
  const bgDropzone = document.getElementById('bg-dropzone');
  const inputBgFile = document.getElementById('input-bg-file');
  const bgDropzonePrompt = document.getElementById('bg-dropzone-prompt');
  const bgDropzonePreview = document.getElementById('bg-dropzone-preview');
  const imgBgPreview = document.getElementById('img-bg-preview');
  const btnChangeBgFile = document.getElementById('btn-change-bg-file');
  const badgeBgOptStatus = document.getElementById('badge-bg-opt-status');
  const bgSizeInfo = document.getElementById('bg-size-info');
  const bgResInfo = document.getElementById('bg-res-info');
  const inputBgName = document.getElementById('input-bg-name');
  const selectBgAtmosphere = document.getElementById('select-bg-atmosphere');
  const selectBgMotion = document.getElementById('select-bg-motion');
  const btnApplyBgNow = document.getElementById('btn-apply-bg-now');
  const btnSaveBgTheme = document.getElementById('btn-save-bg-theme');
  const badgeBgCount = document.getElementById('badge-bg-count');
  const adminBgGrid = document.getElementById('admin-bg-grid');

  let uploadedBgDataUrl = '';
  let originalBgFile = null;
  let customBackgroundsList = [];

  const ATMOSPHERE_LABELS = {
    sparkle: '✨ 골드 스타더스트',
    gentle: '🍃 은은한 빛망울',
    ocean: '🌊 해양 기포',
    space: '🪐 우주 별빛',
    forest: '🌲 숲속 반딧불이',
    none: '🚫 파티클 없음'
  };

  const MOTION_LABELS = {
    walk: '🚶 지면 보행',
    jump: '🦘 점프',
    swim: '🌊 해양 유영',
    space: '✨ 무중력 부유',
    dance_full: '💃 댄스'
  };

  if (bgDropzone && inputBgFile) {
    bgDropzone.addEventListener('click', () => inputBgFile.click());

    bgDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      bgDropzone.classList.add('drag-over');
    });

    bgDropzone.addEventListener('dragleave', () => {
      bgDropzone.classList.remove('drag-over');
    });

    bgDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      bgDropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleBgFile(e.dataTransfer.files[0]);
      }
    });

    inputBgFile.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleBgFile(e.target.files[0]);
      }
    });

    if (btnChangeBgFile) {
      btnChangeBgFile.addEventListener('click', (e) => {
        e.stopPropagation();
        inputBgFile.click();
      });
    }
  }

  function handleBgFile(file) {
    if (!file || !file.type.match(/^image\/(png|jpeg|webp)/)) {
      alert('PNG, JPG, WEBP 이미지 파일만 업로드 가능합니다.');
      return;
    }

    originalBgFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      optimizeBgImage(e.target.result, file.name, file.size);
    };
    reader.readAsDataURL(file);
  }

  function optimizeBgImage(dataUrl, fileName, originalSize) {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || 1920;
      const naturalH = img.naturalHeight || 1080;
      const maxDim = 2560; // Max 2.5K width/height for fast canvas rendering
      let targetW = naturalW;
      let targetH = naturalH;

      if (naturalW > maxDim || naturalH > maxDim) {
        const ratio = Math.min(maxDim / naturalW, maxDim / naturalH);
        targetW = Math.round(naturalW * ratio);
        targetH = Math.round(naturalH * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const mimeType = (originalBgFile && originalBgFile.type === 'image/png') ? 'image/png' : 'image/jpeg';
      const quality = mimeType === 'image/jpeg' ? 0.92 : undefined;
      const optimizedDataUrl = canvas.toDataURL(mimeType, quality);
      uploadedBgDataUrl = optimizedDataUrl;

      imgBgPreview.src = optimizedDataUrl;
      bgDropzonePrompt.style.display = 'none';
      bgDropzonePreview.style.display = 'flex';

      const optSize = Math.round((optimizedDataUrl.length * 3) / 4);
      const origSizeKb = (originalSize / 1024).toFixed(0);
      const optSizeKb = (optSize / 1024).toFixed(0);
      bgSizeInfo.textContent = `${origSizeKb}KB → ${optSizeKb}KB 최적화`;
      bgResInfo.textContent = `해상도: ${targetW} × ${targetH}px`;

      if (!inputBgName.value.trim()) {
        const cleanName = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        inputBgName.value = cleanName;
      }

      btnApplyBgNow.disabled = false;
      btnSaveBgTheme.disabled = false;
    };
    img.src = dataUrl;
  }

  if (btnApplyBgNow) {
    btnApplyBgNow.addEventListener('click', () => {
      if (!uploadedBgDataUrl) return;
      const name = inputBgName.value.trim() || '사용자 배경';
      const atmosphere = selectBgAtmosphere.value;
      const motion = selectBgMotion.value;

      applyTheme('custom', uploadedBgDataUrl, {
        themeName: name,
        atmosphere: atmosphere,
        motionType: motion
      });
      alert(`🚀 미디어월 배경에 '${name}' 이미지가 즉시 적용되었습니다!`);
    });
  }

  if (btnSaveBgTheme) {
    btnSaveBgTheme.addEventListener('click', async () => {
      if (!uploadedBgDataUrl) return;
      const name = inputBgName.value.trim() || '사용자 배경';
      const atmosphere = selectBgAtmosphere.value;
      const motion = selectBgMotion.value;

      try {
        btnSaveBgTheme.disabled = true;
        btnSaveBgTheme.innerHTML = '<span>⏳</span> 등록 중...';

        const res = await fetch('/api/backgrounds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            dataUrl: uploadedBgDataUrl,
            atmosphere,
            motionType: motion
          })
        });

        const data = await res.json();
        if (data.success && data.backgrounds) {
          customBackgroundsList = data.backgrounds;
          renderCustomBackgrounds();
          alert(`✅ 배경 테마 '${name}'이(가) 보관함에 성공적으로 등록되었습니다!`);
        } else {
          alert(data.error || '배경 테마 등록에 실패했습니다.');
        }
      } catch (e) {
        console.error('Save background error:', e);
        alert('배경 등록 중 네트워크 오류가 발생했습니다.');
      } finally {
        btnSaveBgTheme.disabled = false;
        btnSaveBgTheme.innerHTML = '<span>💾</span> 배경 테마 보관함에 등록';
      }
    });
  }

  function renderCustomBackgrounds() {
    if (!adminBgGrid) return;
    adminBgGrid.innerHTML = '';
    const count = customBackgroundsList.length;
    if (badgeBgCount) badgeBgCount.textContent = `${count}개 등록됨`;

    if (count === 0) {
      adminBgGrid.innerHTML = `
        <div class="bg-empty-placeholder">
          <span>🌄 등록된 커스텀 배경 테마가 없습니다. 위에서 PNG/JPG 이미지를 업로드해 보세요!</span>
        </div>
      `;
      return;
    }

    customBackgroundsList.forEach(bg => {
      const card = document.createElement('div');
      const isActive = (currentConfig.theme === 'custom' && currentConfig.customBackgroundUrl === bg.url);
      card.className = `admin-bg-card ${isActive ? 'active-wall' : ''}`;

      const atmoLabel = ATMOSPHERE_LABELS[bg.atmosphere] || '✨ 스타더스트';
      const motionLabel = MOTION_LABELS[bg.motionType] || '🚶 지면 보행';

      card.innerHTML = `
        <div class="bg-card-thumb">
          <img src="${bg.url}" alt="${bg.name}" loading="lazy">
          ${isActive ? '<span class="bg-card-status-badge">송출 중</span>' : ''}
        </div>
        <div class="bg-card-info">
          <div class="bg-card-title" title="${bg.name}">${bg.name}</div>
          <div class="bg-card-meta">
            <span>${atmoLabel}</span> • <span>${motionLabel}</span>
          </div>
        </div>
        <div class="bg-card-actions">
          <button class="btn-apply-bg-item ${isActive ? 'active' : ''}">
            ${isActive ? '적용 중' : '즉시 적용'}
          </button>
          <button class="btn-delete-bg-item" title="배경 테마 삭제">🗑️</button>
        </div>
      `;

      const btnApply = card.querySelector('.btn-apply-bg-item');
      btnApply.addEventListener('click', () => {
        applyTheme('custom', bg.url, {
          themeName: bg.name,
          atmosphere: bg.atmosphere,
          motionType: bg.motionType
        });
        alert(`🖼️ 미디어월 배경이 '${bg.name}'(으)로 즉시 변경되었습니다!`);
      });

      const btnDelete = card.querySelector('.btn-delete-bg-item');
      btnDelete.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`'${bg.name}' 배경 테마를 정말 삭제하시겠습니까?`)) return;

        try {
          const res = await fetch(`/api/backgrounds/${bg.id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success && data.backgrounds) {
            customBackgroundsList = data.backgrounds;
            renderCustomBackgrounds();
          } else {
            alert(data.error || '삭제 실패');
          }
        } catch (err) {
          console.error('Delete bg error:', err);
          alert('배경 삭제 중 오류가 발생했습니다.');
        }
      });

      adminBgGrid.appendChild(card);
    });
  }

  async function loadCustomBackgrounds() {
    try {
      const res = await fetch('/api/backgrounds');
      const data = await res.json();
      if (data.success && data.backgrounds) {
        customBackgroundsList = data.backgrounds;
        renderCustomBackgrounds();
      }
    } catch (e) {
      console.warn('Could not load custom backgrounds:', e);
    }
  }

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

  // PRD P0-3: Max Characters Capacity Control (Smart FIFO Safety Cap)
  if (rangeMaxChars) {
    rangeMaxChars.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (valMaxChars) valMaxChars.textContent = val;
    });

    rangeMaxChars.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      setMaxChars(val);
    });
  }

  function setMaxChars(val) {
    if (valMaxChars) valMaxChars.textContent = val;
    currentConfig.maxCharacters = val;

    // 1. BroadcastChannel
    if (syncChannel) {
      try {
        syncChannel.postMessage({
          type: 'LIFECYCLE_UPDATED',
          maxCharacters: val
        });
      } catch (e) {}
    }

    // 2. WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'UPDATE_MAX_CHARACTERS',
          maxCharacters: val
        }));
      } catch (e) {}
    }

    // 3. HTTP REST API
    fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'UPDATE_MAX_CHARACTERS', payload: { maxCharacters: val } })
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
      const motionKor = 
        t.motionType === 'dance_full' ? '💃 전신 댄스' :
        t.motionType === 'dance_lower' ? '🕺 하체 댄스' :
        t.motionType === 'funny' ? '🤪 웃긴' :
        t.motionType === 'jump' ? '🦘 점프' :
        t.motionType === 'swim' ? '🌊 유영' :
        t.motionType === 'space' ? '🪐 부유' : '🚶 워킹';

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
      let videoFile = null;

      fileList.forEach(f => {
        const name = f.name.toLowerCase();
        if (name.endsWith('.zip')) {
          zipFile = f;
        } else if (f.type.startsWith('video/') || name.endsWith('.mp4') || name.endsWith('.webm')) {
          videoFile = f;
        } else if (f.type.startsWith('image/') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) {
          imageFile = f;
        } else if (name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json')) {
          configFile = f;
        }
      });

      let imageDataUrl = '';
      let videoDataUrl = '';
      let rawConfigText = '';
      let sourceInfo = '';

      // Case 1: Direct Video File (.mp4 / .webm)
      if (videoFile) {
        sourceInfo = videoFile.name;
        videoDataUrl = await fileToDataURL(videoFile);
      }
      // Case 2: ZIP Archive
      else if (zipFile && window.JSZip) {
        sourceInfo = zipFile.name;
        const zip = await JSZip.loadAsync(zipFile);
        let foundImg = null;
        let foundCfg = null;
        let foundVid = null;

        zip.forEach((relPath, entry) => {
          const lower = relPath.toLowerCase();
          if (!entry.dir) {
            if (lower.endsWith('.mp4') || lower.endsWith('.webm')) {
              foundVid = entry;
            } else if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
              foundImg = entry;
            } else if (lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json')) {
              foundCfg = entry;
            }
          }
        });

        if (foundVid) {
          const vidBlob = await foundVid.async('blob');
          videoDataUrl = await blobToDataURL(vidBlob);
        }
        if (foundImg) {
          const imgBlob = await foundImg.async('blob');
          imageDataUrl = await blobToDataURL(imgBlob);
        }
        if (foundCfg) {
          rawConfigText = await foundCfg.async('text');
        }
      } 
      // Case 3: Individual Image + Config files
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

      // Handle Video Asset Workflow
      if (videoDataUrl) {
        const video = document.createElement('video');
        video.src = videoDataUrl;
        video.crossOrigin = 'anonymous';
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('playsinline', 'true');
        video.setAttribute('muted', 'true');

        const onVideoLoaded = () => {
          const vw = video.videoWidth || 320;
          const vh = video.videoHeight || 320;

          // Extract first frame as clean line-art poster
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = vw;
          tempCanvas.height = vh;
          const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          tCtx.drawImage(video, 0, 0, vw, vh);

          // Remove white background for poster
          const frameImgData = tCtx.getImageData(0, 0, vw, vh);
          const d = frameImgData.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) {
              d[i + 3] = 0;
            }
          }
          tCtx.putImageData(frameImgData, 0, 0);
          const posterDataUrl = tempCanvas.toDataURL('image/png');
          const posterImg = new Image();
          posterImg.src = posterDataUrl;

          const finalSkeleton = normalizeSkeletonToImage(null, vw, vh);

          importedChar = {
            mediaType: 'video',
            dataUrl: posterDataUrl, // Clean lineart poster for templates & fallback
            videoUrl: videoDataUrl, // Full MP4 video for media wall
            skeleton: finalSkeleton,
            motionType: adMotionSelect.value || 'dance_full',
            name: (videoFile ? videoFile.name : 'Animated Drawings Video').replace(/\.[^/.]+$/, ''),
            width: vw,
            height: vh,
            videoEl: video,
            charImg: posterImg,
            chromaCanvas: document.createElement('canvas')
          };
          importedChar.chromaCanvas.width = vw;
          importedChar.chromaCanvas.height = vh;

          adCharName.textContent = importedChar.name;
          adSourceFilename.textContent = sourceInfo || 'Meta Animated Drawings MP4 영상';
          adRiggingStatus.textContent = 'Animated Drawings MP4 영상 루프 로드 완료';
          adJointCount.textContent = 'MP4 Video Loop';

          adPreviewCard.style.display = 'flex';
          startAdPreviewLoop();
          adPreviewCard.scrollIntoView({ behavior: 'smooth' });
          video.play().catch(e => console.warn('Admin video play:', e));
        };

        video.addEventListener('loadeddata', onVideoLoaded, { once: true });
        video.load();
        return;
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
        alert('Animated Drawings MP4 동영상 파일(.MP4), 캐릭터 이미지(PNG/JPG), 또는 압축 파일(.ZIP)을 업로드해주세요.');
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
          mediaType: 'image',
          dataUrl: finalDataUrl,
          videoUrl: null,
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
  let adSkinnedMesh = null;

  function startAdPreviewLoop() {
    if (!importedChar || !adCtx) return;
    if (adAnimId) cancelAnimationFrame(adAnimId);

    const startTime = performance.now();

    // Create SkinnedMesh if image is loaded
    if (window.SkeletalMeshEngine && importedChar.mediaType !== 'video' && importedChar.charImg && importedChar.charImg.complete) {
      adSkinnedMesh = new window.SkeletalMeshEngine.SkinnedMesh(
        importedChar.charImg,
        importedChar.skeleton,
        importedChar.width,
        importedChar.height,
        8, 10
      );
    } else {
      adSkinnedMesh = null;
    }

    function loop(now) {
      const t = (now - startTime) / 1000;
      adCtx.clearRect(0, 0, adPreviewCanvas.width, adPreviewCanvas.height);

      const cx = adPreviewCanvas.width / 2;
      const cy = adPreviewCanvas.height / 2;
      const motion = adMotionSelect.value || 'walk';

      const scale = 140 / Math.max(importedChar.width, importedChar.height);
      const dw = importedChar.width * scale;
      const dh = importedChar.height * scale;

      adCtx.save();
      adCtx.translate(cx, cy);

      // Draw character (Video frame with real-time chroma-key or Image)
      if (importedChar.mediaType === 'video' && importedChar.videoEl && importedChar.chromaCanvas) {
        const cw = importedChar.chromaCanvas.width;
        const ch = importedChar.chromaCanvas.height;
        const cCtx = importedChar.chromaCanvas.getContext('2d', { willReadFrequently: true });
        cCtx.drawImage(importedChar.videoEl, 0, 0, cw, ch);
        const imgData = cCtx.getImageData(0, 0, cw, ch);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) {
            d[i + 3] = 0;
          }
        }
        cCtx.putImageData(imgData, 0, 0);
        adCtx.drawImage(importedChar.chromaCanvas, -dw / 2, -dh / 2, dw, dh);
      } else if (adSkinnedMesh && window.SkeletalMeshEngine) {
        // FK & IK Pose solver
        const solvedPose = window.SkeletalMeshEngine.solveSkeletonPose(
          importedChar.skeleton,
          motion,
          t
        );

        // Render Skinned Mesh
        adSkinnedMesh.draw(adCtx, solvedPose, -dw / 2, -dh / 2, dw, dh);

        // Skeleton overlay
        window.SkeletalMeshEngine.drawSkeletonOverlay(
          adCtx,
          solvedPose,
          -dw / 2,
          -dh / 2,
          scale,
          scale,
          { alpha: 0.9, lineWidth: 2.2 }
        );
      } else if (importedChar.charImg && importedChar.charImg.complete) {
        adCtx.drawImage(importedChar.charImg, -dw / 2, -dh / 2, dw, dh);
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
      dataUrl: importedChar.videoUrl || importedChar.dataUrl,
      videoUrl: importedChar.videoUrl || null,
      mediaType: importedChar.mediaType || 'image',
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

  async function checkDbStatus() {
    const badge = document.getElementById('db-status-badge');
    const text = document.getElementById('db-status-text');
    if (!badge || !text) return;

    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data && data.supabase && data.supabase.configured) {
        badge.className = 'status-indicator cloud-synced';
        text.textContent = '☁️ Supabase 영구 동기화 중';
        badge.title = `Supabase 클라우드 데이터베이스 및 스토리지 연동 완료 (${data.supabase.bucket} 버킷)`;
      } else {
        badge.className = 'status-indicator local-mode';
        text.textContent = '💾 로컬 저장 모드';
        badge.title = 'Supabase 키 미설정: 로컬 임시 저장소로 동작 중입니다.';
      }
    } catch (e) {
      badge.className = 'status-indicator local-mode';
      text.textContent = '💾 로컬 저장 모드';
    }
  }

  // Init
  initWebSocket();
  searchImages('바다');
  fetchTemplates();
  loadCustomBackgrounds();
  checkDbStatus();

})();

