'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { CONSOLES } = require('./consoles');
const { StorageManager } = require('./storage');
const { RoomManager } = require('./rooms');
const { GpuNodeBridge } = require('./gpu-bridge');
const { AuthManager, extractClientIp, isTailscaleCgnatIp } = require('./auth');
const { ProfileManager } = require('./profile');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

function sendJsonResponse(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders
  });
  res.end(body);
}

function buildSessionCookieHeader(req, token, maxAgeSec = 604800) {
  const isSecure = req.headers['x-forwarded-proto'] === 'https';
  const secureFlag = isSecure ? '; Secure' : '';
  return `ss_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureFlag}`;
}

function readRequestBuffer(req, maxBytes = 1024 * 1024 * 64) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload exceeds limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRequestBuffer(req, 32 * 1024);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString('utf8'));
}

function buildHealthPayload(storage, rooms, gpuBridge, auth) {
  const mem = process.memoryUsage();
  return {
    status: 'ok',
    project: 'Supersymmetry',
    coolifyProjectUuid: 'b0ialzsu5xdxdjl3ws7ygbl9',
    uptimeSec: Math.round(process.uptime()),
    memory: {
      rssMB: Number((mem.rss / (1024 * 1024)).toFixed(1)),
      heapUsedMB: Number((mem.heapUsed / (1024 * 1024)).toFixed(1))
    },
    romsCount: storage.listRoms().length,
    activeRooms: rooms.listPublicRooms().length,
    connectedPeers: rooms.clients.size,
    tailscaleLockdown: auth.networkConfig.tailscaleLockdown,
    blockedIpsCount: auth.blockedIps.length,
    gpuNode: gpuBridge.getStatus()
  };
}

function handleGetAuthMe(req, res, auth) {
  const ip = extractClientIp(req);
  const sess = auth.getSessionFromRequest(req);
  const isTailscaleMesh = isTailscaleCgnatIp(ip) || Boolean(sess && sess.user.tailscaleIp);
  return sendJsonResponse(res, 200, {
    authenticated: Boolean(sess),
    user: sess ? sess.user : null,
    clientIp: ip,
    isTailscale: isTailscaleMesh,
    network: {
      ip,
      isTailscaleMesh,
      tailscaleLockdown: auth.networkConfig.tailscaleLockdown
    },
    networkConfig: auth.networkConfig
  });
}

async function handlePostAuthLogin(req, res, auth) {
  const ip = extractClientIp(req);
  const body = await readJsonBody(req);
  const result = await auth.authenticate({
    username: body.username,
    password: body.password,
    ip,
    requireAdmin: Boolean(body.requireAdmin)
  });
  if (result.error) {
    return sendJsonResponse(res, result.status || 401, { error: result.error });
  }
  return sendJsonResponse(
    res,
    200,
    { user: result.user, token: result.token, isTailscale: isTailscaleCgnatIp(ip) },
    { 'Set-Cookie': buildSessionCookieHeader(req, result.token, 604800) }
  );
}

async function handlePostAuthRegister(req, res, auth) {
  if (!auth.networkConfig.allowSelfRegistration) {
    return sendJsonResponse(res, 403, { error: 'Inscrições desativadas no momento.' });
  }
  try {
    const ip = extractClientIp(req);
    const body = await readJsonBody(req);
    const user = await auth.registerPendingUser({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      ip
    });
    return sendJsonResponse(res, 201, {
      pending: true,
      user,
      message: 'Cadastro enviado. Aguardando aprovação.'
    });
  } catch (err) {
    return sendJsonResponse(res, 400, { error: err.message || 'Não foi possível concluir o cadastro.' });
  }
}

async function handlePostAuthLogout(req, res, auth) {
  await auth.revokeSession(req);
  return sendJsonResponse(
    res,
    200,
    { ok: true },
    { 'Set-Cookie': buildSessionCookieHeader(req, '', 0) }
  );
}

