'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SCRYPT_PARAMS = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const KEY_LENGTH = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived.toString('hex')}`;
}

function parseScryptParts(storedRecord) {
  if (!storedRecord || typeof storedRecord !== 'string') return null;
  const parts = storedRecord.split('$');
  if (parts.length !== 6) return null;
  if (parts[0] !== 'scrypt') return null;
  return {
    N: Number.parseInt(parts[1], 10),
    r: Number.parseInt(parts[2], 10),
    p: Number.parseInt(parts[3], 10),
    salt: parts[4],
    expectedBuf: Buffer.from(parts[5], 'hex')
  };
}

function verifyPassword(password, storedRecord) {
  const parsed = parseScryptParts(storedRecord);
  if (!parsed) return false;
  try {
    const derived = crypto.scryptSync(String(password), parsed.salt, parsed.expectedBuf.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * 1024 * 1024
    });
    if (derived.length !== parsed.expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, parsed.expectedBuf);
  } catch {
    return false;
  }
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function pickForwardedHeader(headers) {
  if (headers['cf-connecting-ip']) return headers['cf-connecting-ip'];
  if (headers['x-real-ip']) return headers['x-real-ip'];
  return headers['x-forwarded-for'] || '';
}

function extractClientIp(req) {
  const forwarded = pickForwardedHeader(req.headers || {});
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  const raw = (req.socket && req.socket.remoteAddress) || '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

function isValidTailscaleOctets(octets) {
  if (octets.length !== 4) return false;
  if (octets.some((n) => Number.isNaN(n))) return false;
  if (octets[0] !== 100) return false;
  return octets[1] >= 64 && octets[1] <= 127;
}

function isTailscaleCgnatIp(ip) {
  if (!ip) return false;
  const clean = String(ip).trim().replace(/^::ffff:/, '');
  if (clean.startsWith('fd7a:115c:a1e0:')) return true;
  const octets = clean.split('.').map((n) => Number.parseInt(n, 10));
  return isValidTailscaleOctets(octets);
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  String(cookieHeader)
    .split(';')
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx > 0) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        out[k] = decodeURIComponent(v);
      }
    });
  return out;
}

function extractRequestToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.ss_session) return cookies.ss_session;
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    tailscaleIp: user.tailscaleIp || '',
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    lastIp: user.lastIp || null,
    gamesPlayedCount: user.gamesPlayedCount || 0,
    lastPlayedGame: user.lastPlayedGame || null
  };
}

function computeBucketIndex(ts, windowStart, bucketSpan) {
  return Math.min(11, Math.max(0, Math.floor((ts - windowStart) / bucketSpan)));
}

function buildHourlyBuckets(accessLogs, gameSessions) {
  const now = Date.now();
  const buckets = Array.from({ length: 12 }, (_, idx) => {
    const slotTime = new Date(now - (11 - idx) * 2 * 3600 * 1000);
    const hh = String(slotTime.getHours()).padStart(2, '0');
    return { label: `${hh}h`, logins: 0, matches: 0 };
  });

  const bucketSpan = 2 * 3600 * 1000;
  const windowStart = now - 12 * bucketSpan;

  accessLogs.forEach((log) => {
    const ts = new Date(log.timestamp).getTime();
    if (ts >= windowStart && log.event === 'LOGIN_SUCCESS') {
      buckets[computeBucketIndex(ts, windowStart, bucketSpan)].logins += 1;
    }
  });

  gameSessions.forEach((sess) => {
    const ts = new Date(sess.startedAt).getTime();
    if (ts >= windowStart) {
      buckets[computeBucketIndex(ts, windowStart, bucketSpan)].matches += 1;
    }
  });

  return buckets;
}

function buildTopGamesRanking(gameSessions) {
  const map = new Map();
  gameSessions.forEach((s) => {
    const key = s.gameTitle || 'Jogo';
    const prev = map.get(key) || { title: key, consoleName: s.consoleName || 'SNES', count: 0 };
    prev.count += 1;
    map.set(key, prev);
  });
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function sanitizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
}

function validateNewAccountFields(cleanUsername, password, existingUsers) {
  if (cleanUsername.length < 2) {
    throw new Error('Nome de usuário inválido (mínimo 2 caracteres).');
  }
  if (!password || String(password).length < 6) {
    throw new Error('A senha deve ter pelo menos 6 caracteres.');
  }
  if (existingUsers.some((u) => u.username.toLowerCase() === cleanUsername)) {
    throw new Error('Este nome de usuário já está cadastrado.');
  }
}

