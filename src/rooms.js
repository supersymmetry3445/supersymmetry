'use strict';

const crypto = require('node:crypto');

const MAX_PLAYERS_PER_ROOM = 4;

const DEFAULT_SYSTEM_ROOMS = [
  {
    id: 'SALA-01',
    name: 'Sala #1 · Bomberman 4',
    slug: 'super-bomberman-4',
    gameTitle: 'Super Bomberman 4',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 4
  },
  {
    id: 'SALA-02',
    name: 'Sala #2 · Bomberman 5',
    slug: 'super-bomberman-5',
    gameTitle: 'Super Bomberman 5',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 4
  },
  {
    id: 'SALA-03',
    name: 'Sala #3 · ISS Deluxe',
    slug: 'iss-deluxe',
    gameTitle: 'International Superstar Soccer Deluxe',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 4
  },
  {
    id: 'SALA-04',
    name: 'Sala #4 · Mario Kart',
    slug: 'super-mario-kart',
    gameTitle: 'Super Mario Kart',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 2
  },
  {
    id: 'SALA-05',
    name: 'Sala #5 · Top Gear',
    slug: 'top-gear',
    gameTitle: 'Top Gear',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 2
  },
  {
    id: 'SALA-06',
    name: 'Sala #6 · Ultimate MK3',
    slug: 'umk3-snes',
    gameTitle: 'Ultimate Mortal Kombat 3',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 2
  },
  {
    id: 'SALA-07',
    name: 'Sala #7 · Street Fighter II',
    slug: 'street-fighter-ii-turbo',
    gameTitle: 'Street Fighter II Turbo',
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    maxPlayers: 2
  },
  {
    id: 'SALA-08',
    name: 'Sala #8 · Streets of Rage 2',
    slug: 'streets-of-rage-2',
    gameTitle: 'Streets of Rage 2',
    consoleId: 'segaMD',
    consoleName: 'Mega Drive',
    maxPlayers: 2
  }
];

