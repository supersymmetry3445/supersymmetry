'use strict';

const crypto = require('node:crypto');

const MAX_PLAYERS_PER_ROOM = 4;

function sendJson(ws, payload) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function serializeRoom(room) {
  return {
    id: room.id,
    name: room.name,
    consoleId: room.consoleId,
    consoleName: room.consoleName,
    romId: room.romId,
    gameTitle: room.gameTitle,
    hostPeerId: room.hostPeerId,
    hostName: room.hostName,
    mode: room.mode || 'wasm-p2p',
    streamUrl: room.streamUrl || null,
    createdAt: room.createdAt,
    players: Array.from(room.players.values()).map((p) => ({
      peerId: p.peerId,
      name: p.name,
      slot: p.slot,
      isHost: p.peerId === room.hostPeerId,
      pingMs: p.pingMs || 0
    }))
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
    activity: 'Explorando Biblioteca',
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
  if (!playerName) return;
  if (client.userId) return;
  client.name = String(playerName).slice(0, 24);
}

function buildRoomRecord(client, roomId, data) {
  const gameTitle = String(data.gameTitle || 'Super Bomberman (4P)').slice(0, 60);
  return {
    id: roomId,
    name: String(data.roomName || `${client.name}'s Arcade`).slice(0, 48),
    consoleId: data.consoleId || 'snes',
    consoleName: data.consoleName || 'SNES',
    romId: data.romId || null,
    gameTitle,
    hostPeerId: client.peerId,
    hostName: client.name,
    mode: data.mode || 'wasm-p2p',
    streamUrl: data.streamUrl || null,
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

class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.clients = new Map();
    this.onGameStarted = options.onGameStarted || null;
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
    for (let slot = 1; slot <= MAX_PLAYERS_PER_ROOM; slot += 1) {
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

  createRoom(client, data) {
    this.leaveCurrentRoom(client);
    const roomId = String(data.roomId || crypto.randomUUID().slice(0, 6)).toUpperCase();
    applyGuestNameIfProvided(client, data.playerName);

    const room = buildRoomRecord(client, roomId, data);
    client.slot = 1;
    client.roomId = roomId;
    client.activity = `Jogando ${room.gameTitle}`;

    this.rooms.set(roomId, room);
    this.notifyGameStarted(client, room);
    sendJson(client.ws, { type: 'room-joined', room: serializeRoom(room), slot: 1, isHost: true });
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

    const assignedSlot = this.findAvailableSlot(room);
    client.slot = assignedSlot;
    client.roomId = room.id;
    client.activity = `Na Sala #${room.id} (${room.gameTitle})`;
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

  closeEntireRoom(room) {
    this.broadcastToRoom(room, {
      type: 'room-closed',
      roomId: room.id,
      reason: 'O Host encerrou a sessão do console.'
    });
    for (const peer of room.players.values()) {
      peer.roomId = null;
      peer.slot = null;
      peer.activity = 'Explorando Biblioteca';
    }
    this.rooms.delete(room.id);
  }

  leaveCurrentRoom(client) {
    if (!client.roomId) return;
    const room = this.rooms.get(client.roomId);
    client.roomId = null;
    client.slot = null;
    client.activity = 'Explorando Biblioteca';
    if (!room) return;

    room.players.delete(client.peerId);
    if (room.players.size === 0 || room.hostPeerId === client.peerId) {
      this.closeEntireRoom(room);
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
  RoomManager
};
