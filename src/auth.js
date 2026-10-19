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
const AUTOBAN_FAILED_ATTEMPTS = 10;
const HTTP_WINDOW_MS = 60 * 1000;
const MAX_HTTP_REQ_PER_MIN = 240;
const AUTOBAN_HTTP_REQ_PER_MIN = 450;

const EXPLOIT_PATH_PREFIX_RE = /^\/(\.env|\.git|wp-admin|wp-login|cgi-bin|boaform|actuator|vendor\/phpunit|shell|eval-stdin)/i;
const EXPLOIT_EXT_RE = /\.(php|asp|aspx|jsp|cgi)$/i;
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYSTEM_LOCAL_IPS = new Set(['', '127.0.0.1', '::1', 'localhost']);

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

function isExploitProbePath(pathname) {
  if (!pathname) return false;
  return EXPLOIT_PATH_PREFIX_RE.test(pathname) || EXPLOIT_EXT_RE.test(pathname);
}

function isProtectedSystemIp(ip, vpsTailscaleIp) {
  const clean = String(ip || '').trim();
  if (SYSTEM_LOCAL_IPS.has(clean)) return true;
  return clean === vpsTailscaleIp;
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

function resolveUserStatus(user) {
  return user.status === 'pending' ? 'pending' : 'active';
}

function toPublicUser(user) {
  const status = resolveUserStatus(user);
  return {
    id: user.id,
    username: user.username,
    email: String(user.email || ''),
    displayName: user.displayName,
    role: user.role,
    status,
    approved: status === 'active',
    tailscaleIp: String(user.tailscaleIp || ''),
    registrationIp: String(user.registrationIp || ''),
    disabled: Boolean(user.disabled),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    lastIp: user.lastIp,
    gamesPlayedCount: Number(user.gamesPlayedCount || 0),
    lastPlayedGame: user.lastPlayedGame
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

function deriveUniqueUsernameFromEmail(email, existingUsers) {
  const base = sanitizeUsername(String(email).split('@')[0]) || 'jogador';
  const candidateBase = base.length >= 2 ? base : `p_${base}`;
  if (!existingUsers.some((u) => u.username.toLowerCase() === candidateBase)) {
    return candidateBase;
  }
  let counter = 2;
  while (existingUsers.some((u) => u.username.toLowerCase() === `${candidateBase}${counter}`)) {
    counter += 1;
  }
  return `${candidateBase}${counter}`;
}

function assertMinPasswordLength(password, minLen, errMsg) {
  if (!password || String(password).length < minLen) {
    throw new Error(errMsg);
  }
}

function validateNewAccountFields(cleanUsername, password, existingUsers) {
  if (cleanUsername.length < 2) {
    throw new Error('Nome de usuário inválido (mínimo 2 caracteres).');
  }
  assertMinPasswordLength(password, 6, 'A senha deve ter pelo menos 6 caracteres.');
  if (existingUsers.some((u) => u.username.toLowerCase() === cleanUsername)) {
    throw new Error('Este nome de usuário já está cadastrado.');
  }
}

function isEmailAlreadyRegistered(user, cleanEmail) {
  if (user.username.toLowerCase() === cleanEmail) return true;
  return Boolean(user.email && user.email.toLowerCase() === cleanEmail);
}

function validatePendingRegistrationInput(cleanEmail, password, existingUsers) {
  if (!EMAIL_FORMAT_RE.test(cleanEmail)) {
    throw new Error('Informe um endereço de e-mail válido.');
  }
  assertMinPasswordLength(password, 6, 'A senha deve ter pelo menos 6 caracteres.');
  if (existingUsers.some((u) => isEmailAlreadyRegistered(u, cleanEmail))) {
    throw new Error('Este e-mail já está registrado.');
  }
}

function applyNonAdminFlags(user, patch) {
  if (user.role === 'admin') return;
  if (patch.status !== undefined) {
    user.status = patch.status === 'pending' ? 'pending' : 'active';
  }
  if (patch.disabled !== undefined) {
    user.disabled = Boolean(patch.disabled);
  }
}

function applyUserPatchFields(user, patch) {
  if (patch.displayName !== undefined) {
    user.displayName = String(patch.displayName).trim() || user.username;
  }
  if (patch.tailscaleIp !== undefined) {
    user.tailscaleIp = String(patch.tailscaleIp).trim();
  }
  if (patch.password && String(patch.password).length >= 6) {
    user.passwordHash = hashPassword(patch.password);
  }
  applyNonAdminFlags(user, patch);
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
    this.blockedIps = [];
    this.networkConfig = {
      tailscaleLockdown: false,
      allowSelfRegistration: true,
      tailnetDomain: 'kalopsia.ts.net',
      vpsTailscaleIp: '100.65.233.79'
    };
    this.failedAttempts = new Map();
    this.httpRateWindows = new Map();
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
    this.blockedIps = Array.isArray(parsed.blockedIps) ? parsed.blockedIps : [];
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
        blockedIps: this.blockedIps.slice(0, 500),
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
    if (existingAdmin) {
      existingAdmin.status = 'active';
      return existingAdmin;
    }

    const adminUser = {
      id: crypto.randomUUID(),
      username: 'admin',
      email: 'admin@superssymetry.kalopsia.me',
      displayName: 'Admin Master',
      role: 'admin',
      status: 'active',
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

  findBlockedIpEntry(ip) {
    const clean = String(ip || '').trim();
    if (!clean) return null;
    return this.blockedIps.find((b) => b.ip === clean) || null;
  }

  isIpBlocked(ip) {
    const entry = this.findBlockedIpEntry(ip);
    if (!entry) return false;
    entry.hits = (entry.hits || 0) + 1;
    entry.lastBlockedAt = new Date().toISOString();
    return true;
  }

  upsertBlockedIpRecord(cleanIp, reason) {
    const existing = this.findBlockedIpEntry(cleanIp);
    const nowIso = new Date().toISOString();
    if (existing) {
      existing.reason = reason || existing.reason;
      existing.hits = (existing.hits || 1) + 1;
      existing.lastBlockedAt = nowIso;
      return existing;
    }
    const created = {
      ip: cleanIp,
      reason: String(reason || 'Bloqueio de segurança'),
      blockedAt: nowIso,
      lastBlockedAt: nowIso,
      hits: 1,
      isTailscale: isTailscaleCgnatIp(cleanIp)
    };
    this.blockedIps.unshift(created);
    return created;
  }

  async blockIp(ip, reason = 'Bloqueio manual') {
    const cleanIp = String(ip || '').trim();
    if (isProtectedSystemIp(cleanIp, this.networkConfig.vpsTailscaleIp)) {
      throw new Error('Este endereço IP é protegido pelo sistema.');
    }
    const entry = this.upsertBlockedIpRecord(cleanIp, reason);
    this.sessions = this.sessions.filter((s) => s.ip !== cleanIp);
    this.appendAccessLog({
      username: 'IPS',
      event: 'IP_BLOCKED',
      ip: cleanIp,
      isTailscale: entry.isTailscale,
      detail: entry.reason
    });
    await this.saveState();
    return entry;
  }

  async autoBanIpIfExternal(ip, reason) {
    const cleanIp = String(ip || '').trim();
    if (isProtectedSystemIp(cleanIp, this.networkConfig.vpsTailscaleIp)) return null;
    return this.blockIp(cleanIp, reason);
  }

  async unblockIp(ip) {
    const cleanIp = String(ip || '').trim();
    this.blockedIps = this.blockedIps.filter((b) => b.ip !== cleanIp);
    this.httpRateWindows.delete(cleanIp);
    this.appendAccessLog({
      username: 'IPS',
      event: 'IP_UNBLOCKED',
      ip: cleanIp,
      isTailscale: isTailscaleCgnatIp(cleanIp),
      detail: 'IP removido da lista de bloqueio'
    });
    await this.saveState();
    return { unblocked: true, ip: cleanIp };
  }

  recordHttpRateHit(ip) {
    const now = Date.now();
    const prev = this.httpRateWindows.get(ip);
    if (!prev || now - prev.windowStart > HTTP_WINDOW_MS) {
      const fresh = { count: 1, windowStart: now };
      this.httpRateWindows.set(ip, fresh);
      return fresh.count;
    }
    prev.count += 1;
    return prev.count;
  }

  async inspectRequestSecurity(ip, pathname) {
    const cleanIp = String(ip || '127.0.0.1').trim();
    if (this.isIpBlocked(cleanIp)) {
      return { allowed: false, status: 403, error: 'Conexão bloqueada.' };
    }
    if (isExploitProbePath(pathname)) {
      await this.autoBanIpIfExternal(cleanIp, `Scanner bloqueado (${pathname})`);
      return { allowed: false, status: 403, error: 'Conexão bloqueada.' };
    }
    const reqCount = this.recordHttpRateHit(cleanIp);
    if (reqCount > AUTOBAN_HTTP_REQ_PER_MIN) {
      await this.autoBanIpIfExternal(cleanIp, 'Anomalia de tráfego (Anti-DDoS)');
      return { allowed: false, status: 403, error: 'Conexão bloqueada.' };
    }
    if (reqCount > MAX_HTTP_REQ_PER_MIN && !isProtectedSystemIp(cleanIp, this.networkConfig.vpsTailscaleIp)) {
      return { allowed: false, status: 429, error: 'Limite de requisições excedido.' };
    }
    return { allowed: true };
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
    return record.count;
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
    if (user.email && user.email.toLowerCase() === normalized) return true;
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
    const failCount = this.recordFailedAttempt(rateKey);
    this.appendAccessLog({
      username: String(username || 'unknown'),
      event: 'LOGIN_FAILED',
      ip,
      isTailscale: isTailscaleCgnatIp(ip),
      detail: requireAdmin ? 'Acesso recusado (Sistema)' : 'Conta ou senha incorreta'
    });
    if (failCount >= AUTOBAN_FAILED_ATTEMPTS) {
      await this.autoBanIpIfExternal(ip, 'Múltiplas falhas de autenticação');
    } else {
      await this.saveState();
    }
    return { error: 'Conta ou senha incorreta.', status: 401 };
  }

  async handleLockoutResponse(username, ip) {
    this.appendAccessLog({
      username: String(username || 'unknown'),
      event: 'SECURITY_LOCKOUT',
      ip,
      isTailscale: isTailscaleCgnatIp(ip),
      detail: 'Limite de tentativas excedido'
    });
    await this.saveState();
    return { error: 'Muitas tentativas. Aguarde alguns minutos.', status: 429 };
  }

  async authenticate({ username, password, ip, requireAdmin = false }) {
    if (this.isIpBlocked(ip)) {
      return { error: 'Conexão bloqueada.', status: 403 };
    }
    const rateKey = `${ip}:${String(username || '').toLowerCase()}`;
    if (this.isLockedOut(rateKey)) {
      return this.handleLockoutResponse(username, ip);
    }

    const user = this.findUserByCredentials(username, password);
    if (!this.isAuthorizedForRole(user, requireAdmin)) {
      return this.logFailedLogin(rateKey, username, ip, requireAdmin);
    }
    if (user.status === 'pending') {
      return { error: 'Conta aguardando aprovação.', status: 403 };
    }
    if (!this.passesNetworkPolicy(user, ip)) {
      return { error: 'Conexão não autorizada.', status: 403 };
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

  isActiveApprovedUser(user) {
    if (!user || user.disabled) return false;
    return user.status !== 'pending';
  }

  getSessionFromRequest(req) {
    const ip = extractClientIp(req);
    if (this.isIpBlocked(ip)) return null;

    const session = this.findActiveSession(extractRequestToken(req));
    if (!session) return null;

    const user = this.users.find((u) => u.id === session.userId);
    if (!this.isActiveApprovedUser(user)) return null;
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

  async registerPendingUser({ email, password, displayName = '', ip = '127.0.0.1' }) {
    if (this.isIpBlocked(ip)) {
      throw new Error('Conexão bloqueada.');
    }
    const cleanEmail = String(email || '').trim().toLowerCase();
    validatePendingRegistrationInput(cleanEmail, password, this.users);

    const cleanUsername = deriveUniqueUsernameFromEmail(cleanEmail, this.users);
    const cleanDisplay = String(displayName || '').trim() || cleanUsername;
    const pendingUser = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      email: cleanEmail,
      displayName: cleanDisplay,
      role: 'player',
      status: 'pending',
      passwordHash: hashPassword(password),
      tailscaleIp: isTailscaleCgnatIp(ip) ? ip : '',
      registrationIp: ip,
      disabled: false,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      lastIp: ip,
      gamesPlayedCount: 0,
      lastPlayedGame: null
    };

    this.users.push(pendingUser);
    this.appendAccessLog({
      userId: pendingUser.id,
      username: pendingUser.username,
      displayName: pendingUser.displayName,
      event: 'ACCOUNT_PENDING',
      ip,
      isTailscale: isTailscaleCgnatIp(ip),
      detail: `Solicitou acesso (${cleanEmail})`
    });
    await this.saveState();
    return toPublicUser(pendingUser);
  }

  async approveUserAccount(userId, patch = {}) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('Conta não encontrada.');
    user.status = 'active';
    user.disabled = false;
    if (patch.tailscaleIp !== undefined) {
      user.tailscaleIp = String(patch.tailscaleIp).trim();
    }
    this.appendAccessLog({
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      event: 'ACCOUNT_APPROVED',
      ip: user.registrationIp || 'admin',
      isTailscale: Boolean(user.tailscaleIp),
      detail: `Cadastro aprovado (${user.email || user.username})`
    });
    await this.saveState();
    return toPublicUser(user);
  }

  async rejectUserAccount(userId, { banIp = false } = {}) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('Conta não encontrada.');
    if (user.role === 'admin') throw new Error('Não permitido.');

    const targetIp = user.registrationIp;
    this.users = this.users.filter((u) => u.id !== userId);
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    this.appendAccessLog({
      username: user.username,
      displayName: user.displayName,
      event: 'ACCOUNT_REJECTED',
      ip: targetIp || 'admin',
      isTailscale: isTailscaleCgnatIp(targetIp),
      detail: `Solicitação recusada (${user.email || user.username})`
    });
    if (banIp && targetIp) {
      await this.autoBanIpIfExternal(targetIp, `Cadastro recusado (@${user.username})`);
    } else {
      await this.saveState();
    }
    return { rejected: true, id: userId };
  }

  async createUserAccount({ username, email = '', displayName, password, role = 'player', tailscaleIp = '' }) {
    const cleanUsername = sanitizeUsername(username || String(email).split('@')[0]);
    validateNewAccountFields(cleanUsername, password, this.users);

    const newUser = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      email: String(email || '').trim().toLowerCase(),
      displayName: String(displayName || cleanUsername).trim(),
      role: role === 'admin' ? 'admin' : 'player',
      status: 'active',
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
      detail: `Conta criada (${newUser.role})`
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
    assertMinPasswordLength(newPassword, 8, 'A nova senha deve ter no mínimo 8 caracteres.');
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
    if (patch.allowSelfRegistration !== undefined) {
      this.networkConfig.allowSelfRegistration = Boolean(patch.allowSelfRegistration);
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
    const enriched = this.users.map((u) => this.enrichUserWithTelemetry(u, onlinePlayers));
    const pendingUsers = enriched.filter((u) => u.status === 'pending');
    const activeUsers = enriched.filter((u) => u.status !== 'pending');
    const hourlyActivity = buildHourlyBuckets(this.accessLogs, this.gameSessions);
    const topGames = buildTopGamesRanking(this.gameSessions);
    const isIncident = (l) => ['LOGIN_FAILED', 'SECURITY_LOCKOUT', 'IP_BLOCKED'].includes(l.event);

    return {
      networkConfig: this.networkConfig,
      summary: {
        totalUsers: activeUsers.length,
        pendingApprovalsCount: pendingUsers.length,
        blockedIpsCount: this.blockedIps.length,
        onlineCount: onlinePlayers.length,
        activeRoomsCount: activeRooms.length,
        totalMatchesPlayed: this.gameSessions.length,
        totalLogins: this.accessLogs.filter((l) => l.event === 'LOGIN_SUCCESS').length,
        blockedIntrusions: this.accessLogs.filter(isIncident).length
      },
      hourlyActivity,
      topGames,
      telemetry: { hourlySeries: hourlyActivity, topGames },
      users: activeUsers,
      pendingUsers,
      blockedIps: this.blockedIps,
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
  isTailscaleCgnatIp,
  isExploitProbePath
};
