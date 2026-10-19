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
  await app.auth.init();

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
    assert.ok(htmlText.includes('id="icon-reflektor-diamond"'));
    assert.ok(htmlText.includes('id="reflektorFadeMask"'));
    assert.ok(htmlText.includes('id="heroBoxartMirror"'));
    assert.ok(!htmlText.includes('N GAMES'));
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

async function loginAsMasterAdmin(baseUrl) {
  const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '100.65.233.79'
    },
    body: JSON.stringify({ username: 'admin', password: '@derN3445', requireAdmin: true })
  });
  assert.equal(adminLogin.status, 200);
  const cookieHeader = adminLogin.headers.get('set-cookie');
  assert.ok(cookieHeader && cookieHeader.includes('ss_session='));
  return cookieHeader.split(';')[0];
}

test('Supersymmetry Zero-Trust Admin Fortress: authenticates @derN3445, creates player accounts, and serves admin.superssimetry.kalopsia.me', async () => {
  const { baseUrl, cleanup } = await startTestApp();
  try {
    const adminHostHtml = await fetch(`${baseUrl}/`, {
      headers: { 'X-Forwarded-Host': 'admin.superssimetry.kalopsia.me' }
    }).then((r) => r.text());
    assert.ok(adminHostHtml.includes('Supersymmetry — Administração'));
    assert.ok(adminHostHtml.includes('adminLoginForm'));

    const unauthOverview = await fetch(`${baseUrl}/api/admin/overview`);
    assert.equal(unauthOverview.status, 401);

    const wrongLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong-password', requireAdmin: true })
    });
    assert.equal(wrongLogin.status, 401);
    const wrongBody = await wrongLogin.json();
    assert.equal(wrongBody.error, 'Conta ou senha incorreta.');

    const sessionCookie = await loginAsMasterAdmin(baseUrl);
    const createPlayerRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        username: 'lucas',
        displayName: 'Lucas P2',
        password: 'LucasSecret99!',
        tailscaleIp: '100.88.10.12'
      })
    });
    assert.equal(createPlayerRes.status, 201);
    const { user: lucasUser } = await createPlayerRes.json();
    assert.equal(lucasUser.username, 'lucas');
    assert.equal(lucasUser.tailscaleIp, '100.88.10.12');
  } finally {
    await cleanup();
  }
});

test('Supersymmetry Admin Telemetry & Direct Invites: pushes zero-link WebSocket invites and aggregates 24h game telemetry', async () => {
  const { baseUrl, wsUrl, cleanup } = await startTestApp();
  try {
    const sessionCookie = await loginAsMasterAdmin(baseUrl);
    const playerWs = new WebSocket(wsUrl);
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

    const welcomeMsg = await waitForType(playerWs, 'welcome');
    const invitePromise = waitForType(playerWs, 'direct-invite');

    const inviteRes = await fetch(`${baseUrl}/api/admin/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify({
        targetPeerId: welcomeMsg.peerId,
        gameSlug: 'super-bomberman-4',
        gameTitle: 'Super Bomberman 4',
        consoleName: 'Super Nintendo'
      })
    });
    assert.equal(inviteRes.status, 200);
    const inviteBody = await inviteRes.json();
    assert.equal(inviteBody.deliveredCount, 1);

    const pushedInvite = await invitePromise;
    assert.equal(pushedInvite.invite.gameTitle, 'Super Bomberman 4');

    const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Cookie: sessionCookie, 'X-Forwarded-For': '100.65.233.79' }
    });
    assert.equal(overviewRes.status, 200);
    const overview = await overviewRes.json();
    assert.equal(overview.network.isTailscaleMesh, true);
    assert.equal(overview.telemetry.hourlySeries.length, 12);

    playerWs.close();
  } finally {
    await cleanup();
  }
});

test('Supersymmetry IPS & Self-Registration Approval Queue: holds new sign-ups pending until Admin approval and auto-bans exploit scanners', async () => {
  const { baseUrl, cleanup } = await startTestApp();
  try {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '100.90.10.5' },
      body: JSON.stringify({
        displayName: 'Pedro P3',
        email: 'pedro@kalopsia.me',
        password: 'PedroSecretPassword!'
      })
    });
    assert.equal(regRes.status, 201);
    const regBody = await regRes.json();
    assert.equal(regBody.pending, true);
    assert.equal(regBody.user.status, 'pending');

    const preApproveLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pedro@kalopsia.me', password: 'PedroSecretPassword!' })
    });
    assert.equal(preApproveLogin.status, 403);
    const preBody = await preApproveLogin.json();
    assert.equal(preBody.error, 'Conta aguardando aprovação.');

    const adminCookie = await loginAsMasterAdmin(baseUrl);
    const approveRes = await fetch(`${baseUrl}/api/admin/users/${regBody.user.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ tailscaleIp: '100.90.10.5' })
    });
    assert.equal(approveRes.status, 200);

    const postApproveLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pedro@kalopsia.me', password: 'PedroSecretPassword!' })
    });
    assert.equal(postApproveLogin.status, 200);

    const exploitProbe = await fetch(`${baseUrl}/.env`, {
      headers: { 'X-Forwarded-For': '198.51.100.77' }
    });
    assert.equal(exploitProbe.status, 403);

    const subsequentFromAttacker = await fetch(`${baseUrl}/api/deck`, {
      headers: { 'X-Forwarded-For': '198.51.100.77' }
    });
    assert.equal(subsequentFromAttacker.status, 403);
  } finally {
    await cleanup();
  }
});


