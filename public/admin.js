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
      return `<text x="${x}" y="${bounds.height - 2}" fill="#8a909e" font-size="10" text-anchor="middle">${escapeHtml(b.label)}</text>`;
    })
    .join('');

  mount.innerHTML = `
    <svg viewBox="0 0 ${bounds.width} ${bounds.height}" preserveAspectRatio="none">
      <line x1="${bounds.padX}" y1="${bounds.padY}" x2="${bounds.width - bounds.padX}" y2="${bounds.padY}" stroke="rgba(255,255,255,0.06)" />
      <line x1="${bounds.padX}" y1="${bounds.height / 2}" x2="${bounds.width - bounds.padX}" y2="${bounds.height / 2}" stroke="rgba(255,255,255,0.06)" />
      <line x1="${bounds.padX}" y1="${bounds.height - bounds.padY}" x2="${bounds.width - bounds.padX}" y2="${bounds.height - bounds.padY}" stroke="rgba(255,255,255,0.12)" />
      <polyline fill="none" stroke="#72b4d4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${loginPts}" />
      <polyline fill="none" stroke="#e15b4b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${matchPts}" />
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
            <span>${escapeHtml(g.title)} <small style="color:#8a909e">(${escapeHtml(g.consoleName)})</small></span>
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

function renderPendingApprovals(pendingUsers) {
  const mount = document.getElementById('pendingApprovalsMount');
  if (!mount) return;

  if (!pendingUsers || pendingUsers.length === 0) {
    mount.innerHTML = `<div class="player-activity-sub">Nenhuma solicitação aguardando aprovação.</div>`;
    return;
  }

  mount.innerHTML = '';
  pendingUsers.forEach((u) => {
    const card = document.createElement('div');
    card.className = 'pending-user-card';
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(u.displayName)}</strong>
        <span class="player-activity-sub">(${escapeHtml(u.email || u.username)})</span>
        <div class="player-activity-sub">
          Origem: <code>${escapeHtml(u.registrationIp || '—')}</code> · Solicitação em ${escapeHtml(formatShortTime(u.createdAt))}
        </div>
      </div>
      <div class="pending-user-actions">
        <input type="text" class="pending-ts-input" placeholder="IP Tailscale (opcional)" value="${escapeHtml(u.tailscaleIp || '')}" />
        <button type="button" class="btn-approve-sm" data-act="approve">Aprovar</button>
        <button type="button" class="btn-ghost-sm" data-act="reject">Recusar</button>
        <button type="button" class="btn-danger-sm" data-act="ban">Recusar e Banir IP</button>
      </div>
    `;

    const tsInput = card.querySelector('.pending-ts-input');
    card.querySelector('[data-act="approve"]').addEventListener('click', async () => {
      await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tailscaleIp: tsInput.value.trim() })
      });
      loadAdminOverview();
    });

    card.querySelector('[data-act="reject"]').addEventListener('click', async () => {
      await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banIp: false })
      });
      loadAdminOverview();
    });

    card.querySelector('[data-act="ban"]').addEventListener('click', async () => {
      await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banIp: true })
      });
      loadAdminOverview();
    });

    mount.appendChild(card);
  });
}

function renderBlockedIpsList(blockedIps) {
  const mount = document.getElementById('blockedIpsMount');
  if (!mount) return;

  if (!blockedIps || blockedIps.length === 0) {
    mount.innerHTML = `<div class="player-activity-sub">Nenhum endereço IP bloqueado no momento.</div>`;
    return;
  }

  mount.innerHTML = '';
  blockedIps.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'blocked-ip-card';
    row.innerHTML = `
      <div>
        <code>${escapeHtml(b.ip)}</code>
        <span class="player-activity-sub"> — ${escapeHtml(b.reason)}</span>
        <div class="player-activity-sub">${b.hits || 1} bloqueio(s) · Desde ${escapeHtml(formatShortTime(b.blockedAt))}</div>
      </div>
      <button type="button" class="btn-ghost-sm">Desbloquear</button>
    `;

    row.querySelector('button').addEventListener('click', async () => {
      await fetch('/api/admin/unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: b.ip })
      });
      loadAdminOverview();
    });

    mount.appendChild(row);
  });
}

