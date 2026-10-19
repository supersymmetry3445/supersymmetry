'use strict';

const CATEGORIES = [
  { id: 'all', label: 'Recentes' },
  { id: 'multiplayer', label: 'Multiplayer 2–4P' },
  { id: 'snes', label: 'Super Nintendo' },
  { id: 'gba', label: 'Game Boy Advance' },
  { id: 'segaMD', label: 'Mega Drive' },
  { id: 'psx', label: 'PlayStation' }
];

function detectMobileOrTouch() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const touchPoints = navigator.maxTouchPoints && navigator.maxTouchPoints > 0;
  return Boolean(coarse || touchPoints);
}

const state = {
  games: [],
  filteredGames: [],
  focusedIndex: 0,
  selectedCategory: 'all',
  searchQuery: '',
  consoles: [],
  rooms: [],
  gpu: null,
  peerId: null,
  ws: null,
  activeRoom: null,
  isHost: false,
  mySlot: 1,
  peerConnections: new Map(),
  dataChannels: new Map(),
  lastPadNavTs: 0,
  touchPadEnabled: detectMobileOrTouch(),
  gamepadOnlyMode: false,
  uiSoundEnabled: true,
  audioCtx: null,
  virtualButtons: new Array(16).fill(0),
  virtualAxes: [0, 0, 0, 0],
  activePointers: new Map(),
  dpadPointerId: null
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function getOrCreateAudioContext() {
  if (!state.uiSoundEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.audioCtx) {
    state.audioCtx = new AudioCtx();
  }
  if (state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

function playConsoleTone(freqHz, durationSec, gainLevel = 0.035) {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz, ctx.currentTime);
    gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
  } catch {
    // Ignore audio context restrictions before user gesture
  }
}

function triggerHapticPulse(durationMs = 12) {
  if (navigator.vibrate) {
    navigator.vibrate(durationMs);
    return;
  }
  const iosLabel = document.getElementById('iosHapticLabel');
  if (iosLabel) {
    iosLabel.click();
  }
}

function isClickInsideRect(rect, event) {
  const withinVertical = rect.top <= event.clientY && event.clientY <= rect.top + rect.height;
  const withinHorizontal = rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
  return withinVertical && withinHorizontal;
}

function setupDialogLightDismiss() {
  document.querySelectorAll('dialog.console-dialog').forEach((dialog) => {
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        if (!isClickInsideRect(dialog.getBoundingClientRect(), event)) {
          dialog.close();
        }
      });
    }
  });

  document.querySelectorAll('[data-close-dialog]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-close-dialog'));
      if (target) target.close();
    });
  });
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const el = document.getElementById('systemClock');
  if (el) el.textContent = `${hh}:${mm}`;
}

function getPlayerName() {
  const input = document.getElementById('playerNameInput');
  return (input && input.value.trim()) || 'Player 1';
}

async function fetchDeckLibrary() {
  const res = await fetch('/api/deck').then((r) => r.json());
  state.games = res.games || [];
  state.consoles = res.consoles || [];
  state.rooms = res.rooms || [];
  state.gpu = res.gpu || null;

  populateUploadConsoleSelect();
  renderCategoryTabs();
  applyFiltersAndRender();
  renderRoomsShelf();
}