async function handleAuthRoute(req, res, pathname, auth) {
  const key = `${req.method || 'GET'} ${pathname}`;
  if (key === 'GET /api/auth/me') return handleGetAuthMe(req, res, auth);
  if (key === 'POST /api/auth/login') return handlePostAuthLogin(req, res, auth);
  if (key === 'POST /api/auth/register') return handlePostAuthRegister(req, res, auth);
  if (key === 'POST /api/auth/logout') return handlePostAuthLogout(req, res, auth);
  return sendJsonResponse(res, 404, { error: 'Auth route not found' });
}

async function handleAdminUserAction(req, res, { userId, subAction, auth }) {
  if (subAction === 'approve' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const user = await auth.approveUserAccount(userId, body);
    return sendJsonResponse(res, 200, { user });
  }
  if (subAction === 'reject' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await auth.rejectUserAccount(userId, body);
    return sendJsonResponse(res, 200, result);
  }
  return sendJsonResponse(res, 405, { error: 'Method not allowed' });
}

async function handleAdminUserItemRoute(req, res, { userId, subAction, auth }) {
  if (subAction) {
    return handleAdminUserAction(req, res, { userId, subAction, auth });
  }
  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const updated = await auth.updateUserAccount(userId, body);
    return sendJsonResponse(res, 200, { user: updated });
  }
  if (req.method === 'DELETE') {
    await auth.deleteUserAccount(userId);
    return sendJsonResponse(res, 200, { deleted: true, id: userId });
  }
  return sendJsonResponse(res, 405, { error: 'Method not allowed' });
}

function sendAdminOverview(req, res, { auth, rooms, gpuBridge }) {
  const ip = extractClientIp(req);
  const overview = auth.getDashboardOverview(rooms.listOnlinePlayers(), rooms.listPublicRooms());
  return sendJsonResponse(res, 200, {
    ...overview,
    network: {
      ip,
      isTailscaleMesh: isTailscaleCgnatIp(ip),
      tailscaleLockdown: auth.networkConfig.tailscaleLockdown
    },
    gpu: gpuBridge.getStatus()
  });
}

function buildAdminHandlers(sess, deps) {
  const { auth, rooms, gpuBridge } = deps;
  return {
    'GET /api/admin/overview': (req, res) => sendAdminOverview(req, res, { auth, rooms, gpuBridge }),
    'POST /api/admin/users': async (req, res) => {
      const created = await auth.createUserAccount(await readJsonBody(req));
      return sendJsonResponse(res, 201, { user: created });
    },
    'POST /api/admin/password': async (req, res) => {
      const body = await readJsonBody(req);
      await auth.changeAdminPassword(sess.user.id, body.newPassword);
      return sendJsonResponse(res, 200, { updated: true });
    },
    'POST /api/admin/network': async (req, res) => {
      const networkConfig = await auth.updateNetworkConfig(await readJsonBody(req));
      return sendJsonResponse(res, 200, { networkConfig });
    },
    'POST /api/admin/blocklist': async (req, res) => {
      const body = await readJsonBody(req);
      const entry = await auth.blockIp(body.ip, body.reason);
      return sendJsonResponse(res, 201, { blocked: entry });
    },
    'POST /api/admin/unblock': async (req, res) => {
      const body = await readJsonBody(req);
      const result = await auth.unblockIp(body.ip);
      return sendJsonResponse(res, 200, result);
    },
    'POST /api/admin/invite': async (req, res) => {
      const body = await readJsonBody(req);
      const sender = { name: sess.user.displayName, username: sess.user.username };
      return sendJsonResponse(res, 200, rooms.sendDirectInvite(sender, body));
    }
  };
}

function isMasterAdminSession(sess) {
  if (!sess) return false;
  return sess.user.role === 'admin';
}

async function handleAdminRoute(req, res, pathname, deps) {
  const sess = deps.auth.getSessionFromRequest(req);
  if (!isMasterAdminSession(sess)) {
    return sendJsonResponse(res, 401, { error: 'Não autorizado.' });
  }

  const routeKey = `${req.method || 'GET'} ${pathname}`;
  const handlers = buildAdminHandlers(sess, deps);
  if (handlers[routeKey]) {
    return handlers[routeKey](req, res);
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)(?:\/(approve|reject))?$/i);
  if (userMatch) {
    return handleAdminUserItemRoute(req, res, {
      userId: userMatch[1],
      subAction: userMatch[2],
      auth: deps.auth
    });
  }

  return sendJsonResponse(res, 404, { error: 'Admin route not found' });
}

