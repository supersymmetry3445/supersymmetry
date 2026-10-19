'use strict';

(function initSupersymmetrySocial() {
  const socialState = {
    currentUser: null,
    onlinePlayers: [],
    pendingInvite: null,
    appState: null,
    joinRoomById: null,
    launchGameItem: null,
    onPlayChime: null,
    fetchDeckLibrary: null
  };

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function updateNetworkBadges(network) {
    if (!network) return;
    const label = network.isTailscaleMesh ? `Tailscale · ${network.ip}` : `Conectado · ${network.ip}`;
    setElementText('tailscaleStatusPill', label);
  }

  function applyAuthenticatedUser(user) {
    socialState.currentUser = user;
    const gate = document.getElementById('consoleAuthGate');
    const nameInput = document.getElementById('playerNameInput');

    if (user) {
      if (gate) gate.classList.add('hidden');
      if (nameInput && user.displayName) nameInput.value = user.displayName;
      return;
    }
    if (gate) gate.classList.remove('hidden');
  }

  async function checkConsoleSession() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      updateNetworkBadges(data.network);
      applyAuthenticatedUser(data.authenticated ? data.user : null);
      return Boolean(data.authenticated);
    } catch {
      return false;
    }
  }

  async function handleConsoleLoginSubmit(ev) {
    ev.preventDefault();
    const errEl = document.getElementById('consoleAuthError');
    const submitBtn = document.getElementById('consoleLoginSubmitBtn');
    const username = document.getElementById('console-username').value.trim();
    const password = document.getElementById('current-password').value;

    errEl.classList.add('hidden');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conta ou senha incorreta.');
      applyAuthenticatedUser(data.user);
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function handleConsoleSignupSubmit(ev) {
    ev.preventDefault();
    const fbEl = document.getElementById('consoleSignupFeedback');
    const submitBtn = document.getElementById('consoleSignupSubmitBtn');
    const displayName = document.getElementById('signupDisplayName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('new-password').value;

    fbEl.classList.add('hidden');
    fbEl.classList.remove('is-error');
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível criar a conta.');
      fbEl.textContent = data.message || 'Cadastro enviado. Aguardando aprovação.';
      fbEl.classList.remove('hidden');
      ev.target.reset();
    } catch (err) {
      fbEl.textContent = err.message;
      fbEl.classList.add('is-error');
      fbEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  }

  function switchAuthMode() {
    const loginForm = document.getElementById('consoleLoginForm');
    const signupForm = document.getElementById('consoleSignupForm');
    const switchBtn = document.getElementById('switchAuthModeBtn');
    const heading = document.getElementById('consoleAuthHeading');
    if (!loginForm || !signupForm) return;

    const showingSignup = signupForm.classList.contains('hidden');
    loginForm.classList.toggle('hidden', showingSignup);
    signupForm.classList.toggle('hidden', !showingSignup);
    if (heading) heading.textContent = showingSignup ? 'Criar conta' : 'Iniciar sessão';
    if (switchBtn) switchBtn.textContent = showingSignup ? 'Iniciar sessão' : 'Criar conta';
  }

  async function handleConsoleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    applyAuthenticatedUser(null);
    const qam = document.getElementById('quickAccessDialog');
    if (qam && qam.open) qam.close();
  }

  function renderOnlineFriends(players) {
    socialState.onlinePlayers = Array.isArray(players) ? players : [];
    const list = document.getElementById('onlineFriendsList');
    if (!list) return;

    const myPeerId = window.SupersymmetrySocial.myPeerId;
    const others = socialState.onlinePlayers.filter((p) => p.peerId !== myPeerId);

    if (others.length === 0) {
      list.innerHTML = '<span>Nenhum outro jogador online.</span>';
      return;
    }

    list.innerHTML = '';
    others.forEach((friend) => {
      const row = document.createElement('div');
      row.className = 'online-friend-row';
      row.innerHTML = `
        <div class="online-friend-info">
          <strong>${escapeHtml(friend.displayName)}</strong>
          <span>${escapeHtml(friend.activity || 'Menu Principal')}</span>
        </div>
        <button type="button" class="hud-btn">Convidar</button>
      `;
      row.querySelector('button').addEventListener('click', () => sendDirectPartyInvite(friend.peerId));
      list.appendChild(row);
    });
  }

  function getFocusedGame(appState) {
    const fallback = { slug: 'super-bomberman-4', title: 'Super Bomberman 4', consoleName: 'SNES' };
    if (!appState) return fallback;
    return appState.filteredGames[appState.focusedIndex] || fallback;
  }

  function buildActiveInviteContext() {
    const appState = socialState.appState;
    const focused = getFocusedGame(appState);
    if (appState && appState.activeRoom) {
      return {
        roomId: appState.activeRoom.id,
        gameSlug: focused.slug,
        gameTitle: appState.activeRoom.gameTitle,
        consoleName: appState.activeRoom.consoleName
      };
    }
    return {
      roomId: null,
      gameSlug: focused.slug,
      gameTitle: focused.title,
      consoleName: focused.consoleName
    };
  }

  async function sendDirectPartyInvite(targetPeerId) {
    const ctx = buildActiveInviteContext();
    const senderName = socialState.currentUser ? socialState.currentUser.displayName : 'Jogador';
    await fetch('/api/social/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPeerId,
        fromName: senderName,
        roomId: ctx.roomId,
        gameSlug: ctx.gameSlug,
        gameTitle: ctx.gameTitle,
        consoleName: ctx.consoleName
      })
    });
  }

  function showDirectInviteToast(invite) {
    socialState.pendingInvite = invite;
    const toast = document.getElementById('partyInviteToast');
    if (!toast) return;

    const gameTitle = invite.gameTitle || 'Partida Multiplayer';
    const fromName = invite.fromName || 'Jogador';
    const consoleName = invite.consoleName || 'Console';
    setElementText('inviteToastTitle', gameTitle);
    setElementText('inviteToastSub', `${fromName} convidou você · ${consoleName}`);
    toast.classList.remove('hidden');

    if (socialState.onPlayChime) {
      socialState.onPlayChime(740, 0.11, 0.05);
      setTimeout(() => socialState.onPlayChime(987, 0.18, 0.05), 120);
    }
  }

  function matchesInvitedGame(game, invite) {
    if (invite.gameSlug && game.slug === invite.gameSlug) return true;
    return game.title === invite.gameTitle;
  }

  function acceptPendingInvite() {
    const invite = socialState.pendingInvite;
    if (!invite) return;
    if (invite.roomId && socialState.joinRoomById) {
      socialState.joinRoomById(invite.roomId);
      return;
    }
    const games = (socialState.appState && socialState.appState.games) || [];
    const matched = games.find((g) => matchesInvitedGame(g, invite));
    if (matched && socialState.launchGameItem) {
      socialState.launchGameItem(matched);
    }
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
        progressText.textContent = `Transferindo (${pct}%)`;
      });
      if (socialState.fetchDeckLibrary) await socialState.fetchDeckLibrary();
      document.getElementById('uploadRomForm').reset();
      document.getElementById('uploadRomDialog').close();
    } finally {
      submitBtn.disabled = false;
      setTimeout(() => progressBox.classList.add('hidden'), 800);
    }
  }

  function toggleInputVisibilityById(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  function addClickListener(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function bindAuthAndInviteEvents() {
    const loginForm = document.getElementById('consoleLoginForm');
    if (loginForm) loginForm.addEventListener('submit', handleConsoleLoginSubmit);

    const signupForm = document.getElementById('consoleSignupForm');
    if (signupForm) signupForm.addEventListener('submit', handleConsoleSignupSubmit);

    const uploadForm = document.getElementById('uploadRomForm');
    if (uploadForm) uploadForm.addEventListener('submit', handleRomUploadSubmit);

    addClickListener('toggleConsolePwdBtn', () => toggleInputVisibilityById('current-password'));
    addClickListener('toggleSignupPwdBtn', () => toggleInputVisibilityById('new-password'));
    addClickListener('switchAuthModeBtn', switchAuthMode);
    addClickListener('logoutConsoleBtn', handleConsoleLogout);
    addClickListener('dismissInviteToastBtn', () => {
      document.getElementById('partyInviteToast').classList.add('hidden');
    });
    addClickListener('acceptInviteToastBtn', () => {
      document.getElementById('partyInviteToast').classList.add('hidden');
      acceptPendingInvite();
    });
  }

  function findRoomForGame(game, rooms) {
    if (!game || !Array.isArray(rooms)) return null;
    return rooms.find((r) => (r.slug && r.slug === game.slug) || r.gameTitle === game.title) || null;
  }

  function resolveHeroRoomLabels(game, rooms) {
    const room = findRoomForGame(game, rooms);
    if (!room) {
      return {
        statusLabel: game.installed ? 'Instalado' : 'Pronto',
        ctaLabel: 'Jogar'
      };
    }
    const count = room.players.length;
    const max = room.maxPlayers || 4;
    if (count > 0) {
      return {
        statusLabel: `${room.id} · ${count}/${max} na Sala`,
        ctaLabel: `Entrar (${count}/${max})`
      };
    }
    return {
      statusLabel: `${room.id} · Aberta (0/${max})`,
      ctaLabel: 'Jogar'
    };
  }

  function hasJoinableActiveHost(room) {
    if (!room) return false;
    const max = room.maxPlayers || 4;
    return room.players.length > 0 && room.players.length < max;
  }

  function findGameForRoom(room, games) {
    if (!room || !Array.isArray(games)) return null;
    return games.find((g) => (room.slug && g.slug === room.slug) || g.title === room.gameTitle) || null;
  }

  function resolveEmptyRoomGame(roomId, rooms, games) {
    const room = Array.isArray(rooms) ? rooms.find((r) => r.id === roomId) : null;
    if (!room || room.players.length > 0) return null;
    return findGameForRoom(room, games);
  }

  function buildRoomSeatMetaHtml(room) {
    const max = room.maxPlayers || 4;
    const count = room.players.length;
    if (count > 0) {
      return `<span class="room-seat-pill room-seat-occupied">${escapeHtml(room.hostName)} · ${count}/${max}</span>`;
    }
    return `<span class="room-seat-pill">Aberta · 0/${max}</span>`;
  }

  function renderRoomsShelf(rooms, onJoinRoom) {
    const shelf = document.getElementById('liveRoomsShelf');
    const grid = document.getElementById('roomsGrid');
    const badge = document.getElementById('roomsCountBadge');
    const qamList = document.getElementById('qamRoomsList');
    if (!grid) return;

    const activeCount = rooms.filter((r) => r.players.length > 0).length;
    badge.textContent = activeCount > 0 ? `Salas (${activeCount} ativas)` : `Salas (${rooms.length})`;
    grid.innerHTML = '';
    qamList.innerHTML = '';

    if (rooms.length === 0) {
      shelf.classList.add('hidden');
      qamList.textContent = 'Nenhuma sala aberta.';
      return;
    }

    shelf.classList.remove('hidden');
    rooms.forEach((room) => {
      const isOccupied = room.players.length > 0;
      const max = room.maxPlayers || 4;
      const card = document.createElement('div');
      card.className = `room-banner-card ${isOccupied ? 'has-active-players' : ''}`;
      card.innerHTML = `
        <div class="room-card-info">
          <div class="room-card-eyebrow">
            <span class="tag-pill tag-system">${escapeHtml(room.id)}</span>
            <span class="room-console-sub">${escapeHtml(room.consoleName)}</span>
          </div>
          <div class="room-card-title">${escapeHtml(room.gameTitle)}</div>
          <div class="room-card-seats">${buildRoomSeatMetaHtml(room)}</div>
        </div>
        <button type="button" class="btn-steam-play room-join-btn">
          ${isOccupied ? 'Entrar' : 'Jogar'}
        </button>
      `;
      card.addEventListener('click', () => onJoinRoom(room.id));
      grid.appendChild(card);

      const qamBtn = document.createElement('button');
      qamBtn.type = 'button';
      qamBtn.className = 'qam-action-btn';
      qamBtn.textContent = `${room.id} · ${room.gameTitle} (${room.players.length}/${max})`;
      qamBtn.addEventListener('click', () => {
        document.getElementById('quickAccessDialog').close();
        onJoinRoom(room.id);
      });
      qamList.appendChild(qamBtn);
    });
  }

  window.SupersymmetrySocial = {
    myPeerId: null,
    init(hooks) {
      Object.assign(socialState, hooks);
      if (hooks && hooks.state) socialState.appState = hooks.state;
      bindAuthAndInviteEvents();
      return checkConsoleSession();
    },
    findRoomForGame,
    resolveHeroRoomLabels,
    hasJoinableActiveHost,
    findGameForRoom,
    resolveEmptyRoomGame,
    renderRoomsShelf,
    renderOnlineFriends,
    updateOnlinePlayers: renderOnlineFriends,
    showDirectInviteToast,
    receiveDirectInvite: showDirectInviteToast,
    setMyPeerId(id) {
      this.myPeerId = id;
    },
    setPeerId(id) {
      this.myPeerId = id;
    }
  };
})();