function populateUploadConsoleSelect() {
  const select = document.getElementById('uploadConsoleSelect');
  if (!select) return;
  select.innerHTML = '';
  state.consoles.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

function renderCategoryTabs() {
  const nav = document.getElementById('consoleTabs');
  nav.innerHTML = '';
  CATEGORIES.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn ${state.selectedCategory === cat.id ? 'active' : ''}`;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => selectCategory(cat.id));
    nav.appendChild(btn);
  });
}

function selectCategory(categoryId) {
  state.selectedCategory = categoryId;
  state.focusedIndex = 0;
  playConsoleTone(520, 0.045, 0.03);
  const catObj = CATEGORIES.find((c) => c.id === categoryId);
  const shelfTitle = document.getElementById('shelfTitle');
  if (shelfTitle && catObj) shelfTitle.textContent = catObj.label;
  renderCategoryTabs();
  applyFiltersAndRender();
}

function stepCategory(delta) {
  const idx = CATEGORIES.findIndex((c) => c.id === state.selectedCategory);
  const nextIdx = (idx + delta + CATEGORIES.length) % CATEGORIES.length;
  selectCategory(CATEGORIES[nextIdx].id);
}

function matchesSelectedCategory(game) {
  if (state.selectedCategory === 'all') return true;
  if (state.selectedCategory === 'multiplayer') return game.maxPlayers >= 2;
  return game.consoleId === state.selectedCategory;
}

function matchesSearchQuery(game) {
  if (!state.searchQuery) return true;
  const q = state.searchQuery.toLowerCase();
  return game.title.toLowerCase().includes(q) || game.consoleName.toLowerCase().includes(q);
}

function applyFiltersAndRender() {
  state.filteredGames = state.games.filter(
    (g) => matchesSelectedCategory(g) && matchesSearchQuery(g)
  );
  if (state.focusedIndex >= state.filteredGames.length) {
    state.focusedIndex = 0;
  }
  renderCapsulesGrid();
  updateHeroSpotlight();
}

function renderCapsulesGrid() {
  const grid = document.getElementById('capsulesGrid');
  const countEl = document.getElementById('shelfCountLabel');
  grid.innerHTML = '';
  countEl.textContent = `${state.filteredGames.length} títulos`;

  state.filteredGames.forEach((game, idx) => {
    const card = document.createElement('div');
    card.className = `capsule-card ${idx === state.focusedIndex ? 'focused' : ''}`;
    card.dataset.gameIndex = String(idx);
    card.tabIndex = 0;
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', idx === state.focusedIndex ? 'true' : 'false');

    const imgHtml = game.boxartUrl
      ? `<img class="capsule-art" src="${escapeHtml(game.boxartUrl)}" alt="${escapeHtml(game.title)}" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="capsule-fallback">${escapeHtml(game.title)}</div>`;

    card.innerHTML = `
      <div class="capsule-pedestal">
        <div class="capsule-ambient" style="background-image: url('${escapeHtml(game.boxartUrl || '')}')"></div>
        <div class="capsule-art-wrap">${imgHtml}</div>
      </div>
      <div class="capsule-meta">
        <div class="capsule-title">${escapeHtml(game.title)}</div>
        <div class="capsule-submeta">
          <span>${escapeHtml(game.consoleName)}</span><span class="meta-dot">•</span><span>${game.maxPlayers}P</span>
        </div>
      </div>
    `;

    card.addEventListener('mouseenter', () => setFocusedGameIndex(idx, false));
    card.addEventListener('click', () => {
      if (state.focusedIndex === idx) {
        launchGameItem(game);
      } else {
        setFocusedGameIndex(idx, true);
      }
    });
    if (state.snapObserver) state.snapObserver.observe(card);
    grid.appendChild(card);
  });
}

function setFocusedGameIndex(newIndex, scrollIntoView = true) {
  if (state.filteredGames.length === 0) return;
  const clamped = Math.max(0, Math.min(state.filteredGames.length - 1, newIndex));
  if (clamped !== state.focusedIndex) {
    playConsoleTone(680, 0.035, 0.025);
  }
  state.focusedIndex = clamped;

  const cards = document.querySelectorAll('#capsulesGrid .capsule-card');
  cards.forEach((card, i) => {
    card.classList.toggle('focused', i === clamped);
    card.setAttribute('aria-selected', i === clamped ? 'true' : 'false');
    if (i === clamped && scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  });
  updateHeroSpotlight();
}

function handleCarouselWheel(ev) {
  if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX)) return;
  ev.preventDefault();
  setFocusedGameIndex(state.focusedIndex + (ev.deltaY > 0 ? 1 : -1), true);
}

function syncSnappedCardElement(targetEl) {
  if (!targetEl || targetEl.dataset.gameIndex === undefined) return;
  setFocusedGameIndex(Number(targetEl.dataset.gameIndex), false);
}

function bindCarouselScrollSync() {
  const scroller = document.getElementById('capsulesGrid');
  if (!scroller) return;

  scroller.addEventListener('wheel', handleCarouselWheel, { passive: false });

  if ('onscrollsnapchange' in HTMLElement.prototype) {
    scroller.addEventListener('scrollsnapchange', (ev) => syncSnappedCardElement(ev.snapTargetInline));
    return;
  }

  if ('IntersectionObserver' in window) {
    state.snapObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) syncSnappedCardElement(visible.target);
      },
      { root: scroller, threshold: 0.85 }
    );
  }
}

function updateHeroSpotlight() {
  const game = state.filteredGames[state.focusedIndex];
  if (!game) return;

  document.documentElement.style.setProperty('--game-accent', game.accent);
  document.getElementById('heroYearTag').textContent = game.year;
  document.getElementById('heroConsoleTag').textContent = game.consoleName;
  document.getElementById('heroPlayersTag').textContent =
    game.maxPlayers > 1 ? `Até ${game.maxPlayers} Jogadores` : '1 Jogador';
  document.getElementById('heroStatusTag').textContent = '99% relevante';
  document.getElementById('heroTitle').textContent = game.title;
  document.getElementById('heroSubtitle').textContent = game.genre;
  document.getElementById('heroSynopsis').textContent = game.synopsis;

  document.getElementById('heroBackdrop').style.backgroundImage = `url("${game.boxartUrl}")`;
  document.getElementById('heroBoxartImg').src = game.boxartUrl;
  document.getElementById('heroSnapImg').src = game.snapUrl;
}

async function launchFocusedGame() {
  const game = state.filteredGames[state.focusedIndex];
  if (game) {
    await launchGameItem(game);
  }
}

async function ensureCatalogRomOnServer(game) {
  const res = await fetch(`/api/catalog/${encodeURIComponent(game.slug)}/ensure`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error('Falha ao preparar o jogo');
  const data = await res.json();
  game.id = data.rom.id;
  game.installed = true;
  return data.rom;
}

async function launchGameItem(game) {
  playConsoleTone(880, 0.12, 0.045);
  const playBtnText = document.getElementById('heroPlayBtnText');
  const prevLabel = playBtnText.textContent;
  playBtnText.textContent = 'INICIANDO...';

  try {
    const resolved = !game.id && game.slug ? await ensureCatalogRomOnServer(game) : game;
    mountEmulatorJs(resolved.core, `/api/roms/${resolved.id}/file`, resolved.title);
    sendWs({
      type: 'create-room',
      playerName: getPlayerName(),
      consoleId: resolved.consoleId,
      consoleName: resolved.consoleName,
      romId: resolved.id,
      gameTitle: resolved.title,
      mode: 'wasm-p2p'
    });
  } finally {
    playBtnText.textContent = prevLabel;
  }
}

function launchLocalFileAsHost(file) {
  const ext = `.${file.name.split('.').pop().toLowerCase()}`;
  const matched = state.consoles.find((c) => c.extensions.includes(ext)) || state.consoles[0];
  const blobUrl = URL.createObjectURL(file);
  const title = file.name.replace(/\.[^.]+$/, '');

  const qam = document.getElementById('quickAccessDialog');
  if (qam.open) qam.close();

  mountEmulatorJs(matched.core, blobUrl, title);
  sendWs({
    type: 'create-room',
    playerName: getPlayerName(),
    consoleId: matched.id,
    consoleName: matched.shortName,
    gameTitle: title,
    mode: 'wasm-p2p'
  });
}

function renderRoomsShelf() {
  const shelf = document.getElementById('liveRoomsShelf');
  const grid = document.getElementById('roomsGrid');
  const badge = document.getElementById('roomsCountBadge');
  const qamList = document.getElementById('qamRoomsList');

  badge.textContent = `Salas (${state.rooms.length})`;
  grid.innerHTML = '';
  qamList.innerHTML = '';

  if (state.rooms.length === 0) {
    shelf.classList.add('hidden');
    qamList.textContent = 'Nenhuma sala aberta no momento. Inicie qualquer jogo para abrir uma sala.';
    return;
  }

  shelf.classList.remove('hidden');
  state.rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-banner-card';
    card.innerHTML = `
      <div>
        <div class="tag-pill tag-system" style="display:inline-block;margin-bottom:3px">${escapeHtml(room.consoleName)}</div>
        <div style="font-weight:800;font-size:0.88rem">${escapeHtml(room.gameTitle)}</div>
        <div style="font-size:0.72rem;color:var(--steam-muted)">Host: ${escapeHtml(room.hostName)} · ${room.players.length}/4 Controles</div>
      </div>
      <button type="button" class="btn-steam-play" style="padding:0.45rem 0.9rem;font-size:0.78rem">Entrar</button>
    `;
    card.addEventListener('click', () => joinRoomById(room.id));
    grid.appendChild(card);

    const qamBtn = document.createElement('button');
    qamBtn.type = 'button';
    qamBtn.className = 'qam-action-btn';
    qamBtn.textContent = `🎮 ${room.gameTitle} (${room.players.length}/4) — Entrar`;
    qamBtn.addEventListener('click', () => {
      document.getElementById('quickAccessDialog').close();
      joinRoomById(room.id);
    });
    qamList.appendChild(qamBtn);
  });
}

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('message', (ev) => handleWsMessage(JSON.parse(ev.data)));
  ws.addEventListener('close', () => setTimeout(connectWebSocket, 2500));
}

function sendWs(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

const WS_HANDLERS = {
  welcome: (msg) => {
    state.peerId = msg.peerId;
    state.rooms = msg.rooms || [];
    renderRoomsShelf();
  },
  'rooms-updated': (msg) => {
    state.rooms = msg.rooms || [];
    renderRoomsShelf();
  },
  'gpu-updated': (msg) => {
    state.gpu = msg.gpu;
  },
  'room-joined': (msg) => onRoomJoined(msg),
  'peer-joined': (msg) => {
    state.activeRoom = msg.room;
    renderControllerSlots();
    appendChatLine('Console', `${msg.name} assumiu o Controle ${msg.slot || 'Espectador'}.`);
    if (state.isHost) startHostPeerConnection(msg.peerId);
  },
  'peer-left': (msg) => {
    state.activeRoom = msg.room;
    closePeerConnection(msg.peerId);
    renderControllerSlots();
    appendChatLine('Console', `${msg.name} desconectou.`);
  },
  'room-closed': () => closeConsoleStage(),
  'webrtc-signal': (msg) => handleWebRtcSignal(msg),
  'pad-input': (msg) => forwardRemotePadToEmulator(msg),
  'chat-msg': (msg) => appendChatLine(`P${msg.slot || '?'} ${msg.fromName}`, msg.text)
};

function handleWsMessage(msg) {
  const handler = WS_HANDLERS[msg.type];
  if (handler) handler(msg);
}

function syncTouchControlsVisibility() {
  const vpad = document.getElementById('virtualGamepad');
  const touchBtn = document.getElementById('toggleTouchPadBtn');
  const padOnlyBtn = document.getElementById('toggleGamepadOnlyBtn');
  const wrapper = document.getElementById('viewportWrapper');
  const banner = document.getElementById('controllerOnlyBanner');
  const slotBadge = document.getElementById('padOnlySlotBadge');

  const showPad = state.touchPadEnabled || state.gamepadOnlyMode;
  vpad.classList.toggle('hidden', !showPad);
  touchBtn.classList.toggle('active', showPad);
  padOnlyBtn.classList.toggle('active', state.gamepadOnlyMode);
  wrapper.classList.toggle('gamepad-only-mode', state.gamepadOnlyMode);
  banner.classList.toggle('hidden', !state.gamepadOnlyMode);
  if (slotBadge) {
    slotBadge.textContent = `CONTROLE ${state.mySlot || 1} ATIVO`;
  }
}

function onRoomJoined(msg) {
  state.activeRoom = msg.room;
  state.mySlot = msg.slot;
  state.isHost = msg.isHost;

  document.getElementById('consoleStage').classList.remove('hidden');
  document.getElementById('activeRoomCode').textContent = `Sala #${msg.room.id}`;
  document.getElementById('stageConsoleBadge').textContent = msg.room.consoleName;
  document.getElementById('stageGameTitle').textContent = msg.room.gameTitle;
  document.getElementById('stageRoleBadge').textContent = `P${msg.slot}`;

  syncTouchControlsVisibility();
  renderControllerSlots();
  if (!msg.isHost) {
    setupGuestStreamView();
  }
}

function renderControllerSlots() {
  const list = document.getElementById('controllerSlotsList');
  list.innerHTML = '';
  const players = state.activeRoom ? state.activeRoom.players : [];

  for (let slot = 1; slot <= 4; slot += 1) {
    const occupant = players.find((p) => p.slot === slot);
    const li = document.createElement('li');
    li.className = `slot-item ${occupant ? 'occupied' : ''}`;
    li.innerHTML = `
      <span>Controle ${slot}</span>
      <strong>${occupant ? escapeHtml(occupant.name) : 'Livre'}</strong>
    `;
    list.appendChild(li);
  }
}

function appendChatLine(author, text) {
  const box = document.getElementById('roomChatMessages');
  const div = document.createElement('div');
  div.innerHTML = `<strong>${escapeHtml(author)}:</strong> ${escapeHtml(text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function buildEmulatorIframeHtml(core, romUrl, title) {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    html,body,#game{margin:0;padding:0;width:100%;height:100%;background:#000000;overflow:hidden;}
    .ejs_virtual_gamepad_parent{display:none !important;}
  </style>
</head>
<body>
  <div id="game"></div>
  <script>
    window.EJS_player = '#game';
    window.EJS_core = ${JSON.stringify(core)};
    window.EJS_gameUrl = ${JSON.stringify(romUrl)};
    window.EJS_gameName = ${JSON.stringify(title)};
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#1a9fff';
    window.EJS_backgroundColor = '#000000';
    window.EJS_VirtualGamepadSettings = [];

    const W3C_TO_RETRO = {0:0, 1:8, 2:1, 3:9, 4:10, 5:11, 6:12, 7:13, 8:2, 9:3, 12:4, 13:5, 14:6, 15:7};
    const prevBySlot = {};

    window.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (!msg || msg.type !== 'supersymmetry-remote-pad') return;
      const gm = window.EJS_emulator && window.EJS_emulator.gameManager;
      const sim = gm && (gm.simulateInput || (gm.functions && gm.functions.simulateInput));
      if (typeof sim !== 'function') return;

      const playerIdx = Math.max(0, Math.min(3, (msg.slot || 1) - 1));
      const prev = prevBySlot[playerIdx] || new Array(16).fill(0);
      const next = msg.buttons || [];

      Object.keys(W3C_TO_RETRO).forEach((k) => {
        const w3cIdx = Number(k);
        const val = next[w3cIdx] ? 1 : 0;
        if (prev[w3cIdx] !== val) {
          sim.call(gm, playerIdx, W3C_TO_RETRO[w3cIdx], val);
          prev[w3cIdx] = val;
        }
      });
      prevBySlot[playerIdx] = prev;
    });
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`;
}

function mountEmulatorJs(core, romUrl, title) {
  const mount = document.getElementById('emulatorMount');
  const video = document.getElementById('remoteStreamVideo');
  const hint = document.getElementById('guestOverlayHint');
  video.classList.add('hidden');
  hint.classList.add('hidden');
  mount.classList.remove('hidden');
  mount.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.id = 'emulatorIframe';
  iframe.allow = 'autoplay; fullscreen; gamepad';
  mount.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(buildEmulatorIframeHtml(core, romUrl, title));
  doc.close();
}

function getActiveGpuStreamUrl() {
  if (!state.activeRoom || state.activeRoom.mode !== 'gpu-node') return null;
  return state.activeRoom.streamUrl || null;
}

function setupGuestStreamView() {
  const mount = document.getElementById('emulatorMount');
  const video = document.getElementById('remoteStreamVideo');
  const hint = document.getElementById('guestOverlayHint');
  const gpuStreamUrl = getActiveGpuStreamUrl();

  if (gpuStreamUrl) {
    mount.classList.remove('hidden');
    video.classList.add('hidden');
    mount.innerHTML = `<iframe src="${escapeHtml(gpuStreamUrl)}" allow="autoplay; fullscreen; gamepad; microphone"></iframe>`;
    return;
  }

  mount.innerHTML = '';
  mount.classList.add('hidden');
  video.classList.remove('hidden');
  hint.classList.remove('hidden');
}

function captureEmulatorStream() {
  const iframe = document.getElementById('emulatorIframe');
  if (!iframe || !iframe.contentWindow) return null;
  const canvas = iframe.contentWindow.document.querySelector('canvas');
  if (canvas && typeof canvas.captureStream === 'function') {
    return canvas.captureStream(60);
  }
  return null;
}

async function startHostPeerConnection(guestPeerId) {
  closePeerConnection(guestPeerId);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  state.peerConnections.set(guestPeerId, pc);

  const stream = captureEmulatorStream();
  if (stream) {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  }

  const dc = pc.createDataChannel('gamepad', { ordered: false, maxRetransmits: 0 });
  setupDataChannel(guestPeerId, dc);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      sendWs({ type: 'webrtc-signal', targetPeerId: guestPeerId, signal: { candidate: ev.candidate } });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendWs({ type: 'webrtc-signal', targetPeerId: guestPeerId, signal: { sdp: pc.localDescription } });
}

function getOrCreatePeerConnection(fromPeerId) {
  const existing = state.peerConnections.get(fromPeerId);
  if (existing) return existing;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  state.peerConnections.set(fromPeerId, pc);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      sendWs({ type: 'webrtc-signal', targetPeerId: fromPeerId, signal: { candidate: ev.candidate } });
    }
  };
  pc.ontrack = (ev) => {
    const video = document.getElementById('remoteStreamVideo');
    if (ev.streams && ev.streams[0]) {
      video.srcObject = ev.streams[0];
    }
  };
  pc.ondatachannel = (ev) => setupDataChannel(fromPeerId, ev.channel);
  return pc;
}