function sendJson(ws, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function serializePlayerSlot(p, hostPeerId) {
  return {
    peerId: p.peerId,
    name: p.name,
    slot: p.slot,
    isHost: p.peerId === hostPeerId,
    pingMs: p.pingMs || 0
  };
}

function serializeRoom(room) {
  const players = Array.from(room.players.values()).map((p) =>
    serializePlayerSlot(p, room.hostPeerId)
  );
  return {
    id: room.id,
    name: room.name,
    slug: room.slug || null,
    isSystemRoom: Boolean(room.isSystemRoom),
    maxPlayers: room.maxPlayers || MAX_PLAYERS_PER_ROOM,
    status: players.length > 0 ? 'active' : 'open',
    consoleId: room.consoleId,
    consoleName: room.consoleName,
    romId: room.romId,
    gameTitle: room.gameTitle,
    hostPeerId: room.hostPeerId,
    hostName: room.hostName,
    mode: room.mode,
    streamUrl: room.streamUrl,
    createdAt: room.createdAt,
    players
  };
}

function buildGuestProfile(peerId) {
  const shortId = peerId.slice(0, 4);
  return {
    userId: null,
    username: `guest-${shortId}`,
    name: `Player-${shortId}`,
    role: 'player',
    tailscaleIp: '',
    isTailscale: false
  };
}

function buildAuthenticatedProfile(authSession) {
  const { user, session } = authSession;
  return {
    userId: user.id,
    username: user.username,
    name: user.displayName,
    role: user.role,
    tailscaleIp: user.tailscaleIp || '',
    isTailscale: Boolean(session && session.isTailscale)
  };
}

function buildClientRecord(ws, peerId, authSession) {
  const profile = authSession ? buildAuthenticatedProfile(authSession) : buildGuestProfile(peerId);
  return {
    peerId,
    ...profile,
    activity: 'No Menu',
    roomId: null,
    slot: null,
    pingMs: 0,
    ws
  };
}

function serializeOnlinePlayer(c) {
  return {
    peerId: c.peerId,
    userId: c.userId,
    username: c.username,
    displayName: c.name,
    role: c.role,
    tailscaleIp: c.tailscaleIp,
    isTailscale: c.isTailscale,
    roomId: c.roomId,
    slot: c.slot,
    activity: c.activity
  };
}

function applyGuestNameIfProvided(client, playerName) {
  if (!playerName || client.userId) return;
  client.name = String(playerName).slice(0, 24);
}

function buildSystemRoomRecord(seed) {
  return {
    id: seed.id,
    name: seed.name,
    slug: seed.slug,
    isSystemRoom: true,
    maxPlayers: seed.maxPlayers,
    consoleId: seed.consoleId,
    consoleName: seed.consoleName,
    romId: null,
    gameTitle: seed.gameTitle,
    hostPeerId: null,
    hostName: 'Sala Aberta',
    mode: 'wasm-p2p',
    streamUrl: null,
    createdAt: new Date().toISOString(),
    players: new Map()
  };
}

const ROOM_RECORD_DEFAULTS = {
  slug: null,
  maxPlayers: MAX_PLAYERS_PER_ROOM,
  consoleId: 'snes',
  consoleName: 'SNES',
  romId: null,
  gameTitle: 'Super Bomberman 4',
  mode: 'wasm-p2p',
  streamUrl: null
};

function buildRoomRecord(client, roomId, data) {
  const merged = { ...ROOM_RECORD_DEFAULTS, ...data };
  const gameTitle = String(merged.gameTitle).slice(0, 60);
  return {
    id: roomId,
    name: String(merged.roomName || `Sala · ${gameTitle}`).slice(0, 48),
    slug: merged.slug,
    isSystemRoom: false,
    maxPlayers: Number(merged.maxPlayers) || MAX_PLAYERS_PER_ROOM,
    consoleId: merged.consoleId,
    consoleName: merged.consoleName,
    romId: merged.romId,
    gameTitle,
    hostPeerId: client.peerId,
    hostName: client.name,
    mode: merged.mode,
    streamUrl: merged.streamUrl,
    createdAt: new Date().toISOString(),
    players: new Map([[client.peerId, client]])
  };
}

function resolveInviteRoomFields(room, payload) {
  if (room) {
    return {
      roomId: room.id,
      gameTitle: room.gameTitle,
      consoleName: room.consoleName
    };
  }
  return {
    roomId: payload.roomId || null,
    gameTitle: payload.gameTitle || 'Sessão Multiplayer',
    consoleName: payload.consoleName || 'Console'
  };
}

function buildInviteRecord(senderInfo, room, payload) {
  const roomFields = resolveInviteRoomFields(room, payload);
  const resolvedSlug = payload.gameSlug || payload.slug || null;
  return {
    id: crypto.randomUUID().slice(0, 8),
    fromName: senderInfo.name || 'Admin',
    fromUsername: senderInfo.username || 'admin',
    ...roomFields,
    slug: resolvedSlug,
    gameSlug: resolvedSlug,
    sentAt: new Date().toISOString()
  };
}

function matchesInviteTarget(client, targetPeerId, targetUserId) {
  if (targetPeerId && client.peerId === targetPeerId) return true;
  if (targetUserId && client.userId === targetUserId) return true;
  return false;
}

function matchesRoomGame(room, data) {
  if (data.slug && room.slug === data.slug) return true;
  const targetTitle = String(data.gameTitle || '').trim().toLowerCase();
  return Boolean(targetTitle && room.gameTitle.toLowerCase() === targetTitle);
}

class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.clients = new Map();
    this.onGameStarted = options.onGameStarted || null;
    this.seedSystemRooms();
  }

  seedSystemRooms() {
    DEFAULT_SYSTEM_ROOMS.forEach((seed) => {
      this.rooms.set(seed.id, buildSystemRoomRecord(seed));
    });
  }

  registerClient(ws, authSession = null) {
    const peerId = crypto.randomUUID().slice(0, 8);
    const client = buildClientRecord(ws, peerId, authSession);
    this.clients.set(peerId, client);
    sendJson(ws, {
      type: 'welcome',
      peerId,
      name: client.name,
      rooms: this.listPublicRooms(),
      onlinePlayers: this.listOnlinePlayers()
    });
    this.broadcastPresenceState();
    return client;
  }

  listPublicRooms() {
    return Array.from(this.rooms.values()).map(serializeRoom);
  }

  listOnlinePlayers() {
    return Array.from(this.clients.values()).map(serializeOnlinePlayer);
  }

  broadcastToAll(payload) {
    for (const client of this.clients.values()) {
      sendJson(client.ws, payload);
    }
  }

  broadcastPresenceState() {
    this.broadcastToAll({ type: 'presence-updated', onlinePlayers: this.listOnlinePlayers() });
  }

  broadcastLobbyState() {
    this.broadcastToAll({
      type: 'rooms-updated',
      rooms: this.listPublicRooms(),
      onlinePlayers: this.listOnlinePlayers()
    });
  }

  broadcastGpuState(gpuStatus) {
    this.broadcastToAll({ type: 'gpu-updated', gpu: gpuStatus });
  }

  broadcastToRoom(room, payload, excludePeerId = null) {
    for (const player of room.players.values()) {
      if (player.peerId !== excludePeerId) {
        sendJson(player.ws, payload);
      }
    }
  }

  findAvailableSlot(room) {
    const usedSlots = new Set();
    for (const player of room.players.values()) {
      if (typeof player.slot === 'number') {
        usedSlots.add(player.slot);
      }
    }
    const maxSlots = room.maxPlayers || MAX_PLAYERS_PER_ROOM;
    for (let slot = 1; slot <= maxSlots; slot += 1) {
      if (!usedSlots.has(slot)) {
        return slot;
      }
    }
    return 0;
  }

  notifyGameStarted(client, room) {
    if (!this.onGameStarted) return;
    this.onGameStarted({
      userId: client.userId,
      playerName: client.name,
      gameTitle: room.gameTitle,
      consoleName: room.consoleName,
      consoleId: room.consoleId,
      roomId: room.id,
      mode: room.mode
    });
  }

  findMatchingSystemRoom(data) {
    for (const room of this.rooms.values()) {
      if (room.isSystemRoom && matchesRoomGame(room, data)) {
        if (room.players.size < (room.maxPlayers || MAX_PLAYERS_PER_ROOM)) {
          return room;
        }
      }
    }
    return null;
  }

  assignFirstPlayerAsHost(room, client, data) {
    room.hostPeerId = client.peerId;
    room.hostName = client.name;
    if (data.romId) room.romId = data.romId;
    if (data.mode) room.mode = data.mode;
    if (data.streamUrl !== undefined) room.streamUrl = data.streamUrl;

    client.slot = 1;
    client.roomId = room.id;
    client.activity = `Jogando ${room.gameTitle}`;
    room.players.set(client.peerId, client);

    this.notifyGameStarted(client, room);
    sendJson(client.ws, {
      type: 'room-joined',
      room: serializeRoom(room),
      slot: 1,
      isHost: true
    });
    this.broadcastLobbyState();
  }

  createRoom(client, data) {
    this.leaveCurrentRoom(client);
    applyGuestNameIfProvided(client, data.playerName);

    if (!data.roomId) {
      const sysRoom = this.findMatchingSystemRoom(data);
      if (sysRoom) {
        this.enterExistingRoom(client, sysRoom, data);
        return;
      }
    }

    const roomId = String(data.roomId || crypto.randomUUID().slice(0, 6)).toUpperCase();
    const existing = this.rooms.get(roomId);
    if (existing && existing.isSystemRoom) {
      this.enterExistingRoom(client, existing, data);
      return;
    }

    const room = buildRoomRecord(client, roomId, data);
    client.slot = 1;
    client.roomId = roomId;
    client.activity = `Jogando ${room.gameTitle}`;

    this.rooms.set(roomId, room);
    this.notifyGameStarted(client, room);
    sendJson(client.ws, { type: 'room-joined', room: serializeRoom(room), slot: 1, isHost: true });
    this.broadcastLobbyState();
  }

  enterExistingRoom(client, room, data = {}) {
    if (room.players.size === 0 || !room.hostPeerId) {
      this.assignFirstPlayerAsHost(room, client, data);
      return;
    }

    const assignedSlot = this.findAvailableSlot(room);
    client.slot = assignedSlot;
    client.roomId = room.id;
    client.activity = `Na ${room.name} (${room.gameTitle})`;
    room.players.set(client.peerId, client);

    const serialized = serializeRoom(room);
    sendJson(client.ws, {
      type: 'room-joined',
      room: serialized,
      slot: assignedSlot,
      isHost: room.hostPeerId === client.peerId
    });

    this.broadcastToRoom(
      room,
      {
        type: 'peer-joined',
        peerId: client.peerId,
        name: client.name,
        slot: assignedSlot,
        room: serialized
      },
      client.peerId
    );

    this.broadcastLobbyState();
  }

  joinRoom(client, data) {
    const roomId = String(data.roomId || '').toUpperCase();
    const room = this.rooms.get(roomId);
    if (!room) {
      sendJson(client.ws, { type: 'error', message: `Sala ${roomId} não encontrada.` });
      return;
    }

    this.leaveCurrentRoom(client);
    applyGuestNameIfProvided(client, data.playerName);
    this.enterExistingRoom(client, room, data);
  }

  resetOrDeleteRoom(room) {
    this.broadcastToRoom(room, {
      type: 'room-closed',
      roomId: room.id,
      reason: 'Sessão encerrada.'
    });
    for (const peer of room.players.values()) {
      peer.roomId = null;
      peer.slot = null;
      peer.activity = 'No Menu';
    }
    room.players.clear();

    if (room.isSystemRoom) {
      room.hostPeerId = null;
      room.hostName = 'Sala Aberta';
      room.romId = null;
      room.streamUrl = null;
      return;
    }
    this.rooms.delete(room.id);
  }

  leaveCurrentRoom(client) {
    if (!client.roomId) return;
    const room = this.rooms.get(client.roomId);
    client.roomId = null;
    client.slot = null;
    client.activity = 'No Menu';
    if (!room) return;

    room.players.delete(client.peerId);
    if (room.players.size === 0 || room.hostPeerId === client.peerId) {
      this.resetOrDeleteRoom(room);
    } else {
      this.broadcastToRoom(room, {
        type: 'peer-left',
        peerId: client.peerId,
        name: client.name,
        room: serializeRoom(room)
      });
    }
    this.broadcastLobbyState();
  }

  sendDirectInvite(senderInfo, payload) {
    const room = payload.roomId ? this.rooms.get(String(payload.roomId).toUpperCase()) : null;
    const invite = buildInviteRecord(senderInfo, room, payload);

    let delivered = 0;
    for (const c of this.clients.values()) {
      if (matchesInviteTarget(c, payload.targetPeerId, payload.targetUserId)) {
        sendJson(c.ws, { type: 'direct-invite', invite });
        delivered += 1;
      }
    }
    return { delivered, deliveredCount: delivered, invite };
  }

  relayWebRtcSignal(client, data) {
    const target = this.clients.get(data.targetPeerId);
    if (!target || target.roomId !== client.roomId) return;
    sendJson(target.ws, {
      type: 'webrtc-signal',
      fromPeerId: client.peerId,
      fromName: client.name,
      fromSlot: client.slot,
      signal: data.signal
    });
  }

  relayPadInput(client, data) {
    if (!client.roomId) return;
    const room = this.rooms.get(client.roomId);
    if (!room) return;
    const host = this.clients.get(room.hostPeerId);
    if (!host || host.peerId === client.peerId) return;
    sendJson(host.ws, {
      type: 'pad-input',
      fromPeerId: client.peerId,
      slot: client.slot,
      buttons: data.buttons,
      axes: data.axes,
      timestamp: data.timestamp
    });
  }

  relayChatMessage(client, data) {
    if (!client.roomId || !data.text) return;
    const room = this.rooms.get(client.roomId);
    if (!room) return;
    this.broadcastToRoom(room, {
      type: 'chat-msg',
      fromPeerId: client.peerId,
      fromName: client.name,
      slot: client.slot,
      text: String(data.text).slice(0, 240),
      sentAt: new Date().toISOString()
    });
  }

  handleMessage(client, rawText) {
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return;
    }

    const handlers = {
      'create-room': () => this.createRoom(client, data),
      'join-room': () => this.joinRoom(client, data),
      'leave-room': () => this.leaveCurrentRoom(client),
      'direct-invite': () =>
        this.sendDirectInvite(
          { name: client.name, username: client.username },
          { ...data, roomId: client.roomId || data.roomId }
        ),
      'webrtc-signal': () => this.relayWebRtcSignal(client, data),
      'pad-input': () => this.relayPadInput(client, data),
      'chat-msg': () => this.relayChatMessage(client, data),
      'ping-check': () => sendJson(client.ws, { type: 'pong-check', clientTs: data.clientTs, serverTs: Date.now() })
    };

    const handler = handlers[data.type];
    if (handler) handler();
  }

  unregisterClient(client) {
    this.leaveCurrentRoom(client);
    this.clients.delete(client.peerId);
    this.broadcastPresenceState();
  }
}

module.exports = {
  RoomManager,
  DEFAULT_SYSTEM_ROOMS
};
