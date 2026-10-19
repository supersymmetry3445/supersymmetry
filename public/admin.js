'use strict';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatShortTime(isoStr) {
  if (!isoStr) return 'Nunca';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildPolylinePoints(buckets, key, maxVal, bounds) {
  const usableW = bounds.width - bounds.padX * 2;
  const usableH = bounds.height - bounds.padY * 2;
  const stepX = buckets.length > 1 ? usableW / (buckets.length - 1) : usableW;

  return buckets
    .map((b, idx) => {
      const x = Math.round(bounds.padX + idx * stepX);
      const ratio = (b[key] || 0) / maxVal;
      const y = Math.round(bounds.padY + usableH * (1 - ratio));
      return `${x},${y}`;
    })
    .join(' ');
}

function hasChartBuckets(buckets) {
  return Array.isArray(buckets) && buckets.length > 0;
}

function renderActivitySvgChart(buckets) {
  const mount = document.getElementById('activityChartMount');
  if (!mount || !hasChartBuckets(buckets)) return;

  const bounds = { width: 640, height: 180, padX: 28, padY: 20 };
  const maxVal = Math.max(
    4,
    ...buckets.map((b) => Math.max(b.logins || 0, b.matches || 0))
  );

  const loginPts = buildPolylinePoints(buckets, 'logins', maxVal, bounds);
  const matchPts = buildPolylinePoints(buckets, 'matches', maxVal, bounds);

  const stepX = (bounds.width - bounds.padX * 2) / Math.max(1, buckets.length - 1);
  const labelsHtml = buckets
    .map((b, i) => {
      const x = Math.round(bounds.padX + i * stepX);
      return `<text x="${x}" y="${bounds.height - 2}" fill="#94a3b8" font-size="10" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    })
    .join('');

  mount.innerHTML = `
    <svg viewBox="0 0 ${bounds.width} ${bounds.height}" preserveAspectRatio="none">
      <line x1="${bounds.padX}" y1="${bounds.padY}" x2="${bounds.width - bounds.padX}" y2="${bounds.padY}" stroke="rgba(255,255,255,0.07)" />
      <line x1="${bounds.padX}" y1="${bounds.height / 2}" x2="${bounds.width - bounds.padX}" y2="${bounds.height / 2}" stroke="rgba(255,255,255,0.07)" />
      <line x1="${bounds.padX}" y1="${bounds.height - bounds.padY}" x2="${bounds.width - bounds.padX}" y2="${bounds.height - bounds.padY}" stroke="rgba(255,255,255,0.12)" />
      <polyline fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${loginPts}" />
      <polyline fill="none" stroke="#46d369" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${matchPts}" />
      ${labelsHtml}
    </svg>
  `;
}

function renderTopGamesBars(topGames) {
  const mount = document.getElementById('topGamesMount');
  if (!mount) return;

  const items =
    topGames && topGames.length > 0
      ? topGames
      : [
          { title: 'Super Bomberman 4', consoleName: 'Super Nintendo', count: 1 },
          { title: 'Super Mario Kart', consoleName: 'Super Nintendo', count: 1 },
          { title: 'Top Gear', consoleName: 'Super Nintendo', count: 1 }
        ];

  const maxCount = Math.max(1, ...items.map((g) => g.count));
  mount.innerHTML = items
    .map((g) => {
      const pct = Math.max(12, Math.round((g.count / maxCount) * 100));
      return `
        <div class="xp-bar-row">
          <div class="xp-bar-head">
            <span>${escapeHtml(g.title)} <small style="color:#94a3b8">(${escapeHtml(g.consoleName)})</small></span>
            <span>${g.count} partidas</span>
          </div>
          <div class="xp-bar-track">
            <div class="xp-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

async function sendDirectAdminInvite(targetPeerId, targetUserId) {
  const select = document.getElementById('directInviteGameSelect');
  const gameTitle = select ? select.value : 'Super Bomberman 4';

  const res = await fetch('/api/admin/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPeerId, targetUserId, gameTitle, consoleName: 'Super Nintendo' })
  });
  return res.ok;
}

function renderOnlinePlayersList(onlinePlayers) {
  const mount = document.getElementById('onlinePlayersMount');
  if (!mount) return;

  if (!onlinePlayers || onlinePlayers.length === 0) {
    mount.innerHTML = `<div class="player-activity-sub">Nenhum jogador com console aberto neste segundo.</div>`;
    return;
  }

  mount.innerHTML = '';
  onlinePlayers.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'online-player-card';
    const meshBadge = p.isTailscale ? '🔒 Tailscale' : '🌐 HTTPS';

    row.innerHTML = `
      <div class="player-ident">
        <span class="live-dot"></span>
        <div>
          <strong>${escapeHtml(p.displayName)}</strong>
          <span class="player-activity-sub">(@${escapeHtml(p.username)} · ${meshBadge})</span>
          <div class="player-activity-sub">${escapeHtml(p.activity)}</div>
        </div>
      </div>
      <button type="button" class="btn-invite-direct">⚡ Convidar Direto</button>
    `;

    const btn = row.querySelector('button');
    btn.addEventListener('click', async () => {
      btn.textContent = 'Enviando...';
      const ok = await sendDirectAdminInvite(p.peerId, p.userId);
      btn.textContent = ok ? '✓ Convite na Tela!' : 'Falhou';
      setTimeout(() => {
        btn.textContent = '⚡ Convidar Direto';
      }, 2200);
    });

    mount.appendChild(row);
  });
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  users.forEach((u) => {
    const tr = document.createElement('tr');
    const statusHtml = u.online
      ? `<span class="badge-online">● ${escapeHtml(u.currentActivity)}</span>`
      : `<span class="badge-offline">Offline</span>`;

    const historyHtml =
      u.recentGames && u.recentGames.length > 0
        ? u.recentGames
            .slice(0, 4)
            .map((g) => `<span class="history-chip">${escapeHtml(g.gameTitle)}</span>`)
            .join('')
        : `<span class="player-activity-sub">${escapeHtml(u.lastPlayedGame || 'Sem partidas ainda')}</span>`;

    const canDelete = u.role !== 'admin';
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(u.displayName)}</strong>
        <div class="player-activity-sub">@${escapeHtml(u.username)} · ${u.role.toUpperCase()}</div>
      </td>
      <td>${statusHtml}</td>
      <td><code>${escapeHtml(u.tailscaleIp || 'Qualquer IP Autenticado')}</code></td>
      <td><strong>${u.gamesPlayedCount || 0}</strong></td>
      <td><div class="history-chips">${historyHtml}</div></td>
      <td>${escapeHtml(formatShortTime(u.lastLoginAt))}</td>
      <td>
        ${canDelete ? `<button type="button" class="btn-danger-sm" data-del-user="${escapeHtml(u.id)}">Remover</button>` : '👑 Master'}
      </td>
    `;

    const delBtn = tr.querySelector('[data-del-user]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: 'DELETE' });
        loadAdminOverview();
      });
    }
    tbody.appendChild(tr);
  });
}

function renderAuditLogs(logs) {
  const mount = document.getElementById('accessLogsMount');
  if (!mount) return;
  mount.innerHTML = (logs || [])
    .slice(0, 20)
    .map((l) => {
      const isDanger = l.event === 'LOGIN_FAILED' || l.event === 'SECURITY_LOCKOUT';
      return `
        <div class="audit-item">
          <div>
            <span class="audit-event ${isDanger ? 'danger' : ''}">${escapeHtml(l.event)}</span>
            <span> — ${escapeHtml(l.displayName || l.username || 'Anônimo')}: ${escapeHtml(l.detail || '')}</span>
          </div>
          <span class="player-activity-sub">${escapeHtml(l.ip || '')} · ${escapeHtml(formatShortTime(l.timestamp))}</span>
        </div>
      `;
    })
    .join('');
}

function updateKpiCounts(summary) {
  document.getElementById('kpiOnlineCount').textContent = String(summary.onlineCount);
  document.getElementById('kpiRoomsCount').textContent = `${summary.activeRoomsCount} salas ativas no momento`;
  document.getElementById('kpiMatchesCount').textContent = String(summary.totalMatchesPlayed);
  document.getElementById('kpiUsersCount').textContent = String(summary.totalUsers);
  document.getElementById('kpiLoginsCount').textContent = `${summary.totalLogins} acessos autenticados`;
  document.getElementById('kpiBlockedCount').textContent = String(summary.blockedIntrusions);
}

function updateSummaryCards(data) {
  if (data.summary) updateKpiCounts(data.summary);

  const gpuOnline = Boolean(data.gpu && data.gpu.online);
  document.getElementById('kpiGpuStatus').textContent = gpuOnline
    ? `RTX 3050: ONLINE (${data.gpu.gpuModel})`
    : 'RTX 3050: Standby';

  const strictMesh = Boolean(data.networkConfig && data.networkConfig.tailscaleLockdown);
  const toggle = document.getElementById('tailscaleLockdownToggle');
  if (toggle) toggle.checked = strictMesh;
  document.getElementById('adminTailscaleBadge').textContent = strictMesh
    ? '🔒 Tailscale Strict: ATIVO (100.64.0.0/10)'
    : '🌐 Tailscale Hybrid: Pronto (100.65.233.79)';
}

async function loadAdminOverview() {
  const res = await fetch('/api/admin/overview');
  if (!res.ok) {
    document.getElementById('adminLoginScreen').classList.remove('hidden');
    document.getElementById('adminDashboardScreen').classList.add('hidden');
    return false;
  }

  const data = await res.json();
  document.getElementById('adminLoginScreen').classList.add('hidden');
  document.getElementById('adminDashboardScreen').classList.remove('hidden');

  updateSummaryCards(data);
  renderActivitySvgChart(data.hourlyActivity || []);
  renderTopGamesBars(data.topGames || []);
  renderOnlinePlayersList(data.onlinePlayers || []);
  renderUsersTable(data.users || []);
  renderAuditLogs(data.accessLogs || []);
  return true;
}

function bindLoginAndSecurityEvents() {
  const pwdInput = document.getElementById('current-password');
  const togglePwdBtn = document.getElementById('toggleAdminPwdBtn');
  togglePwdBtn.addEventListener('click', () => {
    const isPwd = pwdInput.type === 'password';
    pwdInput.type = isPwd ? 'text' : 'password';
    togglePwdBtn.textContent = isPwd ? 'Ocultar' : 'Mostrar';
  });

  document.getElementById('adminLoginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errEl = document.getElementById('adminLoginError');
    errEl.classList.add('hidden');

    const username = document.getElementById('adminUsernameInput').value.trim();
    const password = pwdInput.value;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, requireAdmin: true })
    });
    const body = await res.json();
    if (!res.ok) {
      errEl.textContent = body.error || 'Acesso negado.';
      errEl.classList.remove('hidden');
      return;
    }
    pwdInput.value = '';
    await loadAdminOverview();
  });

  document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    await loadAdminOverview();
  });

  document.getElementById('refreshDashboardBtn').addEventListener('click', loadAdminOverview);
}

function bindManagementForms() {
  document.getElementById('createUserForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fb = document.getElementById('createUserFeedback');
    fb.classList.remove('hidden');

    const payload = {
      username: document.getElementById('newUsername').value.trim(),
      displayName: document.getElementById('newDisplayName').value.trim(),
      password: document.getElementById('newUserPassword').value,
      tailscaleIp: document.getElementById('newUserTailscaleIp').value.trim()
    };

    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      fb.textContent = data.error || 'Erro ao criar conta.';
      return;
    }

    fb.textContent = `✓ Conta @${data.user.username} criada com sucesso!`;
    ev.target.reset();
    await loadAdminOverview();
  });

  document.getElementById('tailscaleLockdownToggle').addEventListener('change', async (ev) => {
    await fetch('/api/admin/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tailscaleLockdown: ev.target.checked })
    });
    await loadAdminOverview();
  });

  document.getElementById('changeAdminPwdForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fb = document.getElementById('adminPwdFeedback');
    const newPassword = document.getElementById('newAdminPasswordInput').value;
    const res = await fetch('/api/admin/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    const data = await res.json();
    fb.classList.remove('hidden');
    fb.textContent = res.ok ? '✓ Senha Master redefinida com sucesso!' : data.error || 'Erro';
    if (res.ok) ev.target.reset();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  bindLoginAndSecurityEvents();
  bindManagementForms();
  loadAdminOverview();
  setInterval(() => {
    if (!document.getElementById('adminDashboardScreen').classList.contains('hidden')) {
      loadAdminOverview();
    }
  }, 6000);
});