async function handleWebRtcSignal(msg) {
  const pc = getOrCreatePeerConnection(msg.fromPeerId);
  if (msg.signal.sdp) {
    await applyRemoteSdp(pc, msg.fromPeerId, msg.signal.sdp);
    return;
  }
  if (msg.signal.candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(msg.signal.candidate));
  }
}

async function applyRemoteSdp(pc, fromPeerId, sdp) {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  if (sdp.type === 'offer') {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWs({ type: 'webrtc-signal', targetPeerId: fromPeerId, signal: { sdp: pc.localDescription } });
  }
}

function setupDataChannel(peerId, channel) {
  state.dataChannels.set(peerId, channel);
  channel.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === 'pad-input') {
        forwardRemotePadToEmulator(data);
      }
    } catch {
      // Ignore malformed frame
    }
  };
}

function closePeerConnection(peerId) {
  const dc = state.dataChannels.get(peerId);
  if (dc) {
    dc.close();
    state.dataChannels.delete(peerId);
  }
  const pc = state.peerConnections.get(peerId);
  if (pc) {
    pc.close();
    state.peerConnections.delete(peerId);
  }
}

function forwardRemotePadToEmulator(inputMsg) {
  const iframe = document.getElementById('emulatorIframe');
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage({
    type: 'supersymmetry-remote-pad',
    slot: inputMsg.slot,
    buttons: inputMsg.buttons,
    axes: inputMsg.axes
  }, '*');
}

