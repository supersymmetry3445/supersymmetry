'use strict';

const state = {
  consoles: [],
  selectedConsole: 'all',
  roms: [],
  rooms: [],
  gpu: null,
  peerId: null,
  ws: null,
  activeRoom: null,
  activeRom: null,
  isHost: false,
  mySlot: 1,
  peerConnections: new Map(),
  dataChannels: new Map(),
  localMediaStream: null
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function isClickInsideRect(rect, event) {
  const withinVertical = rect.top <= event.clientY && event.clientY <= rect.top + rect.height;
  const withinHorizontal = rect.left <= event.clientX && event.clientX <= rect.left + rect.width;
  return withinVertical && withinHorizontal;
}

function setupDialogLightDismiss() {
  const dialogs = document.querySelectorAll('dialog.console-dialog');
  dialogs.forEach((dialog) => {
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

function getPlayerName() {
  const input = document.getElementById('playerNameInput');
  return (input && input.value.trim()) || 'Player1';
}

function formatBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

async function fetchInitialData() {
  const [healthRes, consolesRes, romsRes] = await Promise.all([
    fetch('/api/health').then((r) => r.json()),
    fetch('/api/consoles').then((r) => r.json()),
    fetch('/api/roms').then((r) => r.json())
  ]);

  if (healthRes.memory) {
    document.getElementById('vpsRamLabel').textContent =
      `VPS: ${healthRes.memory.rssMB} MB RAM · P2P`;
  }
  state.consoles = consolesRes.consoles || [];
  state.roms = romsRes.roms || [];
  updateGpuUi(consolesRes.gpuNode || healthRes.gpuNode);
  renderConsoleTabs();
  populateUploadConsoleSelect();
  renderRomsGrid();
}

function renderConsoleTabs() {
  const container = document.getElementById('consoleTabs');
  const tabs = [{ id: 'all', shortName: 'Todos os Sistemas' }, ...state.consoles];
  container.innerHTML = '';
  tabs.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab-btn ${state.selectedConsole === c.id ? 'active' : ''}`;
    btn.textContent = c.shortName || c.name;
    btn.addEventListener('click', () => {
      state.selectedConsole = c.id;
      renderConsoleTabs();
      renderRomsGrid();
    });
    container.appendChild(btn);
  });
}

function populateUploadConsoleSelect() {
  const select = document.getElementById('uploadConsoleSelect');
  select.innerHTML = '';
  state.consoles
    .filter((c) => c.mode !== 'gpu-node')
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.extensions.join(', ')})`;
      select.appendChild(opt);
    });
}

function updateGpuUi(gpu) {
  if (!gpu) return;
  state.gpu = gpu;
  const dot = document.getElementById('gpuDot');
  const label = document.getElementById('gpuStatusLabel');
  const banner = document.getElementById('gpuModalBanner');
  const stateText = document.getElementById('gpuModalStateText');
  const metricsText = document.getElementById('gpuModalMetricsText');
  const launchBtn = document.getElementById('launchGpuStreamBtn');

  if (gpu.online) {
    dot.className = 'dot dot-online';
    label.textContent = `RTX 3050: ONLINE (${gpu.temperatureC || 45}°C · NVENC)`;
    banner.className = 'gpu-status-banner online';
    stateText.textContent = `ONLINE · ${gpu.gpuModel}`;
    metricsText.textContent =
      `Jogo Ativo: ${gpu.activeGame || 'PS2 PCSX2'} · VRAM: ${gpu.vramUsedMiB}/${gpu.vramTotalMiB} MiB · Encoder: ${gpu.encoder}`;
    launchBtn.classList.toggle('hidden', !gpu.streamUrl);
    return;
  }

  dot.className = 'dot dot-offline';
  label.textContent = 'RTX 3050: Standby (0W)';
  banner.className = 'gpu-status-banner';
  stateText.textContent = 'Status: OFFLINE (Standby · 0W consumidos no seu PC)';
  metricsText.textContent =
    'Rode ./bin/supersymmetry-gpu start no seu konsole para ativar sua RTX 3050 e abrir o PS2.';
  launchBtn.classList.add('hidden');
}

function renderRoomsGrid() {
  const grid = document.getElementById('roomsGrid');
  grid.innerHTML = '';

  if (state.rooms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML =
      'Nenhuma sala multiplayer aberta neste instante. Escolha uma ROM abaixo ou clique em <strong>Criar Sala Rápida</strong> para abrir o Sofá Virtual (Controles 1 a 4).';
    grid.appendChild(empty);
    return;
  }

  state.rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'card';
    const playersList = room.players.map((p) => `P${p.slot}: ${p.name}`).join(' · ');
    card.innerHTML = `
      <div>
        <div class="card-top">
          <span class="badge badge-accent">${room.consoleName}</span>
          <span class="badge badge-slot">${room.players.length}/4 Jogadores</span>
        </div>
        <div class="card-title" style="margin-top:0.5rem">${escapeHtml(room.gameTitle)}</div>
        <div class="card-meta">Sala <strong>#${room.id}</strong> · Host: ${escapeHtml(room.hostName)}</div>
        <div class="card-meta">${escapeHtml(playersList)}</div>
      </div>
      <div class="card-actions">
        <button type="button" class="btn btn-sm btn-primary" data-join-room="${room.id}">
          🎮 Entrar na Sala (Pegar Controle)
        </button>
      </div>
    `;
    card.querySelector('[data-join-room]').addEventListener('click', () => joinRoomById(room.id));
    grid.appendChild(card);
  });
}

