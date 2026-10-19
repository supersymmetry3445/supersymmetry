'use strict';

const HEARTBEAT_TTL_MS = 45000;
const DEFAULT_TOKEN = 'supersymmetry-rtx3050-local-key';

class GpuNodeBridge {
  constructor(expectedToken, onStateChange) {
    this.expectedToken = expectedToken || process.env.GPU_NODE_TOKEN || DEFAULT_TOKEN;
    this.onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
    this.nodeState = {
      online: false,
      gpuModel: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
      encoder: 'NVENC H.264 / HEVC Zero-Copy + Vulkan',
      vramTotalMiB: 6144,
      vramUsedMiB: 0,
      temperatureC: 0,
      utilizationPct: 0,
      powerDrawW: 0,
      streamUrl: null,
      activeGame: null,
      hostMachine: null,
      lastHeartbeatAt: null
    };
  }

  verifyToken(providedToken) {
    if (!providedToken) {
      return false;
    }
    return String(providedToken).trim() === this.expectedToken;
  }

  registerHeartbeat(payload) {
    const wasOnline = this.nodeState.online;
    this.nodeState = {
      online: true,
      gpuModel: payload.gpuModel || 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
      encoder: payload.encoder || 'NVENC H.264 / HEVC Zero-Copy + Vulkan',
      vramTotalMiB: Number(payload.vramTotalMiB) || 6144,
      vramUsedMiB: Number(payload.vramUsedMiB) || 0,
      temperatureC: Number(payload.temperatureC) || 0,
      utilizationPct: Number(payload.utilizationPct) || 0,
      powerDrawW: Number(payload.powerDrawW) || 0,
      streamUrl: payload.streamUrl || null,
      activeGame: payload.activeGame || 'PCSX2 · PlayStation 2 (Sofá 4 Controles)',
      hostMachine: payload.hostMachine || 'linux-rtx3050',
      lastHeartbeatAt: new Date().toISOString()
    };

    if (!wasOnline || payload.notify) {
      this.onStateChange(this.getStatus());
    } else {
      this.onStateChange(this.getStatus());
    }
    return this.getStatus();
  }

  markOffline() {
    this.nodeState.online = false;
    this.nodeState.vramUsedMiB = 0;
    this.nodeState.utilizationPct = 0;
    this.nodeState.powerDrawW = 0;
    this.nodeState.streamUrl = null;
    this.nodeState.activeGame = null;
    this.onStateChange(this.getStatus());
    return this.getStatus();
  }

  getStatus() {
    if (this.nodeState.online && this.nodeState.lastHeartbeatAt) {
      const elapsed = Date.now() - new Date(this.nodeState.lastHeartbeatAt).getTime();
      if (elapsed > HEARTBEAT_TTL_MS) {
        this.nodeState.online = false;
        this.nodeState.streamUrl = null;
      }
    }
    return {
      ...this.nodeState,
      konsoleCommand: './bin/supersymmetry-gpu start',
      stopCommand: './bin/supersymmetry-gpu stop'
    };
  }
}

module.exports = {
  GpuNodeBridge,
  DEFAULT_TOKEN
};