function sendPadFrameToRoom(buttons, axes) {
  if (!state.activeRoom) return;
  const frame = {
    type: 'pad-input',
    slot: state.mySlot || 1,
    buttons,
    axes,
    timestamp: Date.now()
  };

  if (state.isHost) {
    forwardRemotePadToEmulator(frame);
    return;
  }

  const hostChannel = state.dataChannels.get(state.activeRoom.hostPeerId);
  if (hostChannel && hostChannel.readyState === 'open') {
    hostChannel.send(JSON.stringify(frame));
    return;
  }
  sendWs(frame);
}

function joinRoomById(roomId) {
  sendWs({
    type: 'join-room',
    roomId,
    playerName: getPlayerName()
  });
}

function closeConsoleStage() {
  sendWs({ type: 'leave-room' });
  for (const peerId of state.peerConnections.keys()) {
    closePeerConnection(peerId);
  }
  state.activeRoom = null;
  state.gamepadOnlyMode = false;
  state.virtualButtons.fill(0);
  document.getElementById('ingameSidebar').classList.add('hidden');
  document.getElementById('emulatorMount').innerHTML = '';
  document.getElementById('remoteStreamVideo').srcObject = null;
  document.getElementById('consoleStage').classList.add('hidden');
}

function sendRomWithProgress(file, consoleId, title, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/roms/upload');
    xhr.setRequestHeader('x-rom-filename', encodeURIComponent(file.name));
    xhr.setRequestHeader('x-rom-console', encodeURIComponent(consoleId));
    if (title) xhr.setRequestHeader('x-rom-title', encodeURIComponent(title));
    xhr.upload.onprogress = onProgress;
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText)));
    xhr.onerror = () => reject(new Error('Falha no envio'));
    xhr.send(file);
  });
}

