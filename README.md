# 🌌 Supersymmetry — Hybrid Retro Web Console & RTX 3050 Cloud Deck

**Supersymmetry** é uma plataforma híbrida de Console Web Multiplayer desenhada para consumo mínimo na VPS (**~45 MB de RAM** e **~0% de CPU em repouso**) combinada com ativação sob demanda da sua **NVIDIA GeForce RTX 3050 6GB** local via `konsole`.

- **URL Pública:** `https://superssymetry.kalopsia.me`
- **Projeto Coolify Isolado:** `b0ialzsu5xdxdjl3ws7ygbl9` (`Superssymetry` · Ambiente `7ostydtt8zrprbkmwz52wcuj`)
- **Skill do Workspace:** `/superssimetry` (`.agents/skills/superssimetry/SKILL.md`)

---

## 🎮 Arquitetura Híbrida

1. **Web Console 24/7 na VPS (`wasm-p2p`):**
   - Roda **Super Nintendo (`snes9x`)**, **Game Boy Advance (`mgba`)**, **PlayStation 1 (`pcsx_rearmed`)**, **PSP (`ppsspp`)**, **Nintendo 64 (`mupen64plus_next`)** e **Mega Drive (`genesis_plus_gx`)** direto no navegador via WebAssembly (`EmulatorJS`).
   - **Sofá Virtual 4 Controles (WebRTC P2P):** A VPS atua apenas como servidor de sinalização (`WebSocket`). O vídeo a 60 FPS e os comandos dos controles USB/Bluetooth dos amigos trafegam em P2P (`RTCPeerConnection` + `RTCDataChannel`), sem pesar nada na CPU ou RAM da VPS.
   - **Cloud Save & Streaming HTTP 206:** Suporte nativo a streaming parcial de ISOs/CHDs grandes e sincronização de saves (`.srm`) em `/data/saves`.
2. **Nó Híbrido GPU Local via `konsole` (`NVIDIA GeForce RTX 3050 6GB`):**
   - Permanece **100% desligado (0W)** por padrão no seu PC.
   - Para ligar o **PlayStation 2 (`PCSX2` — Bomba Patch)** acelerado por **NVENC + Vulkan** e liberar a transmissão em `https://superssymetry.kalopsia.me`:
     ```bash
     ./bin/supersymmetry-gpu start
     ```
   - Para desligar quando terminar de jogar:
     ```bash
     ./bin/supersymmetry-gpu stop
     ```
