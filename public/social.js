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

  function togglePasswordVisibility() {
    const input = document.getElementById('current-password');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
  }

  function addClickListener(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function bindAuthAndInviteEvents() {
    const loginForm = document.getElementById('consoleLoginForm');
    if (loginForm) loginForm.addEventListener('submit', handleConsoleLoginSubmit);

    const uploadForm = document.getElementById('uploadRomForm');
    if (uploadForm) uploadForm.addEventListener('submit', handleRomUploadSubmit);

    addClickListener('toggleConsolePwdBtn', togglePasswordVisibility);
    addClickListener('logoutConsoleBtn', handleConsoleLogout);
    addClickListener('dismissInviteToastBtn', () => {
      document.getElementById('partyInviteToast').classList.add('hidden');
    });
    addClickListener('acceptInviteToastBtn', () => {
      document.getElementById('partyInviteToast').classList.add('hidden');
      acceptPendingInvite();
    });
  }

  window.SupersymmetrySocial = {
    myPeerId: null,
    init(hooks) {
      socialState.appState = hooks.state;
      socialState.joinRoomById = hooks.joinRoomById;
      socialState.launchGameItem = hooks.launchGameItem;
      socialState.onPlayChime = hooks.onPlayChime;
      socialState.fetchDeckLibrary = hooks.fetchDeckLibrary;
      bindAuthAndInviteEvents();
      checkConsoleSession();
    },
    setPeerId(peerId) {
      this.myPeerId = peerId;
      renderOnlineFriends(socialState.onlinePlayers);
    },
    updateOnlinePlayers(players) {
      renderOnlineFriends(players);
    },
    receiveDirectInvite(invite) {
      showDirectInviteToast(invite);
    }
  };
})();
