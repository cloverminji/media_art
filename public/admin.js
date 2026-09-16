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

  // ----------------------------------------------------
  // WebSocket Connection
  // ----------------------------------------------------
  function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
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

    ws.onclose = () => {
      setTimeout(initWebSocket, 2000);
    };
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
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'CHANGE_THEME',
        theme: theme,
        customBackgroundUrl: customUrl
      }));
    }
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

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'UPDATE_LIFECYCLE',
        lifetimeSeconds: val
      }));
    }
  }

  // Clear all characters
  btnClearAll.addEventListener('click', () => {
    if (confirm('현재 미디어월의 모든 캐릭터를 즉시 페이드아웃 퇴장시키겠습니까?')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CLEAR_ALL_CHARACTERS' }));
      }
    }
  });

  // Init
  initWebSocket();
  searchImages('바다');

})();