async function handleSocialInviteRoute(req, res, auth, rooms) {
  const sess = auth.getSessionFromRequest(req);
  const body = await readJsonBody(req);
  const sender = sess
    ? { name: sess.user.displayName, username: sess.user.username }
    : { name: body.fromName || 'Jogador', username: 'player' };
  return sendJsonResponse(res, 200, rooms.sendDirectInvite(sender, body));
}

async function handlePatchProfileNickname(req, res, sess, { auth, rooms }) {
  const body = await readJsonBody(req);
  const cleanName = String(body.displayName || '').trim().slice(0, 28);
  if (!cleanName) {
    return sendJsonResponse(res, 400, { error: 'Informe um nome válido.' });
  }
  if (!sess) {
    return sendJsonResponse(res, 200, { user: { id: 'default', displayName: cleanName } });
  }
  const updated = await auth.updateUserAccount(sess.user.id, { displayName: cleanName });
  rooms.updateUserDisplayName(sess.user.id, cleanName);
  return sendJsonResponse(res, 200, { user: updated });
}

async function handleProfileRoute(req, res, pathname, deps) {
  const { auth, storage, rooms, profiles } = deps;
  const sess = auth.getSessionFromRequest(req);
  const userObj = sess ? sess.user : { id: 'default', username: 'player', displayName: 'Player 1', role: 'player' };
  const routeKey = `${req.method || 'GET'} ${pathname}`;

  const handlers = {
    'GET /api/profile': () =>
      sendJsonResponse(res, 200, {
        authenticated: Boolean(sess),
        ...profiles.getProfilePayload(userObj, storage)
      }),
    'PATCH /api/profile': () => handlePatchProfileNickname(req, res, sess, { auth, rooms }),
    'POST /api/profile': () => handlePatchProfileNickname(req, res, sess, { auth, rooms }),
    'POST /api/profile/playtime': async () => {
      const body = await readJsonBody(req);
      const recorded = await profiles.recordPlaytime({ userId: userObj.id, ...body });
      return sendJsonResponse(res, 200, { recorded });
    }
  };

  if (handlers[routeKey]) {
    return handlers[routeKey]();
  }
  return sendJsonResponse(res, 404, { error: 'Profile route not found' });
}

async function dispatchDynamicApiRoute(req, res, parsedUrl, deps) {
  const { pathname } = parsedUrl;
  const { storage, gpuBridge, auth, profiles } = deps;

  if (pathname.startsWith('/api/auth/')) return handleAuthRoute(req, res, pathname, auth);
  if (pathname.startsWith('/api/profile')) return handleProfileRoute(req, res, pathname, deps);
  if (pathname.startsWith('/api/admin/')) return handleAdminRoute(req, res, pathname, deps);
  if (pathname.startsWith('/api/gpu/')) return handleGpuMutationRoute(req, res, pathname, gpuBridge);

  const catalogMatch = pathname.match(/^\/api\/catalog\/([a-z0-9-]+)\/ensure$/i);
  if (catalogMatch && req.method === 'POST') {
    const rom = await storage.ensureVerifiedGame(catalogMatch[1]);
    return sendJsonResponse(res, 200, { rom });
  }

  const romMatch = pathname.match(/^\/api\/roms\/([a-f0-9-]+)(?:\/(file|save))?$/i);
  if (romMatch) {
    return handleRomItemRoute({
      req,
      res,
      parsedUrl,
      storage,
      auth,
      profiles,
      romId: romMatch[1],
      subAction: romMatch[2]
    });
  }

  return sendJsonResponse(res, 404, { error: 'API route not found' });
}