async function handleRomUploadSubmit(ev) {
  ev.preventDefault();
  const file = document.getElementById('uploadFileInput').files[0];
  if (!file) return;

  const consoleId = document.getElementById('uploadConsoleSelect').value;
  const title = document.getElementById('uploadTitleInput').value.trim();
  const progressBox = document.getElementById('uploadProgressBox');
  const progressFill = document.getElementById('uploadProgressFill');
  const progressText = document.getElementById('uploadProgressText');
  const submitBtn = document.getElementById('submitUploadBtn');

  progressBox.classList.remove('hidden');
  submitBtn.disabled = true;

  try {
    await sendRomWithProgress(file, consoleId, title, (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `Instalando (${pct}%)`;
    });

    await fetchDeckLibrary();
    document.getElementById('uploadRomForm').reset();
    document.getElementById('uploadRomDialog').close();
  } finally {
    submitBtn.disabled = false;
    setTimeout(() => progressBox.classList.add('hidden'), 800);
  }
}

/* ==========================================================================
   Multi-Touch Virtual Gamepad Engine (PointerEvents + setPointerCapture)
   ========================================================================== */
function computeDpadVector(rect, clientX, clientY) {
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  const dz = rect.width * 0.14;
  return {
    dx,
    dy,
    dirs: [dy < -dz ? 1 : 0, dy > dz ? 1 : 0, dx < -dz ? 1 : 0, dx > dz ? 1 : 0]
  };
}