function renderOnlinePlayersList(onlinePlayers) {
  const mount = document.getElementById('onlinePlayersMount');
  if (!mount) return;

  if (!onlinePlayers || onlinePlayers.length === 0) {
    mount.innerHTML = `<div class="player-activity-sub">Nenhum jogador conectado no momento.</div>`;
    return;
  }

  mount.innerHTML = '';
  onlinePlayers.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'online-player-card';
    const meshBadge = p.isTailscale ? 'Tailscale' : 'HTTPS';

    row.innerHTML = `
      <div class="player-ident">
        <span class="live-dot"></span>
        <div>
          <strong>${escapeHtml(p.displayName)}</strong>
          <span class="player-activity-sub">(@${escapeHtml(p.username)} · ${meshBadge})</span>
          <div class="player-activity-sub">${escapeHtml(p.activity)}</div>
        </div>
      </div>
      <button type="button" class="btn-invite-direct">Convidar</button>
    `;

    const btn = row.querySelector('button');
    btn.addEventListener('click', async () => {
      btn.textContent = 'Enviando...';
      const ok = await sendDirectAdminInvite(p.peerId, p.userId);
      btn.textContent = ok ? 'Convite enviado' : 'Erro';
      setTimeout(() => {
        btn.textContent = 'Convidar';
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
      ? `<span class="badge-online">Online · ${escapeHtml(u.currentActivity)}</span>`
      : `<span class="badge-offline">Offline</span>`;

    const historyHtml =
      u.recentGames && u.recentGames.length > 0
        ? u.recentGames
            .slice(0, 4)
            .map((g) => `<span class="history-chip">${escapeHtml(g.gameTitle)}</span>`)
            .join('')
        : `<span class="player-activity-sub">${escapeHtml(u.lastPlayedGame || 'Sem registros')}</span>`;

    const canDelete = u.role !== 'admin';
    const identitySub = u.email ? `${u.email} · @${u.username}` : `@${u.username}`;
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(u.displayName)}</strong>
        <div class="player-activity-sub">${escapeHtml(identitySub)}</div>
      </td>
      <td>${statusHtml}</td>
      <td><code>${escapeHtml(u.tailscaleIp || 'Padrão')}</code></td>
      <td><strong>${u.gamesPlayedCount || 0}</strong></td>
      <td><div class="history-chips">${historyHtml}</div></td>
      <td>${escapeHtml(formatShortTime(u.lastLoginAt))}</td>
      <td>
        ${canDelete ? `<button type="button" class="btn-danger-sm" data-del-user="${escapeHtml(u.id)}">Remover</button>` : 'Sistema'}
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

function isBlockableAuditIp(ip) {
  if (!ip) return false;
  return !['admin', 'console', '127.0.0.1', '::1', '100.65.233.79'].includes(ip);
}

function renderAuditLogs(logs) {
  const mount = document.getElementById('accessLogsMount');
  if (!mount) return;
  mount.innerHTML = '';

  (logs || []).slice(0, 22).forEach((l) => {
    const isDanger = ['LOGIN_FAILED', 'SECURITY_LOCKOUT', 'IP_BLOCKED'].includes(l.event);
    const row = document.createElement('div');
    row.className = 'audit-item';
    const canBan = isBlockableAuditIp(l.ip) && l.event !== 'IP_BLOCKED';

    row.innerHTML = `
      <div>
        <span class="audit-event ${isDanger ? 'danger' : ''}">${escapeHtml(l.event)}</span>
        <span> — ${escapeHtml(l.displayName || l.username || 'Sistema')}: ${escapeHtml(l.detail || '')}</span>
      </div>
      <div class="audit-right">
        <span class="player-activity-sub">${escapeHtml(l.ip || '')} · ${escapeHtml(formatShortTime(l.timestamp))}</span>
        ${canBan ? `<button type="button" class="btn-danger-sm" data-ban-ip="${escapeHtml(l.ip)}">Banir IP</button>` : ''}
      </div>
    `;

    const banBtn = row.querySelector('[data-ban-ip]');
    if (banBtn) {
      banBtn.addEventListener('click', async () => {
        await fetch('/api/admin/blocklist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip: l.ip, reason: `Auditoria (${l.event})` })
        });
        loadAdminOverview();
      });
    }
    mount.appendChild(row);
  });
}

function updateKpiCounts(summary) {
  document.getElementById('kpiOnlineCount').textContent = String(summary.onlineCount);
  document.getElementById('kpiRoomsCount').textContent = `${summary.activeRoomsCount} salas em andamento`;
  document.getElementById('kpiPendingCount').textContent = String(summary.pendingApprovalsCount);
  document.getElementById('kpiUsersCount').textContent = `${summary.totalUsers} contas ativas`;
  document.getElementById('kpiMatchesCount').textContent = String(summary.totalMatchesPlayed);
  document.getElementById('kpiLoginsCount').textContent = `${summary.totalLogins} sessões autenticadas`;
  document.getElementById('kpiBlockedCount').textContent = `${summary.blockedIpsCount} IPs (${summary.blockedIntrusions} eventos)`;
}

function updateGpuStatusLabel(gpu) {
  const gpuOnline = Boolean(gpu && gpu.online);
  document.getElementById('kpiGpuStatus').textContent = gpuOnline
    ? `RTX 3050: Ativa (${gpu.gpuModel})`
    : 'RTX 3050: Standby';
}

function updateNetworkSwitches(netCfg) {
  if (!netCfg) return;
  const strictMesh = Boolean(netCfg.tailscaleLockdown);
  const toggle = document.getElementById('tailscaleLockdownToggle');
  if (toggle) toggle.checked = strictMesh;

  const selfRegToggle = document.getElementById('allowSelfRegToggle');
  if (selfRegToggle) selfRegToggle.checked = Boolean(netCfg.allowSelfRegistration);

  document.getElementById('adminTailscaleBadge').textContent = strictMesh
    ? 'Tailscale: Restrito (100.64.0.0/10)'
    : 'Tailscale: Ativo (100.65.233.79)';
}

function updateSummaryCards(data) {
  if (data.summary) updateKpiCounts(data.summary);
  updateGpuStatusLabel(data.gpu);
  updateNetworkSwitches(data.networkConfig);
}

function renderDashboardSections(data) {
  renderPendingApprovals(data.pendingUsers);
  renderBlockedIpsList(data.blockedIps);
  renderActivitySvgChart(data.hourlyActivity);
  renderTopGamesBars(data.topGames);
  renderOnlinePlayersList(data.onlinePlayers);
  renderUsersTable(data.users);
  renderAuditLogs(data.accessLogs);
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
  renderDashboardSections(data);
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
      errEl.textContent = body.error || 'Conta ou senha incorreta.';
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

async function submitNetworkPatch(patch) {
  await fetch('/api/admin/network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  });
  await loadAdminOverview();
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
      fb.textContent = data.error || 'Não foi possível criar a conta.';
      return;
    }

    fb.textContent = `Conta @${data.user.username} criada.`;
    ev.target.reset();
    await loadAdminOverview();
  });

  document.getElementById('tailscaleLockdownToggle').addEventListener('change', (ev) => {
    submitNetworkPatch({ tailscaleLockdown: ev.target.checked });
  });

  document.getElementById('allowSelfRegToggle').addEventListener('change', (ev) => {
    submitNetworkPatch({ allowSelfRegistration: ev.target.checked });
  });

  document.getElementById('manualBlockIpForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ip = document.getElementById('blockIpInput').value.trim();
    const reason = document.getElementById('blockReasonInput').value.trim() || 'Bloqueio manual';
    await fetch('/api/admin/blocklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, reason })
    });
    ev.target.reset();
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
    fb.textContent = res.ok ? 'Senha atualizada.' : data.error || 'Erro ao atualizar senha.';
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