function createApiRouter(deps) {
  const { storage, rooms, gpuBridge, auth } = deps;
  const exactRoutes = {
    'GET /api/health': (_req, res) =>
      sendJsonResponse(res, 200, buildHealthPayload(storage, rooms, gpuBridge, auth)),
    'GET /api/deck': (_req, res) =>
      sendJsonResponse(res, 200, {
        games: storage.listUnifiedDeckLibrary(),
        consoles: CONSOLES,
        rooms: rooms.listPublicRooms(),
        onlinePlayers: rooms.listOnlinePlayers(),
        gpu: gpuBridge.getStatus()
      }),
    'GET /api/consoles': (_req, res) =>
      sendJsonResponse(res, 200, { consoles: CONSOLES, gpuNode: gpuBridge.getStatus() }),
    'GET /api/roms': (_req, res, parsedUrl) =>
      sendJsonResponse(res, 200, { roms: storage.listRoms(parsedUrl.searchParams.get('console') || 'all') }),
    'POST /api/roms/upload': (req, res, parsedUrl) =>
      handleRomUpload(req, res, parsedUrl, storage),
    'POST /api/social/invite': (req, res) =>
      handleSocialInviteRoute(req, res, auth, rooms),
    'GET /api/rooms': (_req, res) =>
      sendJsonResponse(res, 200, { rooms: rooms.listPublicRooms(), onlinePlayers: rooms.listOnlinePlayers() }),
    'GET /api/gpu/status': (_req, res) =>
      sendJsonResponse(res, 200, { gpu: gpuBridge.getStatus() })
  };

  return async function handleApiRequest(req, res, parsedUrl) {
    const exactHandler = exactRoutes[`${req.method || 'GET'} ${parsedUrl.pathname}`];
    if (exactHandler) {
      return exactHandler(req, res, parsedUrl);
    }
    return dispatchDynamicApiRoute(req, res, parsedUrl, deps);
  };
}

function configureHttpHardeningTimeouts(server) {
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 5000;
}

function createSupersymmetryApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const publicDir = options.publicDir || path.join(__dirname, '..', 'public');
  const storage = new StorageManager(dataDir);
  const auth = new AuthManager(dataDir, { initialAdminPassword: options.initialAdminPassword });
  const profiles = new ProfileManager(dataDir);
  const rooms = new RoomManager({
    onGameStarted: (info) => {
      auth.recordGameSession(info).catch(() => {});
      profiles.recordPlaytime({ ...info, seconds: 60, countSession: true }).catch(() => {});
    }
  });
  const gpuBridge = new GpuNodeBridge(options.gpuToken, (gpuStatus) => {
    rooms.broadcastGpuState(gpuStatus);
  });

  const origInit = storage.init.bind(storage);
  storage.init = async () => {
    await origInit();
    await auth.init();
    await profiles.init();
  };

  const handleApiRequest = createApiRouter({ storage, rooms, gpuBridge, auth, profiles });

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (parsedUrl.pathname !== '/api/health') {
        const sec = await auth.inspectRequestSecurity(extractClientIp(req), parsedUrl.pathname);
        if (!sec.allowed) {
          sendJsonResponse(res, sec.status, { error: sec.error });
          return;
        }
      }
      if (parsedUrl.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, parsedUrl);
        return;
      }
      serveStaticFile(publicDir, parsedUrl.pathname, res, req);
    } catch (err) {
      sendJsonResponse(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  configureHttpHardeningTimeouts(server);

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws, req) => {
    const clientIp = extractClientIp(req);
    if (auth.isIpBlocked(clientIp)) {
      ws.close(1008, 'Blocked');
      return;
    }
    const sess = auth.getSessionFromRequest(req);
    const client = rooms.registerClient(ws, sess);
    ws.send(JSON.stringify({ type: 'gpu-updated', gpu: gpuBridge.getStatus() }));
    ws.on('message', (raw) => rooms.handleMessage(client, raw.toString()));
    ws.on('close', () => rooms.unregisterClient(client));
  });

  return { server, storage, auth, profiles, rooms, gpuBridge, wss };
}

async function handleRomUpload(req, res, parsedUrl, storage) {
  const filename = req.headers['x-rom-filename'] || parsedUrl.searchParams.get('filename');
  if (!filename) {
    return sendJsonResponse(res, 400, { error: 'Missing x-rom-filename header or filename query parameter' });
  }
  const title = req.headers['x-rom-title'] || parsedUrl.searchParams.get('title') || '';
  const consoleId = req.headers['x-rom-console'] || parsedUrl.searchParams.get('console') || '';

  const entry = await storage.saveUploadedRom(req, {
    filename: decodeURIComponent(String(filename)),
    title: title ? decodeURIComponent(String(title)) : '',
    consoleId: String(consoleId)
  });
  return sendJsonResponse(res, 201, { rom: entry });
}