function applyDpadDirections(dirs) {
  let changed = false;
  dirs.forEach((val, idx) => {
    const slotIdx = 12 + idx;
    if (state.virtualButtons[slotIdx] !== val) {
      state.virtualButtons[slotIdx] = val;
      changed = true;
    }
  });
  state.virtualAxes[0] = dirs[3] - dirs[2];
  state.virtualAxes[1] = dirs[1] - dirs[0];
  return changed;
}

function updateDpadDirectionFromPoint(dpadEl, clientX, clientY) {
  const rect = dpadEl.getBoundingClientRect();
  const { dx, dy, dirs } = computeDpadVector(rect, clientX, clientY);
  const changed = applyDpadDirections(dirs);

  renderDpadVisualState(dpadEl, dx, dy, rect.width * 0.28);
  if (!changed) return;
  if (dirs.includes(1)) triggerHapticPulse(8);
  sendPadFrameToRoom(state.virtualButtons.slice(), state.virtualAxes.slice());
}

function renderDpadVisualState(dpadEl, dx, dy, maxOffset) {
  dpadEl.querySelector('[data-dir="up"]').classList.toggle('active', state.virtualButtons[12] === 1);
  dpadEl.querySelector('[data-dir="down"]').classList.toggle('active', state.virtualButtons[13] === 1);
  dpadEl.querySelector('[data-dir="left"]').classList.toggle('active', state.virtualButtons[14] === 1);
  dpadEl.querySelector('[data-dir="right"]').classList.toggle('active', state.virtualButtons[15] === 1);

  const nub = document.getElementById('touchDpadThumb');
  if (!nub) return;
  const clampX = Math.max(-maxOffset, Math.min(maxOffset, dx * 0.45));
  const clampY = Math.max(-maxOffset, Math.min(maxOffset, dy * 0.45));
  nub.style.transform = `translate(${clampX}px, ${clampY}px)`;
}

function resetDpadState(dpadEl) {
  state.dpadPointerId = null;
  state.virtualButtons[12] = 0;
  state.virtualButtons[13] = 0;
  state.virtualButtons[14] = 0;
  state.virtualButtons[15] = 0;
  state.virtualAxes[0] = 0;
  state.virtualAxes[1] = 0;
  renderDpadVisualState(dpadEl, 0, 0, 0);
  sendPadFrameToRoom(state.virtualButtons.slice(), state.virtualAxes.slice());
}

function bindVectorDpadEvents() {
  const dpadEl = document.getElementById('touchDpad');
  if (!dpadEl) return;

  dpadEl.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    state.dpadPointerId = ev.pointerId;
    if (dpadEl.setPointerCapture) dpadEl.setPointerCapture(ev.pointerId);
    updateDpadDirectionFromPoint(dpadEl, ev.clientX, ev.clientY);
  });

  dpadEl.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== state.dpadPointerId) return;
    ev.preventDefault();
    updateDpadDirectionFromPoint(dpadEl, ev.clientX, ev.clientY);
  });

  const onRelease = (ev) => {
    if (ev.pointerId !== state.dpadPointerId) return;
    ev.preventDefault();
    resetDpadState(dpadEl);
  };

  dpadEl.addEventListener('pointerup', onRelease);
  dpadEl.addEventListener('pointercancel', onRelease);
}

