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

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm'
};

function sendJsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
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
  const buf = await readRequestBuffer(req, 1024 * 1024);
  if (buf.length === 0) {
    return {};
  }
  return JSON.parse(buf.toString('utf8'));
}

function buildHealthPayload(storage, rooms, gpuBridge) {
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
    gpuNode: gpuBridge.getStatus()
  };
}

function createApiRouter({ storage, rooms, gpuBridge }) {
  const exactRoutes = {
    'GET /api/health': (_req, res) =>
      sendJsonResponse(res, 200, buildHealthPayload(storage, rooms, gpuBridge)),
    'GET /api/deck': (_req, res) =>
      sendJsonResponse(res, 200, {
        games: storage.listUnifiedDeckLibrary(),
        consoles: CONSOLES,
        rooms: rooms.listPublicRooms(),
        gpu: gpuBridge.getStatus()
      }),
    'GET /api/consoles': (_req, res) =>
      sendJsonResponse(res, 200, { consoles: CONSOLES, gpuNode: gpuBridge.getStatus() }),
    'GET /api/roms': (_req, res, parsedUrl) =>
      sendJsonResponse(res, 200, { roms: storage.listRoms(parsedUrl.searchParams.get('console') || 'all') }),
    'POST /api/roms/upload': (req, res, parsedUrl) =>
      handleRomUpload(req, res, parsedUrl, storage),
    'GET /api/rooms': (_req, res) =>
      sendJsonResponse(res, 200, { rooms: rooms.listPublicRooms() }),
    'GET /api/gpu/status': (_req, res) =>
      sendJsonResponse(res, 200, { gpu: gpuBridge.getStatus() })
  };

  return async function handleApiRequest(req, res, parsedUrl) {
    const method = req.method || 'GET';
    const routeKey = `${method} ${parsedUrl.pathname}`;
    const exactHandler = exactRoutes[routeKey];
    if (exactHandler) {
      return exactHandler(req, res, parsedUrl);
    }

    const catalogMatch = parsedUrl.pathname.match(/^\/api\/catalog\/([a-z0-9-]+)\/ensure$/i);
    if (catalogMatch && method === 'POST') {
      const rom = await storage.ensureVerifiedGame(catalogMatch[1]);
      return sendJsonResponse(res, 200, { rom });
    }

    const romMatch = parsedUrl.pathname.match(/^\/api\/roms\/([a-f0-9-]+)(?:\/(file|save))?$/i);
    if (romMatch) {
      return handleRomItemRoute({ req, res, parsedUrl, storage, romId: romMatch[1], subAction: romMatch[2] });
    }

    if (parsedUrl.pathname.startsWith('/api/gpu/')) {
      return handleGpuMutationRoute(req, res, parsedUrl.pathname, gpuBridge);
    }

    return sendJsonResponse(res, 404, { error: 'API route not found' });
  };
}

function createSupersymmetryApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const publicDir = options.publicDir || path.join(__dirname, '..', 'public');
  const storage = new StorageManager(dataDir);
  const rooms = new RoomManager();
  const gpuBridge = new GpuNodeBridge(options.gpuToken, (gpuStatus) => {
    rooms.broadcastGpuState(gpuStatus);
  });

  const handleApiRequest = createApiRouter({ storage, rooms, gpuBridge });

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (parsedUrl.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, parsedUrl);
        return;
      }
      serveStaticFile(publicDir, parsedUrl.pathname, res);
    } catch (err) {
      sendJsonResponse(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    const client = rooms.registerClient(ws);
    ws.send(JSON.stringify({ type: 'gpu-updated', gpu: gpuBridge.getStatus() }));
    ws.on('message', (raw) => rooms.handleMessage(client, raw.toString()));
    ws.on('close', () => rooms.unregisterClient(client));
  });

  return { server, storage, rooms, gpuBridge, wss };
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
    return handleRomSaveRoute(ctx);
  }

  return sendJsonResponse(res, 405, { error: 'Method not allowed' });
}

async function handleRomSaveRoute({ req, res, parsedUrl, storage, romId }) {
  const slot = parsedUrl.searchParams.get('slot') || 'default.srm';
  if (req.method === 'GET') {
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
    return;
  }

  if (req.method === 'POST') {
    const buf = await readRequestBuffer(req, 1024 * 1024 * 32);
    const saved = await storage.saveBatteryOrState(romId, slot, buf);
    return sendJsonResponse(res, 200, { saved });
  }

  return sendJsonResponse(res, 405, { error: 'Method not allowed' });
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

function serveStaticFile(publicDir, requestPath, res) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
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
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(resolvedPath).pipe(res);
}

async function startServer() {
  const port = Number(process.env.PORT) || 3000;
  const app = createSupersymmetryApp();
  await app.storage.init();
  app.server.listen(port, '0.0.0.0', () => {
    console.log(`[Supersymmetry] SteamOS Console running on http://0.0.0.0:${port}`);
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
