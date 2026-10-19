'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { detectConsoleByFilename } = require('./consoles');

function sanitizeFilename(rawName) {
  const base = path.basename(String(rawName || 'game.rom'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function deriveTitleFromFilename(filename) {
  const ext = path.extname(filename);
  const raw = path.basename(filename, ext);
  return raw.replace(/[_-]+/g, ' ').trim() || 'Unknown ROM';
}

function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return null;
  }
  const [startStr, endStr] = rangeHeader.replace('bytes=', '').split('-');
  const start = Number.parseInt(startStr, 10);
  const end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end >= totalSize || start > end) {
    return null;
  }
  return { start, end, chunkSize: end - start + 1 };
}

class StorageManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.romsDir = path.join(dataDir, 'roms');
    this.savesDir = path.join(dataDir, 'saves');
    this.statesDir = path.join(dataDir, 'states');
    this.biosDir = path.join(dataDir, 'bios');
    this.catalogPath = path.join(dataDir, 'catalog.json');
    this.roms = [];
  }

  async init() {
    await Promise.all([
      fsp.mkdir(this.romsDir, { recursive: true }),
      fsp.mkdir(this.savesDir, { recursive: true }),
      fsp.mkdir(this.statesDir, { recursive: true }),
      fsp.mkdir(this.biosDir, { recursive: true })
    ]);
    await this.loadCatalog();
  }

  async loadCatalog() {
    try {
      const raw = await fsp.readFile(this.catalogPath, 'utf8');
      const parsed = JSON.parse(raw);
      this.roms = Array.isArray(parsed.roms) ? parsed.roms : [];
    } catch {
      this.roms = [];
      await this.saveCatalog();
    }
  }

  async saveCatalog() {
    const payload = JSON.stringify({ updatedAt: new Date().toISOString(), roms: this.roms }, null, 2);
    const tmpPath = `${this.catalogPath}.tmp`;
    await fsp.writeFile(tmpPath, payload, 'utf8');
    await fsp.rename(tmpPath, this.catalogPath);
  }

  listRoms(consoleFilter) {
    if (!consoleFilter || consoleFilter === 'all') {
      return this.roms;
    }
    return this.roms.filter((rom) => rom.consoleId === consoleFilter);
  }

  getRomById(romId) {
    return this.roms.find((rom) => rom.id === romId) || null;
  }

  async saveUploadedRom(stream, metadata) {
    const safeFilename = sanitizeFilename(metadata.filename);
    const consoleDef = detectConsoleByFilename(safeFilename, metadata.consoleId);
    const romId = crypto.randomUUID();
    const storedFileName = `${romId}_${safeFilename}`;
    const targetPath = path.join(this.romsDir, storedFileName);

    const { sizeBytes, sha1 } = await this.writeStreamWithHash(stream, targetPath);
    if (sizeBytes === 0) {
      await fsp.rm(targetPath, { force: true });
      throw new Error('Uploaded ROM file is empty');
    }

    const existing = this.roms.find((item) => item.sha1 === sha1 && item.consoleId === consoleDef.id);
    if (existing) {
      await fsp.rm(targetPath, { force: true });
      return existing;
    }

    const entry = {
      id: romId,
      title: metadata.title ? String(metadata.title).trim() : deriveTitleFromFilename(safeFilename),
      filename: safeFilename,
      storedFileName,
      consoleId: consoleDef.id,
      consoleName: consoleDef.shortName,
      core: consoleDef.core,
      mode: consoleDef.mode,
      maxPlayers: consoleDef.maxPlayers,
      sizeBytes,
      sha1,
      hasSave: false,
      uploadedAt: new Date().toISOString()
    };

    this.roms.unshift(entry);
    await this.saveCatalog();
    return entry;
  }

  writeStreamWithHash(inputStream, targetPath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
      const fileOut = fs.createWriteStream(targetPath);
      let sizeBytes = 0;

      inputStream.on('data', (chunk) => {
        sizeBytes += chunk.length;
        hash.update(chunk);
      });
      inputStream.on('error', reject);
      fileOut.on('error', reject);
      fileOut.on('finish', () => {
        resolve({ sizeBytes, sha1: hash.digest('hex') });
      });
      inputStream.pipe(fileOut);
    });
  }

  async deleteRom(romId) {
    const idx = this.roms.findIndex((rom) => rom.id === romId);
    if (idx === -1) {
      return false;
    }
    const [removed] = this.roms.splice(idx, 1);
    const romPath = path.join(this.romsDir, removed.storedFileName);
    await fsp.rm(romPath, { force: true });
    await this.saveCatalog();
    return true;
  }

  streamRomFile(rom, req, res) {
    const filePath = path.join(this.romsDir, rom.storedFileName);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ROM file not found on disk' }));
      return;
    }

    const stat = fs.statSync(filePath);
    const range = parseByteRange(req.headers.range, stat.size);

    if (range) {
      res.writeHead(206, {
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': range.chunkSize,
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600'
      });
      fs.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${rom.filename}"`,
      'Cache-Control': 'public, max-age=3600'
    });
    fs.createReadStream(filePath).pipe(res);
  }

  async saveBatteryOrState(romId, slotName, buffer) {
    const rom = this.getRomById(romId);
    if (!rom) {
      return null;
    }
    const safeSlot = sanitizeFilename(slotName || 'default.srm');
    const saveFile = path.join(this.savesDir, `${romId}_${safeSlot}`);
    await fsp.writeFile(saveFile, buffer);
    rom.hasSave = true;
    rom.lastSavedAt = new Date().toISOString();
    await this.saveCatalog();
    return { romId, slot: safeSlot, bytes: buffer.length, savedAt: rom.lastSavedAt };
  }

  async readBatteryOrState(romId, slotName) {
    const safeSlot = sanitizeFilename(slotName || 'default.srm');
    const saveFile = path.join(this.savesDir, `${romId}_${safeSlot}`);
    try {
      return await fsp.readFile(saveFile);
    } catch {
      return null;
    }
  }
}

module.exports = {
  StorageManager,
  sanitizeFilename,
  parseByteRange
};