function detectHitButtonsInCluster(clusterEl, clientX, clientY) {
  const hits = [];
  const buttons = clusterEl.querySelectorAll('[data-pad-btn]');
  buttons.forEach((btn) => {
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);
    if (dist <= r.width * 0.68) {
      hits.push(Number(btn.getAttribute('data-pad-btn')));
    }
  });
  return hits;
}

function syncPointerButtonsToVirtualState() {
  const activeSet = new Set();
  for (const btnList of state.activePointers.values()) {
    btnList.forEach((idx) => activeSet.add(idx));
  }

  let changed = false;
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((btnIdx) => {
    const nextVal = activeSet.has(btnIdx) ? 1 : 0;
    if (state.virtualButtons[btnIdx] !== nextVal) {
      state.virtualButtons[btnIdx] = nextVal;
      changed = true;
    }
  });

  document.querySelectorAll('#virtualGamepad [data-pad-btn]').forEach((el) => {
    const idx = Number(el.getAttribute('data-pad-btn'));
    el.classList.toggle('active', state.virtualButtons[idx] === 1);
  });

  if (changed) {
    sendPadFrameToRoom(state.virtualButtons.slice(), state.virtualAxes.slice());
  }
}

function bindMultiTouchButtons() {
  const cluster = document.getElementById('touchActionCluster');
  if (cluster) {
    cluster.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (cluster.setPointerCapture) cluster.setPointerCapture(ev.pointerId);
      const hits = detectHitButtonsInCluster(cluster, ev.clientX, ev.clientY);
      if (hits.length > 0) triggerHapticPulse(12);
      state.activePointers.set(ev.pointerId, hits);
      syncPointerButtonsToVirtualState();
    });

    cluster.addEventListener('pointermove', (ev) => {
      if (!state.activePointers.has(ev.pointerId)) return;
      ev.preventDefault();
      const hits = detectHitButtonsInCluster(cluster, ev.clientX, ev.clientY);
      state.activePointers.set(ev.pointerId, hits);
      syncPointerButtonsToVirtualState();
    });

    const releaseClusterPointer = (ev) => {
      if (!state.activePointers.has(ev.pointerId)) return;
      ev.preventDefault();
      state.activePointers.delete(ev.pointerId);
      syncPointerButtonsToVirtualState();
    };
    cluster.addEventListener('pointerup', releaseClusterPointer);
    cluster.addEventListener('pointercancel', releaseClusterPointer);
  }

  document.querySelectorAll('.vpad-shoulder-btn, .vpad-meta-btn').forEach((btn) => {
    const btnIdx = Number(btn.getAttribute('data-pad-btn'));
    btn.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (btn.setPointerCapture) btn.setPointerCapture(ev.pointerId);
      triggerHapticPulse(10);
      state.activePointers.set(ev.pointerId, [btnIdx]);
      syncPointerButtonsToVirtualState();
    });

    const releaseBtn = (ev) => {
      ev.preventDefault();
      state.activePointers.delete(ev.pointerId);
      syncPointerButtonsToVirtualState();
    };
    btn.addEventListener('pointerup', releaseBtn);
    btn.addEventListener('pointercancel', releaseBtn);
  });
}

function getConnectedGamepads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(Boolean);
}

function transmitHardwareGamepad(pad) {
  if (!state.activeRoom || state.isHost) return;
  const buttons = pad.buttons.map((b) => (b.pressed ? 1 : 0));
  const axes = pad.axes.map((a) => Number(a.toFixed(2)));
  sendPadFrameToRoom(buttons, axes);
}

function isPadButtonPressed(pad, index) {
  return Boolean(pad.buttons[index] && pad.buttons[index].pressed);
}

const PAD_BUTTON_BINDINGS = [
  { btn: 15, run: () => setFocusedGameIndex(state.focusedIndex + 1) },
  { btn: 14, run: () => setFocusedGameIndex(state.focusedIndex - 1) },
  { btn: 5, run: () => stepCategory(1) },
  { btn: 4, run: () => stepCategory(-1) },
  { btn: 0, run: () => launchFocusedGame() }
];

function resolvePadNavigationCommand(pad) {
  const matched = PAD_BUTTON_BINDINGS.find((b) => isPadButtonPressed(pad, b.btn));
  if (matched) return matched.run;
  const axisX = pad.axes[0] || 0;
  if (Math.abs(axisX) > 0.55) {
    return () => setFocusedGameIndex(state.focusedIndex + Math.sign(axisX));
  }
  return null;
}

