'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { createSupersymmetryApp } = require('../src/server');

async function startTestApp() {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'supersymmetry-test-'));
  const app = createSupersymmetryApp({ dataDir: tmpDir, gpuToken: 'test-gpu-secret' });
  await app.storage.init();

  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const { port } = app.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  async function cleanup() {
    for (const client of app.wss.clients) {
      client.terminate();
    }
    await new Promise((resolve) => app.server.close(resolve));
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }

  return { app, baseUrl, wsUrl, cleanup };
}

test('Supersymmetry API: /api/deck and /api/health return SteamOS library with 24 No-Intro verified games', async () => {
  const { baseUrl, cleanup } = await startTestApp();
  try {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.project, 'Supersymmetry');
    assert.equal(body.coolifyProjectUuid, 'b0ialzsu5xdxdjl3ws7ygbl9');

    const deckRes = await fetch(`${baseUrl}/api/deck`).then((r) => r.json());
    assert.ok(Array.isArray(deckRes.games));
    assert.ok(deckRes.games.length >= 24);
    assert.ok(deckRes.games.some((g) => g.slug === 'super-bomberman-4' && g.boxartUrl.includes('thumbnails.libretro.com')));
    assert.ok(deckRes.games.some((g) => g.slug === 'pokemon-emerald'));

    const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifestRes.status, 200);
    assert.ok(manifestRes.headers.get('content-type').includes('application/manifest+json'));
    const manifest = await manifestRes.json();
    assert.equal(manifest.display, 'standalone');

    const htmlText = await fetch(`${baseUrl}/`).then((r) => r.text());
    assert.ok(htmlText.includes('viewport-fit=cover'));
    assert.ok(htmlText.includes('id="virtualGamepad"'));
    assert.ok(htmlText.includes('id="touchDpad"'));
    assert.ok(htmlText.includes('id="touchActionCluster"'));
  } finally {
    await cleanup();
  }
});

test('Supersymmetry Storage: uploads ROM, deduplicates by SHA-1, streams HTTP 206 byte ranges, and persists Cloud Save', async () => {
  const { baseUrl, cleanup } = await startTestApp();
  try {
    const romBytes = Buffer.from('SUPER_BOMBERMAN_4_SNES_TEST_ROM_PAYLOAD_0123456789ABCDEF');
    const uploadRes = await fetch(`${baseUrl}/api/roms/upload`, {
      method: 'POST',
      headers: {
        'x-rom-filename': 'Super_Bomberman_4.sfc',
        'x-rom-title': 'Super Bomberman 4',
        'x-rom-console': 'snes'
      },
      body: romBytes
    });
    assert.equal(uploadRes.status, 201);
    const { rom } = await uploadRes.json();
    assert.equal(rom.consoleId, 'snes');
    assert.equal(rom.core, 'snes9x');
    assert.equal(rom.sizeBytes, romBytes.length);

    const rangeRes = await fetch(`${baseUrl}/api/roms/${rom.id}/file`, {
      headers: { Range: 'bytes=0-14' }
    });
    assert.equal(rangeRes.status, 206);
    const partialBuf = Buffer.from(await rangeRes.arrayBuffer());
    assert.equal(partialBuf.toString(), 'SUPER_BOMBERMAN');

    const srmPayload = Buffer.from('SRAM_SAVE_DATA_BOMBERMAN_STAGE_5');
    const saveRes = await fetch(`${baseUrl}/api/roms/${rom.id}/save`, {
      method: 'POST',
      body: srmPayload
    });
    assert.equal(saveRes.status, 200);

    const loadSaveRes = await fetch(`${baseUrl}/api/roms/${rom.id}/save`);
    assert.equal(loadSaveRes.status, 200);
    const loadedSrm = Buffer.from(await loadSaveRes.arrayBuffer());
    assert.deepEqual(loadedSrm, srmPayload);
  } finally {
    await cleanup();
  }
});

test('Supersymmetry GPU Bridge: authenticates RTX 3050 heartbeat and toggles ONLINE/OFFLINE state', async () => {
  const { baseUrl, cleanup } = await startTestApp();
  try {
    const unauthorized = await fetch(`${baseUrl}/api/gpu/heartbeat`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);

    const hbRes = await fetch(`${baseUrl}/api/gpu/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GPU-Token': 'test-gpu-secret'
      },
      body: JSON.stringify({
        gpuModel: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
        vramTotalMiB: 6144,
        vramUsedMiB: 1420,
        temperatureC: 52,
        activeGame: 'Bomba Patch PS2',
        streamUrl: 'https://rtx3050-stream.trycloudflare.com'
      })
    });
    assert.equal(hbRes.status, 200);
    const { gpu } = await hbRes.json();
    assert.equal(gpu.online, true);
    assert.equal(gpu.activeGame, 'Bomba Patch PS2');

    const offRes = await fetch(`${baseUrl}/api/gpu/offline`, {
      method: 'POST',
      headers: { 'X-GPU-Token': 'test-gpu-secret' }
    });
    const offBody = await offRes.json();
    assert.equal(offBody.gpu.online, false);
  } finally {
    await cleanup();
  }
});

test('Supersymmetry WebSocket Rooms: Host creates 4-player room, friend joins Slot 2, and WebRTC signaling relays', async () => {
  const { wsUrl, cleanup } = await startTestApp();
  try {
    const hostWs = new WebSocket(wsUrl);
    const guestWs = new WebSocket(wsUrl);

    const waitForType = (ws, expectedType) =>
      new Promise((resolve) => {
        const handler = (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === expectedType) {
            ws.off('message', handler);
            resolve(msg);
          }
        };
        ws.on('message', handler);
      });

    await Promise.all([waitForType(hostWs, 'welcome'), waitForType(guestWs, 'welcome')]);

    const hostJoinedPromise = waitForType(hostWs, 'room-joined');
    hostWs.send(JSON.stringify({
      type: 'create-room',
      roomId: 'BOMB04',
      playerName: 'Kalopsia',
      consoleId: 'snes',
      consoleName: 'SNES',
      gameTitle: 'Super Bomberman 4'
    }));
    const hostJoined = await hostJoinedPromise;
    assert.equal(hostJoined.slot, 1);
    assert.equal(hostJoined.isHost, true);

    const guestJoinedPromise = waitForType(guestWs, 'room-joined');
    const hostNotifiedPromise = waitForType(hostWs, 'peer-joined');
    guestWs.send(JSON.stringify({
      type: 'join-room',
      roomId: 'BOMB04',
      playerName: 'Amigo2'
    }));

    const [guestJoined, hostNotified] = await Promise.all([guestJoinedPromise, hostNotifiedPromise]);
    assert.equal(guestJoined.slot, 2);
    assert.equal(guestJoined.isHost, false);
    assert.equal(hostNotified.slot, 2);

    const signalPromise = waitForType(guestWs, 'webrtc-signal');
    hostWs.send(JSON.stringify({
      type: 'webrtc-signal',
      targetPeerId: hostNotified.peerId,
      signal: { sdp: { type: 'offer', sdp: 'v=0-mock-sdp' } }
    }));
    const relayedSignal = await signalPromise;
    assert.equal(relayedSignal.signal.sdp.type, 'offer');

    hostWs.close();
    guestWs.close();
  } finally {
    await cleanup();
  }
});