function renderRomsGrid() {
  const grid = document.getElementById('romsGrid');
  grid.innerHTML = '';

  if (state.selectedConsole === 'ps2') {
    renderPs2HybridCard(grid);
    return;
  }

  const filtered = state.selectedConsole === 'all'
    ? state.roms
    : state.roms.filter((r) => r.consoleId === state.selectedConsole);

  if (filtered.length === 0) {
    renderEmptyLibraryCard(grid);
    return;
  }

  filtered.forEach((rom) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div>
        <div class="card-top">
          <span class="badge badge-accent">${escapeHtml(rom.consoleName)}</span>
          <span class="card-meta">${formatBytes(rom.sizeBytes)}</span>
        </div>
        <div class="card-title" style="margin-top:0.5rem">${escapeHtml(rom.title)}</div>
        <div class="card-meta">
          Core: <code>${escapeHtml(rom.core)}</code> · Até ${rom.maxPlayers} Controles
          ${rom.hasSave ? ' · 💾 Cloud Save Ativo' : ''}
        </div>
      </div>
      <div class="card-actions">
        <button type="button" class="btn btn-sm btn-primary" data-play-rom="${rom.id}">
          ▶ Jogar &amp; Abrir Sala 4P
        </button>
        <button type="button" class="btn btn-sm btn-danger" data-delete-rom="${rom.id}" title="Remover ROM">
          🗑️
        </button>
      </div>
    `;
    card.querySelector('[data-play-rom]').addEventListener('click', () => launchServerRomAsHost(rom));
    card.querySelector('[data-delete-rom]').addEventListener('click', () => deleteServerRom(rom.id));
    grid.appendChild(card);
  });
}

function renderPs2HybridCard(grid) {
  const ps2Def = state.consoles.find((c) => c.id === 'ps2');
  const online = Boolean(state.gpu && state.gpu.online);
  const card = document.createElement('div');
  card.className = 'card';
  card.style.gridColumn = '1 / -1';
  card.innerHTML = `
    <div>
      <div class="card-top">
        <span class="badge badge-accent">PS2 · HÍBRIDO RTX 3050</span>
        <span class="badge badge-slot">${online ? 'ONLINE · NVENC ATIVO' : 'STANDBY · 0W'}</span>
      </div>
      <div class="card-title" style="margin-top:0.6rem">PlayStation 2 (PCSX2 Vulkan + NVIDIA RTX 3050 6GB)</div>
      <div class="card-meta" style="margin-top:0.4rem">${escapeHtml(ps2Def ? ps2Def.description : '')}</div>
      <div class="card-meta" style="margin-top:0.4rem">
        Jogos ideais: <strong>${(ps2Def ? ps2Def.featuredExamples : []).join(' · ')}</strong>
      </div>
    </div>
    <div class="card-actions">
      <button type="button" class="btn btn-primary" id="ps2CardModalBtn">
        ⚡ ${online ? 'Conectar ao Stream da RTX 3050' : 'Ver Comando do Konsole para Ligar RTX 3050'}
      </button>
    </div>
  `;
  card.querySelector('#ps2CardModalBtn').addEventListener('click', () => {
    if (online && state.gpu.streamUrl) {
      launchGpuStreamInStage();
      return;
    }
    document.getElementById('gpuNodeDialog').showModal();
  });
  grid.appendChild(card);
}

function renderEmptyLibraryCard(grid) {
  const activeConsole = state.consoles.find((c) => c.id === state.selectedConsole);
  const examples = activeConsole
    ? activeConsole.featuredExamples.join(' · ')
    : 'Super Bomberman 4 (SNES) · Bomba Patch (PS1/PSP/PS2) · Pokémon Emerald (GBA) · Mario Kart 64';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.innerHTML = `
    <p><strong>Nenhuma ROM cadastrada neste filtro ainda.</strong></p>
    <p style="margin-top:0.35rem">Sugestões clássicas para jogar com os amigos: <em>${escapeHtml(examples)}</em></p>
    <p style="margin-top:0.5rem">Clique em <strong>＋ Subir ROM para a VPS</strong> para deixar o jogo salvo permanentemente para a galera, ou em <strong>📂 Rodar ROM do PC</strong> para abrir na hora.</p>
  `;
  grid.appendChild(empty);
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
    renderRoomsGrid();
  },
  'rooms-updated': (msg) => {
    state.rooms = msg.rooms || [];
    renderRoomsGrid();
  },
  'gpu-updated': (msg) => updateGpuUi(msg.gpu),
  'room-joined': (msg) => onRoomJoined(msg),
  'peer-joined': (msg) => {
    state.activeRoom = msg.room;
    renderControllerSlots();
    appendChatLine('Sistema', `${msg.name} entrou no Controle ${msg.slot || 'Espectador'}.`);
    if (state.isHost) startHostPeerConnection(msg.peerId);
  },
  'peer-left': (msg) => {
    state.activeRoom = msg.room;
    closePeerConnection(msg.peerId);
    renderControllerSlots();
    appendChatLine('Sistema', `${msg.name} saiu da sala.`);
  },
  'room-closed': (msg) => {
    appendChatLine('Sistema', msg.reason || 'Sala encerrada.');
    closeConsoleStage();
  },
  'webrtc-signal': (msg) => handleWebRtcSignal(msg),
  'pad-input': (msg) => forwardRemotePadToEmulator(msg),
  'chat-msg': (msg) => appendChatLine(`P${msg.slot || '?'} ${msg.fromName}`, msg.text)
};

function handleWsMessage(msg) {
  const handler = WS_HANDLERS[msg.type];
  if (handler) handler(msg);
}

function onRoomJoined(msg) {
  state.activeRoom = msg.room;
  state.mySlot = msg.slot;
  state.isHost = msg.isHost;

  document.getElementById('consoleStage').classList.remove('hidden');
  document.getElementById('activeRoomCode').textContent = `#${msg.room.id}`;
  document.getElementById('stageConsoleBadge').textContent = msg.room.consoleName;
  document.getElementById('stageGameTitle').textContent = msg.room.gameTitle;
  document.getElementById('stageRoleBadge').textContent =
    msg.isHost ? 'Controle 1 (Host)' : `Controle ${msg.slot} (P2P)`;

  renderControllerSlots();
  appendChatLine('Sistema', `Conectado na sala #${msg.room.id} como Controle ${msg.slot}.`);

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
      <span>🎮 Controle ${slot}</span>
      <strong>${occupant ? escapeHtml(occupant.name) : 'Livre (Aguardando amigo)'}</strong>
    `;
    list.appendChild(li);
  }
}

function appendChatLine(author, text) {
  const box = document.getElementById('roomChatMessages');
  const div = document.createElement('div');
  div.className = 'chat-line';
  div.innerHTML = `<strong>${escapeHtml(author)}:</strong> ${escapeHtml(text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function launchServerRomAsHost(rom) {
  state.activeRom = rom;
  mountEmulatorJs(rom.core, `/api/roms/${rom.id}/file`, rom.title, rom.id);
  sendWs({
    type: 'create-room',
    playerName: getPlayerName(),
    consoleId: rom.consoleId,
    consoleName: rom.consoleName,
    romId: rom.id,
    gameTitle: rom.title,
    mode: 'wasm-p2p'
  });
}

function launchLocalFileAsHost(file) {
  const ext = `.${file.name.split('.').pop().toLowerCase()}`;
  const matched = state.consoles.find((c) => c.extensions.includes(ext)) || state.consoles[0];
  const blobUrl = URL.createObjectURL(file);
  const title = file.name.replace(/\.[^.]+$/, '');
  state.activeRom = { id: null, title, core: matched.core, consoleId: matched.id, consoleName: matched.shortName };

  mountEmulatorJs(matched.core, blobUrl, title, null);
  sendWs({
    type: 'create-room',
    playerName: getPlayerName(),
    consoleId: matched.id,
    consoleName: matched.shortName,
    gameTitle: title,
    mode: 'wasm-p2p'
  });
}

function mountEmulatorJs(core, romUrl, title, romId) {
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

  const saveUrl = romId ? `/api/roms/${romId}/save` : '';
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <style>html,body,#game{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;}</style>
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
    window.EJS_color = '#8b5cf6';
    ${saveUrl ? `window.EJS_loadStateURL = ${JSON.stringify(saveUrl)};` : ''}
  </script>
  <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
</body>
</html>`);
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
  state.activeRom = null;
  document.getElementById('emulatorMount').innerHTML = '';
  document.getElementById('remoteStreamVideo').srcObject = null;
  document.getElementById('consoleStage').classList.add('hidden');
}

function launchGpuStreamInStage() {
  const gpuDialog = document.getElementById('gpuNodeDialog');
  if (gpuDialog.open) gpuDialog.close();

  const streamUrl = state.gpu && state.gpu.streamUrl;
  if (!streamUrl) return;

  sendWs({
    type: 'create-room',
    playerName: getPlayerName(),
    consoleId: 'ps2',
    consoleName: 'PS2 · RTX 3050',
    gameTitle: state.gpu.activeGame || 'PlayStation 2 (RTX 3050 Live)',
    mode: 'gpu-node',
    streamUrl
  });

  const mount = document.getElementById('emulatorMount');
  document.getElementById('remoteStreamVideo').classList.add('hidden');
  mount.classList.remove('hidden');
  mount.innerHTML = `<iframe src="${escapeHtml(streamUrl)}" allow="autoplay; fullscreen; gamepad; microphone"></iframe>`;
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
    xhr.onerror = () => reject(new Error('Falha de rede no upload'));
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
      progressText.textContent = `Enviando ${pct}% (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;
    });

    const romsRes = await fetch('/api/roms').then((r) => r.json());
    state.roms = romsRes.roms || [];
    renderRomsGrid();
    document.getElementById('uploadRomForm').reset();
    document.getElementById('uploadRomDialog').close();
  } catch (err) {
    progressText.textContent = `Erro: ${err.message}`;
  } finally {
    submitBtn.disabled = false;
    setTimeout(() => progressBox.classList.add('hidden'), 1200);
  }
}

async function deleteServerRom(romId) {
  await fetch(`/api/roms/${romId}`, { method: 'DELETE' });
  state.roms = state.roms.filter((r) => r.id !== romId);
  renderRomsGrid();
}

function getConnectedGamepads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(Boolean);
}

function transmitGuestGamepad(pad) {
  if (!state.activeRoom || state.isHost) return;
  const frame = {
    type: 'pad-input',
    slot: state.mySlot,
    buttons: pad.buttons.map((b) => (b.pressed ? 1 : 0)),
    axes: pad.axes.map((a) => Number(a.toFixed(2))),
    timestamp: Date.now()
  };
  const hostChannel = state.dataChannels.get(state.activeRoom.hostPeerId);
  if (hostChannel && hostChannel.readyState === 'open') {
    hostChannel.send(JSON.stringify(frame));
    return;
  }
  sendWs(frame);
}

function pollGamepadsLoop() {
  const pads = getConnectedGamepads();
  const label = document.getElementById('gamepadCountLabel');
  if (label) {
    label.textContent = `${pads.length} Controle${pads.length === 1 ? '' : 's'} USB/BT`;
  }
  if (pads.length > 0) {
    transmitGuestGamepad(pads[0]);
  }
  requestAnimationFrame(pollGamepadsLoop);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindUiEvents() {
  setupDialogLightDismiss();

  const openUpload = () => document.getElementById('uploadRomDialog').showModal();
  document.getElementById('openUploadModalBtn').addEventListener('click', openUpload);
  document.getElementById('openUploadModalBtn2').addEventListener('click', openUpload);

  const openGpu = () => document.getElementById('gpuNodeDialog').showModal();
  document.getElementById('gpuStatusBtn').addEventListener('click', openGpu);
  document.getElementById('openGpuModalBtn').addEventListener('click', openGpu);

  document.getElementById('copyKonsoleCmdBtn').addEventListener('click', () => {
    navigator.clipboard.writeText('./bin/supersymmetry-gpu start');
    document.getElementById('copyKonsoleCmdBtn').textContent = 'Copiado!';
  });

  document.getElementById('launchGpuStreamBtn').addEventListener('click', launchGpuStreamInStage);
  document.getElementById('uploadRomForm').addEventListener('submit', handleRomUploadSubmit);

  document.getElementById('instantLocalRomInput').addEventListener('change', (ev) => {
    const file = ev.target.files[0];
    if (file) launchLocalFileAsHost(file);
  });

  document.getElementById('createQuickRoomBtn').addEventListener('click', () => {
    if (state.roms.length > 0) {
      launchServerRomAsHost(state.roms[0]);
    } else {
      document.getElementById('instantLocalRomInput').click();
    }
  });

  document.getElementById('closeStageBtn').addEventListener('click', closeConsoleStage);
  document.getElementById('fullscreenStageBtn').addEventListener('click', () => {
    const wrapper = document.getElementById('viewportWrapper');
    if (wrapper.requestFullscreen) wrapper.requestFullscreen();
  });

  document.getElementById('roomChatForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('roomChatInput');
    if (!input.value.trim()) return;
    sendWs({ type: 'chat-msg', text: input.value.trim() });
    input.value = '';
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindUiEvents();
  fetchInitialData();
  connectWebSocket();
  requestAnimationFrame(pollGamepadsLoop);
});
