'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

function normalizeGameKey(info) {
  const raw = info.slug || info.romId || info.gameTitle || 'game';
  return String(raw).trim().toLowerCase();
}

const PLAYTIME_DEFAULTS = {
  slug: null,
  romId: null,
  gameTitle: 'Jogo',
  consoleName: 'Console',
  consoleId: 'snes'
};

function buildInitialPlaytimeRecord(info, nowIso) {
  const merged = { ...PLAYTIME_DEFAULTS, ...info };
  return {
    key: normalizeGameKey(merged),
    slug: merged.slug,
    romId: merged.romId,
    gameTitle: String(merged.gameTitle),
    consoleName: String(merged.consoleName),
    consoleId: String(merged.consoleId),
    totalSeconds: 0,
    sessionsCount: 0,
    lastPlayedAt: nowIso
  };
}

function clampPlaytimeDelta(seconds) {
  const val = Math.round(Number(seconds) || 60);
  return Math.max(1, Math.min(86400, val));
}

function applyPlaytimeIncrement(record, info, nowIso) {
  record.totalSeconds += clampPlaytimeDelta(info.seconds);
  if (info.countSession) {
    record.sessionsCount += 1;
  }
  record.lastPlayedAt = nowIso;
  record.romId = record.romId || info.romId || null;
  record.slug = record.slug || info.slug || null;
}

function matchesDeckGame(game, entry) {
  if (entry.slug && game.slug === entry.slug) return true;
  return game.title === entry.gameTitle;
}

function enrichPlaytimeWithLibraryArt(entry, deckLibrary) {
  const matched = deckLibrary.find((g) => matchesDeckGame(g, entry));
  if (!matched) {
    return { ...entry, boxartUrl: '' };
  }
  return {
    ...entry,
    boxartUrl: matched.boxartUrl,
    romId: entry.romId || matched.id
  };
}

function buildSaveEntryRecord(rom, slotName, sizeBytes) {
  return {
    id: `${rom.id}:${slotName}`,
    romId: rom.id,
    slug: rom.slug || null,
    gameTitle: rom.title,
    consoleName: rom.consoleName,
    consoleId: rom.consoleId,
    boxartUrl: rom.boxartUrl || '',
    slotName,
    sizeBytes: Number(sizeBytes) || 0,
    updatedAt: new Date().toISOString()
  };
}

function buildFallbackSaveFromRom(rom) {
  return {
    id: `${rom.id}:default.srm`,
    romId: rom.id,
    slug: rom.slug || null,
    gameTitle: rom.title,
    consoleName: rom.consoleName,
    consoleId: rom.consoleId,
    boxartUrl: rom.boxartUrl || '',
    slotName: 'default.srm',
    sizeBytes: 32768,
    updatedAt: rom.lastSavedAt || rom.uploadedAt
  };
}

function appendUniqueSaves(targetList, sourceList) {
  if (!Array.isArray(sourceList)) return;
  sourceList.forEach((s) => {
    const exists = targetList.some((u) => u.romId === s.romId && u.slotName === s.slotName);
    if (!exists) targetList.push(s);
  });
}

function sumPlaytimeSeconds(gamesPlayed) {
  return gamesPlayed.reduce((acc, g) => acc + g.totalSeconds, 0);
}

class ProfileManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.profilePath = path.join(dataDir, 'profiles.json');
    this.playtimeByUser = {};
    this.savesByUser = {};
  }

  async init() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await fsp.readFile(this.profilePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.playtimeByUser = parsed.playtimeByUser || {};
      this.savesByUser = parsed.savesByUser || {};
    } catch {
      await this.saveState();
    }
  }

  async saveState() {
    const payload = JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        playtimeByUser: this.playtimeByUser,
        savesByUser: this.savesByUser
      },
      null,
      2
    );
    const tmp = `${this.profilePath}.tmp`;
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, this.profilePath);
  }

  ensureUserPlaytimeMap(userId) {
    const key = String(userId || 'default');
    if (!this.playtimeByUser[key]) {
      this.playtimeByUser[key] = {};
    }
    return this.playtimeByUser[key];
  }

  async recordPlaytime(info) {
    const userMap = this.ensureUserPlaytimeMap(info.userId);
    const key = normalizeGameKey(info);
    const nowIso = new Date().toISOString();
    if (!userMap[key]) {
      userMap[key] = buildInitialPlaytimeRecord(info, nowIso);
    }
    applyPlaytimeIncrement(userMap[key], info, nowIso);
    await this.saveState();
    return userMap[key];
  }

  ensureUserSavesList(userId) {
    const key = String(userId || 'default');
    if (!Array.isArray(this.savesByUser[key])) {
      this.savesByUser[key] = [];
    }
    return this.savesByUser[key];
  }

  async recordSaveFile({ userId, rom, slotName = 'default.srm', sizeBytes = 0 }) {
    const list = this.ensureUserSavesList(userId);
    const entry = buildSaveEntryRecord(rom, slotName, sizeBytes);
    const existingIdx = list.findIndex((s) => s.romId === rom.id && s.slotName === slotName);
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.unshift(entry);
    }
    await this.saveState();
    return entry;
  }

  collectMergedSaves(userId, storage) {
    const merged = [];
    appendUniqueSaves(merged, this.savesByUser[userId]);
    appendUniqueSaves(merged, this.savesByUser.default);

    const diskRomsWithSave = storage
      .listRoms()
      .filter((r) => r.hasSave)
      .map(buildFallbackSaveFromRom);
    appendUniqueSaves(merged, diskRomsWithSave);

    return merged.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  getProfilePayload(user, storage) {
    const userId = user ? user.id : 'default';
    const deckLibrary = storage.listUnifiedDeckLibrary();
    const rawMap = {
      ...(this.playtimeByUser.default || {}),
      ...(this.playtimeByUser[userId] || {})
    };

    const gamesPlayed = Object.values(rawMap)
      .map((entry) => enrichPlaytimeWithLibraryArt(entry, deckLibrary))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);

    const saves = this.collectMergedSaves(userId, storage);

    return {
      user,
      stats: {
        totalPlaytimeSeconds: sumPlaytimeSeconds(gamesPlayed),
        gamesPlayedCount: gamesPlayed.length,
        savesCount: saves.length
      },
      gamesPlayed,
      saves
    };
  }
}

module.exports = {
  ProfileManager
};