function handleDeckGamepadNavigation(pad) {
  if (state.activeRoom) return;
  const now = performance.now();
  if (now - state.lastPadNavTs < 190) return;

  const command = resolvePadNavigationCommand(pad);
  if (command) {
    state.lastPadNavTs = now;
    command();
  }
}

function pollGamepadsLoop() {
  const pads = getConnectedGamepads();
  const label = document.getElementById('gamepadCountLabel');
  if (label) label.textContent = String(pads.length);

  if (pads.length > 0) {
    transmitHardwareGamepad(pads[0]);
    handleDeckGamepadNavigation(pads[0]);
  }
  requestAnimationFrame(pollGamepadsLoop);
}

function handleKeyboardDeckNavigation(ev) {
  if (state.activeRoom) return;
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT') return;

  if (ev.key === 'ArrowRight') {
    ev.preventDefault();
    setFocusedGameIndex(state.focusedIndex + 1);
  } else if (ev.key === 'ArrowLeft') {
    ev.preventDefault();
    setFocusedGameIndex(state.focusedIndex - 1);
  } else if (ev.key === 'Enter') {
    ev.preventDefault();
    launchFocusedGame();
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindStageControlEvents() {
  document.getElementById('toggleTouchPadBtn').addEventListener('click', () => {
    state.touchPadEnabled = !state.touchPadEnabled;
    if (!state.touchPadEnabled) state.gamepadOnlyMode = false;
    syncTouchControlsVisibility();
  });

  document.getElementById('toggleGamepadOnlyBtn').addEventListener('click', () => {
    state.gamepadOnlyMode = !state.gamepadOnlyMode;
    if (state.gamepadOnlyMode) state.touchPadEnabled = true;
    syncTouchControlsVisibility();
  });

  const toggleOverlayDrawer = () => {
    document.getElementById('ingameSidebar').classList.toggle('hidden');
  };
  document.getElementById('openIngameOverlayBtn').addEventListener('click', toggleOverlayDrawer);
  document.getElementById('toggleSidebarBtn').addEventListener('click', toggleOverlayDrawer);

  document.getElementById('closeStageBtn').addEventListener('click', closeConsoleStage);
  document.getElementById('overlayExitGameBtn').addEventListener('click', closeConsoleStage);

  document.getElementById('fullscreenStageBtn').addEventListener('click', () => {
    const stage = document.getElementById('consoleStage');
    if (stage.requestFullscreen) stage.requestFullscreen();
  });
}

function bindUiEvents() {
  setupDialogLightDismiss();
  updateClock();
  setInterval(updateClock, 15000);
  bindCarouselScrollSync();

  const openQam = () => document.getElementById('quickAccessDialog').showModal();
  document.getElementById('openQuickMenuBtn').addEventListener('click', openQam);
  document.getElementById('openRoomsDrawerBtn').addEventListener('click', openQam);
  document.getElementById('bottomMenuBtn').addEventListener('click', openQam);
  document.getElementById('heroPartyBtn').addEventListener('click', openQam);
  document.getElementById('bottomPartyBtn').addEventListener('click', openQam);

  document.getElementById('carouselPrevBtn').addEventListener('click', () => {
    setFocusedGameIndex(state.focusedIndex - 1);
  });
  document.getElementById('carouselNextBtn').addEventListener('click', () => {
    setFocusedGameIndex(state.focusedIndex + 1);
  });

  document.getElementById('toggleUiSoundBtn').addEventListener('click', () => {
    state.uiSoundEnabled = !state.uiSoundEnabled;
    document.getElementById('uiSoundGlyph').textContent = state.uiSoundEnabled ? '🔊' : '🔇';
  });

  const openUpload = () => {
    const qam = document.getElementById('quickAccessDialog');
    if (qam.open) qam.close();
    document.getElementById('uploadRomDialog').showModal();
  };
  document.getElementById('openUploadModalBtn').addEventListener('click', openUpload);
  document.getElementById('bottomImportBtn').addEventListener('click', openUpload);

  document.getElementById('heroPlayBtn').addEventListener('click', launchFocusedGame);
  document.getElementById('bottomPlayBtn').addEventListener('click', launchFocusedGame);

  document.getElementById('searchInput').addEventListener('input', (ev) => {
    state.searchQuery = ev.target.value.trim();
    state.focusedIndex = 0;
    applyFiltersAndRender();
  });

  document.getElementById('uploadRomForm').addEventListener('submit', handleRomUploadSubmit);
  document.getElementById('instantLocalRomInput').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) launchLocalFileAsHost(file);
  });

  bindStageControlEvents();
  bindVectorDpadEvents();
  bindMultiTouchButtons();

  document.getElementById('roomChatForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('roomChatInput');
    if (!input.value.trim()) return;
    sendWs({ type: 'chat-msg', text: input.value.trim() });
    input.value = '';
  });

  window.addEventListener('keydown', handleKeyboardDeckNavigation);
}

window.addEventListener('DOMContentLoaded', () => {
  bindUiEvents();
  fetchDeckLibrary();
  connectWebSocket();
  requestAnimationFrame(pollGamepadsLoop);
});