async function handleRomItemRoute(ctx) {
  const { req, res, storage, romId, subAction } = ctx;
  const rom = storage.getRomById(romId);
  if (!rom) {
    return sendJsonResponse(res, 404, { error: 'ROM not found' });
  }

  if (!subAction && req.method === 'DELETE') {
    await storage.deleteRom(romId);
    return sendJsonResponse(res, 200, { deleted: true, id: romId });
  }

  if (subAction === 'file' && req.method === 'GET') {
    storage.streamRomFile(rom, req, res);
    return;
  }

  if (subAction === 'save') {
    return handleRomSaveRoute({ ...ctx, rom });
  }

  return sendJsonResponse(res, 405, { error: 'Method not allowed' });
}

async function handleGetRomSave(res, storage, romId, slot) {
  const saveBuf = await storage.readBatteryOrState(romId, slot);
  if (!saveBuf) {
    return sendJsonResponse(res, 404, { error: 'No save file found for this ROM' });
  }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': saveBuf.length,
    'Cache-Control': 'no-store'
  });
  res.end(saveBuf);
}

async function handlePostRomSave(ctx, slot) {
  const { req, res, storage, auth, profiles, romId, rom } = ctx;
  const buf = await readRequestBuffer(req, 1024 * 1024 * 32);
  const saved = await storage.saveBatteryOrState(romId, slot, buf);
  const sess = auth ? auth.getSessionFromRequest(req) : null;
  await profiles.recordSaveFile({
    userId: sess ? sess.user.id : 'default',
    rom,
    slotName: slot,
    sizeBytes: buf.length
  });
  return sendJsonResponse(res, 200, { saved });
}

async function handleRomSaveRoute(ctx) {
  const slot = ctx.parsedUrl.searchParams.get('slot') || 'default.srm';
  if (ctx.req.method === 'GET') {
    return handleGetRomSave(ctx.res, ctx.storage, ctx.romId, slot);
  }
  if (ctx.req.method === 'POST') {
    return handlePostRomSave(ctx, slot);
  }
  return sendJsonResponse(ctx.res, 405, { error: 'Method not allowed' });
}

async function handleGpuMutationRoute(req, res, pathname, gpuBridge) {
  if (!gpuBridge.verifyToken(req.headers['x-gpu-token'])) {
    return sendJsonResponse(res, 401, { error: 'Invalid X-GPU-Token' });
  }

  if (req.method === 'POST' && pathname === '/api/gpu/heartbeat') {
    const body = await readJsonBody(req);
    return sendJsonResponse(res, 200, { gpu: gpuBridge.registerHeartbeat(body) });
  }

  if (req.method === 'POST' && pathname === '/api/gpu/offline') {
    return sendJsonResponse(res, 200, { gpu: gpuBridge.markOffline() });
  }

  return sendJsonResponse(res, 404, { error: 'GPU route not found' });
}

function extractRequestHostname(req) {
  if (!req || !req.headers) return '';
  return String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
}

function resolveDefaultHtmlFile(requestPath, req) {
  if (requestPath === '/admin' || requestPath === '/admin/') {
    return '/admin.html';
  }
  if (requestPath === '/') {
    return extractRequestHostname(req).startsWith('admin.') ? '/admin.html' : '/index.html';
  }
  return requestPath;
}

function serveStaticFile(publicDir, requestPath, res, req) {
  const cleanPath = resolveDefaultHtmlFile(requestPath, req);
  const resolvedPath = path.resolve(publicDir, `.${cleanPath}`);
  if (!resolvedPath.startsWith(path.resolve(publicDir))) {
    sendJsonResponse(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    sendJsonResponse(res, 404, { error: 'Asset not found' });
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS });
  fs.createReadStream(resolvedPath).pipe(res);
}

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const app = createSupersymmetryApp();
  await app.storage.init();
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`[Supersymmetry] Console & Admin running on http://0.0.0.0:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Supersymmetry] Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = {
  createSupersymmetryApp
};