function applyUserPatchFields(user, patch) {
  if (patch.displayName !== undefined) {
    user.displayName = String(patch.displayName).trim() || user.username;
  }
  if (patch.tailscaleIp !== undefined) {
    user.tailscaleIp = String(patch.tailscaleIp).trim();
  }
  if (patch.disabled !== undefined && user.role !== 'admin') {
    user.disabled = Boolean(patch.disabled);
  }
  if (patch.password && String(patch.password).length >= 6) {
    user.passwordHash = hashPassword(patch.password);
  }
}

class AuthManager {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.authPath = path.join(dataDir, 'auth.json');
    this.initialAdminPassword = options.initialAdminPassword || process.env.ADMIN_INITIAL_PASSWORD || '@derN3445';
    this.users = [];
    this.sessions = [];
    this.accessLogs = [];
    this.gameSessions = [];
    this.networkConfig = {
      tailscaleLockdown: false,
      tailnetDomain: 'kalopsia.ts.net',
      vpsTailscaleIp: '100.65.233.79'
    };
    this.failedAttempts = new Map();
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    await this.loadState();
    await this.ensureMasterAdmin();
  }

  async loadState() {
    try {
      const raw = await fsp.readFile(this.authPath, 'utf8');
      this.hydrateParsedState(JSON.parse(raw));
    } catch {
      await this.saveState();
    }
  }

  hydrateParsedState(parsed) {
    this.users = Array.isArray(parsed.users) ? parsed.users : [];
    this.sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    this.accessLogs = Array.isArray(parsed.accessLogs) ? parsed.accessLogs : [];
    this.gameSessions = Array.isArray(parsed.gameSessions) ? parsed.gameSessions : [];
    if (parsed.networkConfig) {
      this.networkConfig = { ...this.networkConfig, ...parsed.networkConfig };
    }
  }

  async saveState() {
    const payload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        networkConfig: this.networkConfig,
        users: this.users,
        sessions: this.sessions,
        accessLogs: this.accessLogs.slice(0, 250),
        gameSessions: this.gameSessions.slice(0, 300)
      },
      null,
      2
    );
    const tmp = `${this.authPath}.tmp`;
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, this.authPath);
  }

  async ensureMasterAdmin() {
    const existingAdmin = this.users.find((u) => u.role === 'admin');
    if (existingAdmin) return existingAdmin;

    const adminUser = {
      id: crypto.randomUUID(),
      username: 'admin',
      displayName: 'Admin Master',
      role: 'admin',
      passwordHash: hashPassword(this.initialAdminPassword),
      tailscaleIp: '100.65.233.79',
      disabled: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastIp: null,
      gamesPlayedCount: 0,
      lastPlayedGame: null
    };
    this.users.unshift(adminUser);
    await this.saveState();
    return adminUser;
  }

  isLockedOut(rateKey) {
    const record = this.failedAttempts.get(rateKey);
    if (!record) return false;
    if (record.lockedUntil && Date.now() < record.lockedUntil) return true;
    if (Date.now() - record.firstFailedAt > LOCKOUT_WINDOW_MS) {
      this.failedAttempts.delete(rateKey);
    }
    return false;
  }

  recordFailedAttempt(rateKey) {
    const now = Date.now();
    const record = this.failedAttempts.get(rateKey) || { count: 0, firstFailedAt: now, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= MAX_FAILED_ATTEMPTS) {
      record.lockedUntil = now + LOCKOUT_DURATION_MS;
    }
    this.failedAttempts.set(rateKey, record);
  }

  appendAccessLog(entry) {
    this.accessLogs.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.accessLogs.length > 250) {
      this.accessLogs.length = 250;
    }
  }

  matchesUserLoginName(user, normalized) {
    if (user.username.toLowerCase() === normalized) return true;
    return user.role === 'admin' && normalized === 'kalopsia';
  }

  findUserByCredentials(usernameInput, passwordInput) {
    const normalized = String(usernameInput || '').trim().toLowerCase();
    const user = this.users.find((u) => this.matchesUserLoginName(u, normalized));
    if (!user || user.disabled) return null;
    if (!verifyPassword(passwordInput, user.passwordHash)) return null;
    return user;
  }

  isAuthorizedForRole(user, requireAdmin) {
    if (!user) return false;
    if (requireAdmin) return user.role === 'admin';
    return true;
  }

  passesNetworkPolicy(user, ip) {
    if (!this.networkConfig.tailscaleLockdown) return true;
    if (user.role === 'admin') return true;
    return this.isAllowedByTailscale(user, ip);
  }

  async logFailedLogin(rateKey, username, ip, requireAdmin) {
    this.recordFailedAttempt(rateKey);
    this.appendAccessLog({
      username: String(username || 'unknown'),
      event: 'LOGIN_FAILED',
      ip,
      isTailscale: isTailscaleCgnatIp(ip),
      detail: requireAdmin ? 'Tentativa negada no Portal Admin' : 'Credenciais inválidas'
    });
    await this.saveState();
    return { error: 'Credenciais inválidas ou acesso não autorizado.', status: 401 };
  }

  async authenticate({ username, password, ip, requireAdmin = false }) {
    const rateKey = `${ip}:${String(username || '').toLowerCase()}`;
    if (this.isLockedOut(rateKey)) {
      this.appendAccessLog({
        username: String(username || 'unknown'),
        event: 'SECURITY_LOCKOUT',
        ip,
        isTailscale: isTailscaleCgnatIp(ip),
        detail: 'Bloqueio temporário anti-força-bruta ativo'
      });
      await this.saveState();
      return { error: 'Muitas tentativas. Aguarde 15 minutos.', status: 429 };
    }

    const user = this.findUserByCredentials(username, password);
    if (!this.isAuthorizedForRole(user, requireAdmin)) {
      return this.logFailedLogin(rateKey, username, ip, requireAdmin);
    }

    if (!this.passesNetworkPolicy(user, ip)) {
      return { error: 'Acesso restrito à rede segura Tailscale (100.64.0.0/10).', status: 403 };
    }

    this.failedAttempts.delete(rateKey);
    return this.issueSessionForUser(user, ip);
  }

  isAllowedByTailscale(user, ip) {
    if (isTailscaleCgnatIp(ip)) return true;
    return Boolean(user.tailscaleIp && user.tailscaleIp === ip);
  }

  async issueSessionForUser(user, ip) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const isTailscale = isTailscaleCgnatIp(ip) || Boolean(user.tailscaleIp);

    user.lastLoginAt = nowIso;
    user.lastIp = ip;

    this.sessions = this.sessions.filter((s) => s.expiresAt > Date.now());
    this.sessions.unshift({
      tokenHash,
      userId: user.id,
      ip,
      isTailscale,
      createdAt: nowIso,
      expiresAt: Date.now() + SESSION_TTL_MS
    });

    this.appendAccessLog({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      event: 'LOGIN_SUCCESS',
      ip,
      isTailscale,
      detail: `Sessão autenticada (${user.role.toUpperCase()})`
    });

    await this.saveState();
    return { status: 200, token: rawToken, user: toPublicUser(user) };
  }

  findActiveSession(rawToken) {
    if (!rawToken) return null;
    const tokenHash = sha256Hex(rawToken);
    return this.sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt > Date.now()) || null;
  }

  getSessionFromRequest(req) {
    const session = this.findActiveSession(extractRequestToken(req));
    if (!session) return null;

    const user = this.users.find((u) => u.id === session.userId && !u.disabled);
    if (!user) return null;

    const ip = extractClientIp(req);
    if (!this.passesNetworkPolicy(user, ip)) return null;

    return { user: toPublicUser(user), rawUser: user, session, ip };
  }

  async revokeSession(req) {
    const rawToken = extractRequestToken(req);
    if (!rawToken) return;
    const tokenHash = sha256Hex(rawToken);
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
    await this.saveState();
  }

  async createUserAccount({ username, displayName, password, role = 'player', tailscaleIp = '' }) {
    const cleanUsername = sanitizeUsername(username);
    validateNewAccountFields(cleanUsername, password, this.users);

    const newUser = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      displayName: String(displayName || cleanUsername).trim(),
      role: role === 'admin' ? 'admin' : 'player',
      passwordHash: hashPassword(password),
      tailscaleIp: String(tailscaleIp || '').trim(),
      disabled: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastIp: null,
      gamesPlayedCount: 0,
      lastPlayedGame: null
    };

    this.users.push(newUser);
    this.appendAccessLog({
      userId: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      event: 'ACCOUNT_CREATED',
      ip: 'admin',
      isTailscale: Boolean(newUser.tailscaleIp),
      detail: `Conta criada pelo Admin (${newUser.role})`
    });
    await this.saveState();
    return toPublicUser(newUser);
  }

  async updateUserAccount(userId, patch) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado.');
    applyUserPatchFields(user, patch);
    await this.saveState();
    return toPublicUser(user);
  }

  async deleteUserAccount(userId) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('Usuário não encontrado.');
    if (user.role === 'admin' && this.users.filter((u) => u.role === 'admin').length <= 1) {
      throw new Error('Não é permitido remover a conta Admin principal.');
    }
    this.users = this.users.filter((u) => u.id !== userId);
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    await this.saveState();
    return true;
  }

  async changeAdminPassword(adminId, newPassword) {
    if (!newPassword || String(newPassword).length < 8) {
      throw new Error('A nova senha de Admin deve ter no mínimo 8 caracteres.');
    }
    const admin = this.users.find((u) => u.id === adminId);
    if (!admin) throw new Error('Admin não encontrado.');
    admin.passwordHash = hashPassword(newPassword);
    await this.saveState();
    return true;
  }

  async updateNetworkConfig(patch) {
    if (patch.tailscaleLockdown !== undefined) {
      this.networkConfig.tailscaleLockdown = Boolean(patch.tailscaleLockdown);
    }
    if (patch.tailnetDomain !== undefined) {
      this.networkConfig.tailnetDomain = String(patch.tailnetDomain).trim();
    }
    if (patch.vpsTailscaleIp !== undefined) {
      this.networkConfig.vpsTailscaleIp = String(patch.vpsTailscaleIp).trim();
    }
    await this.saveState();
    return this.networkConfig;
  }

  resolvePlayerRecord(userId, playerName) {
    if (userId) {
      const byId = this.users.find((u) => u.id === userId);
      if (byId) return byId;
    }
    const cleanName = String(playerName || '').trim().toLowerCase();
    return (
      this.users.find(
        (u) => u.username.toLowerCase() === cleanName || u.displayName.toLowerCase() === cleanName
      ) || this.users[0]
    );
  }

  async recordGameSession({ userId, playerName, gameTitle, consoleName, consoleId, roomId, mode = 'wasm-p2p' }) {
    const user = this.resolvePlayerRecord(userId, playerName);
    if (!user) return null;

    const nowIso = new Date().toISOString();
    user.gamesPlayedCount = (user.gamesPlayedCount || 0) + 1;
    user.lastPlayedGame = gameTitle;

    const entry = {
      id: crypto.randomUUID(),
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      gameTitle,
      consoleName: consoleName || 'Console',
      consoleId: consoleId || 'snes',
      roomId: roomId || null,
      mode,
      startedAt: nowIso
    };
    this.gameSessions.unshift(entry);
    this.appendAccessLog({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      event: 'GAME_START',
      ip: user.lastIp || 'console',
      isTailscale: Boolean(user.tailscaleIp),
      detail: `Iniciou ${gameTitle} (${consoleName || 'Console'})`
    });
    await this.saveState();
    return entry;
  }

  enrichUserWithTelemetry(u, onlinePlayers) {
    const recentGames = this.gameSessions.filter((s) => s.userId === u.id).slice(0, 8);
    const onlineInfo = onlinePlayers.find((p) => p.userId === u.id) || null;
    return {
      ...toPublicUser(u),
      online: Boolean(onlineInfo),
      currentActivity: onlineInfo ? onlineInfo.activity : 'Offline',
      currentRoomId: onlineInfo ? onlineInfo.roomId : null,
      recentGames
    };
  }

  getDashboardOverview(onlinePlayers = [], activeRooms = []) {
    const usersWithHistory = this.users.map((u) => this.enrichUserWithTelemetry(u, onlinePlayers));
    const hourlyActivity = buildHourlyBuckets(this.accessLogs, this.gameSessions);
    const topGames = buildTopGamesRanking(this.gameSessions);
    const isIncident = (l) => ['LOGIN_FAILED', 'SECURITY_LOCKOUT'].includes(l.event);

    return {
      networkConfig: this.networkConfig,
      summary: {
        totalUsers: this.users.length,
        onlineCount: onlinePlayers.length,
        activeRoomsCount: activeRooms.length,
        totalMatchesPlayed: this.gameSessions.length,
        totalLogins: this.accessLogs.filter((l) => l.event === 'LOGIN_SUCCESS').length,
        blockedIntrusions: this.accessLogs.filter(isIncident).length
      },
      hourlyActivity,
      topGames,
      telemetry: { hourlySeries: hourlyActivity, topGames },
      users: usersWithHistory,
      onlinePlayers,
      activeRooms,
      recentGameSessions: this.gameSessions.slice(0, 30),
      accessLogs: this.accessLogs.slice(0, 40)
    };
  }
}

module.exports = {
  AuthManager,
  hashPassword,
  verifyPassword,
  extractClientIp,
  isTailscaleCgnatIp
};
