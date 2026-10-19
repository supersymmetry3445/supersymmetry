---
name: superssimetry
description: Orquestrador Mestre Fullstack, Infraestrutura e Deploy do projeto Supersymmetry (Console Web Retrô & Híbrido RTX 3050). Totalmente isolado no projeto Coolify b0ialzsu5xdxdjl3ws7ygbl9 (superssymetry.kalopsia.me).
---

# 🌌 `/superssimetry` — Orquestrador Mestre do Projeto Supersymmetry

Você ativou o modo **`/superssimetry`**, a inteligência central do repositório **Supersymmetry** (`/home/kalopsia/Documentos/Kalopsia/Supersymmetry`).

> [!IMPORTANT]
> **ISOLAMENTO ESTRITO DE PROJETO:**
> O **Supersymmetry** é um ecossistema 100% independente e isolado de qualquer outro projeto que rode na mesma VPS.
> - **Domínio Público:** `https://superssymetry.kalopsia.me`
> - **Coolify Project UUID:** `b0ialzsu5xdxdjl3ws7ygbl9` (`Superssymetry`)
> - **Coolify Environment UUID:** `7ostydtt8zrprbkmwz52wcuj` (`production`)
> - **Coolify Server UUID:** `sfgh0o8rgftpkamtisb39uy4`
> - **Painel Coolify do Projeto:** `http://100.65.233.79:8000/project/b0ialzsu5xdxdjl3ws7ygbl9/environment/7ostydtt8zrprbkmwz52wcuj`
> - **NUNCA** altere, consulte ou misture recursos, variáveis ou bancos de dados de outros projetos do Coolify. Toda operação de deploy e monitoramento deve filtrar exclusivamente por `project_uuid: "b0ialzsu5xdxdjl3ws7ygbl9"`.

---

## 🏗️ 1. Arquitetura Híbrida & Doutrina de Consumo Zero na VPS

O **Supersymmetry** foi desenhado especificamente para coexistir na VPS consumindo **menos de 60 MB de RAM e ~0% de CPU em repouso**, sem bancos de dados pesados (sem Postgres/MySQL/Redis extras):

1. **Camada 1 — Web Console & Hub P2P 24/7 (VPS / Coolify `b0ialzsu5xdxdjl3ws7ygbl9`):**
   - **Stack:** Node.js 22 Alpine ultra-leve (`src/server.js`, `src/storage.js`, `src/rooms.js`, `src/gpu-bridge.js`) com persistência atômica em disco (`/data/roms`, `/data/saves`, `/data/states`, `/data/catalog.json`).
   - **Emulação Client-Side (WASM):** Super Nintendo (`snes9x`), Game Boy Advance (`mgba`), PlayStation 1 (`pcsx_rearmed`), PSP (`ppsspp`), Nintendo 64 (`mupen64plus_next`) e Mega Drive (`genesis_plus_gx`) rodam via **EmulatorJS (WebAssembly)** diretamente no navegador dos jogadores.
   - **Multiplayer "Sofá Virtual" WebRTC P2P:** O servidor na VPS atua apenas como **Signaling Server (WebSocket)** de baixíssimo custo (< 5 KB/s). O Host da sala captura o canvas/áudio a 60 FPS via `captureStream(60)` e transmite em P2P (`RTCPeerConnection`) para os amigos (Controles 2, 3 e 4), recebendo os comandos do `Gamepad API` / teclado via `RTCDataChannel` (`ordered: false, maxRetransmits: 0`) com latência de 15–30 ms.
2. **Camada 2 — Nó GPU Local Sob Demanda via `konsole` (`NVIDIA GeForce RTX 3050 6GB`):**
   - Permanece **100% desligado** por padrão na máquina local do usuário.
   - Quando ativado no `konsole` via `./bin/supersymmetry-gpu start`:
     - Inicia o container local acelerado por hardware (`--gpus all`, Vulkan + NVENC Zero-Copy) para rodar **PlayStation 2 (`PCSX2` — Bomba Patch)** e jogos pesados.
     - Abre um túnel HTTPS/WSS seguro e envia batimentos cardíacos (heartbeats) assinados com `GPU_NODE_TOKEN` para `https://superssymetry.kalopsia.me/api/gpu/heartbeat`.
     - O painel web em `https://superssymetry.kalopsia.me` muda instantaneamente o status da GPU para **ONLINE** e libera a entrada dos amigos na transmissão da RTX 3050.

---

## 🛡️ 2. Regras Inegociáveis de Engenharia (Zero Gambiarra & CodeScene >= 9.5)

1. **Zero Mock / Zero Placeholder:** Nenhuma funcionalidade pode ser simulada. Uploads de ROMs salvam arquivos reais com hash SHA-1 e suporte a `HTTP 206 Partial Content`; salas multiplayer usam WebSockets e WebRTC reais; saves sincronizam arquivos `.srm`/`.state` reais no volume persistente `/data`.
2. **Qualidade de Código (CodeScene MCP):**
   - Todo módulo criado ou modificado em `src/` ou `public/` deve ser validado com `code_health_score` e `pre_commit_code_health_safeguard`.
   - Funções devem ser coesas, sem aninhamento profundo (máximo 2-3 níveis) e com responsabilidades únicas.
3. **Orçamento Estrito de Recursos no Container:**
   - O container de produção no Coolify opera com limite de memória enxuto (`256M`), imagem base `node:22-alpine` e dependências mínimas (`ws` apenas). Nunca adicione frameworks inchados ou ORMs pesados.

---

## 🚀 3. Fluxo Operacional e Deploy Contínuo (`/superssimetry`)

Sempre que o usuário solicitar uma evolução, correção ou deploy no projeto **Supersymmetry**, execute o ciclo completo:

1. **Desenvolvimento & Validação Local:**
   - Edite os módulos necessários em `/home/kalopsia/Documentos/Kalopsia/Supersymmetry`.
   - Execute `npm test` para validar a suíte de testes automatizados (API de catálogo, upload/range de ROMs, salas WebSocket e ponte da GPU RTX 3050).
   - Passe o `pre_commit_code_health_safeguard` do MCP `codescene`.
2. **Versionamento Git:**
   - Faça commit semântico (`feat:`, `fix:`, `perf:`, `chore:`) e `git push origin main`.
3. **Deploy Isolado no Coolify (`b0ialzsu5xdxdjl3ws7ygbl9`):**
   - Utilize o MCP `coolify-hyrule` (`deploy` ou `get_application` filtrando apenas a aplicação do projeto `b0ialzsu5xdxdjl3ws7ygbl9`).
   - Acompanhe o status do deployment (`get_deployment`) e valide o healthcheck ao vivo via `curl -s https://superssymetry.kalopsia.me/api/health`.
4. **Comandos Locais da RTX 3050 (`konsole`):**
   - Para ligar o servidor de PS2 na RTX 3050 local: `./bin/supersymmetry-gpu start`
   - Para ver telemetria da GPU e do túnel: `./bin/supersymmetry-gpu status`
   - Para desligar a GPU e liberar 100% da placa local: `./bin/supersymmetry-gpu stop`
