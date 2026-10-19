'use strict';

const CONSOLES = [
  {
    id: 'snes',
    name: 'Super Nintendo (SNES)',
    shortName: 'SNES',
    core: 'snes9x',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: true,
    extensions: ['.sfc', '.smc', '.fig', '.swc'],
    accent: '#8b5cf6',
    featuredExamples: ['Super Bomberman 4 (4 Players)', 'International Superstar Soccer Deluxe', 'Super Mario Kart', 'Top Gear 2'],
    description: 'Emulação WebAssembly (snes9x) com suporte a Multitap (até 4 jogadores no sofá virtual via WebRTC P2P).'
  },
  {
    id: 'gba',
    name: 'Game Boy Advance',
    shortName: 'GBA',
    core: 'mgba',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: false,
    extensions: ['.gba', '.agb', '.gb', '.gbc'],
    accent: '#06b6d4',
    featuredExamples: ['Pokémon Emerald / FireRed', 'Mario Kart: Super Circuit', 'The Legend of Zelda: The Minish Cap', 'Sonic Advance'],
    description: 'Núcleo mGBA em WebAssembly com sincronização automática de Battery Save (.srm) no servidor.'
  },
  {
    id: 'psx',
    name: 'PlayStation 1 (PSX)',
    shortName: 'PS1',
    core: 'pcsx_rearmed',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: true,
    extensions: ['.bin', '.cue', '.chd', '.pbp', '.img', '.mdf'],
    accent: '#3b82f6',
    featuredExamples: ['Winning Eleven 2002 / Bomba Patch PS1', 'Crash Team Racing (4P)', 'Tekken 3', 'Bomberman Party Edition'],
    description: 'Núcleo PCSX-ReARMed com streaming HTTP 206 Partial Content e suporte a 4 controles via WebRTC.'
  },
  {
    id: 'psp',
    name: 'PlayStation Portable (PSP)',
    shortName: 'PSP',
    core: 'ppsspp',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: false,
    extensions: ['.cso', '.prx', '.elf'],
    accent: '#ec4899',
    featuredExamples: ['Bomba Patch PSP / PES', 'Dragon Ball Z: Shin Budokai', 'God of War: Chains of Olympus', 'Tekken 6'],
    description: 'Núcleo PPSSPP WebAssembly com aceleração WebGL2 para clássicos de futebol e luta.'
  },
  {
    id: 'ps2',
    name: 'PlayStation 2 (RTX 3050 Hybrid)',
    shortName: 'PS2 · RTX 3050',
    core: 'pcsx2-nvenc',
    mode: 'gpu-node',
    maxPlayers: 4,
    multitap: true,
    extensions: ['.iso', '.gz'],
    accent: '#10b981',
    featuredExamples: ['Bomba Patch 100% Atualizado (PS2)', 'PES 2014 / Winning Eleven 10', 'Guitar Hero III', 'Mortal Kombat: Shaolin Monks (Co-op)'],
    description: 'Execução Híbrida sob demanda na sua NVIDIA GeForce RTX 3050 (Vulkan + NVENC) ativada pelo konsole.'
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    shortName: 'N64',
    core: 'mupen64plus_next',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: false,
    extensions: ['.z64', '.n64', '.v64'],
    accent: '#f59e0b',
    featuredExamples: ['Mario Kart 64 (4P)', 'Super Smash Bros.', '007 GoldenEye', 'Mario Party 3'],
    description: 'Núcleo Mupen64Plus-Next nativo para 4 controles simultâneos.'
  },
  {
    id: 'segaMD',
    name: 'Mega Drive / Genesis',
    shortName: 'Mega Drive',
    core: 'genesis_plus_gx',
    mode: 'wasm-p2p',
    maxPlayers: 4,
    multitap: true,
    extensions: ['.md', '.gen', '.smd'],
    accent: '#ef4444',
    featuredExamples: ['Mega Bomberman (4P)', 'Streets of Rage 2 (Co-op)', 'Sonic the Hedgehog 3', 'Ultimate Mortal Kombat 3'],
    description: 'Núcleo Genesis Plus GX com suporte a 4-Way Play / Team Player.'
  }
];

const CONSOLE_BY_ID = new Map(CONSOLES.map((item) => [item.id, item]));

function detectConsoleByFilename(filename, explicitConsoleId) {
  if (explicitConsoleId && CONSOLE_BY_ID.has(explicitConsoleId)) {
    return CONSOLE_BY_ID.get(explicitConsoleId);
  }
  const lower = String(filename || '').toLowerCase();
  for (const consoleDef of CONSOLES) {
    if (consoleDef.extensions.some((ext) => lower.endsWith(ext))) {
      return consoleDef;
    }
  }
  if (lower.endsWith('.zip') || lower.endsWith('.7z')) {
    return CONSOLE_BY_ID.get('snes');
  }
  return CONSOLE_BY_ID.get('snes');
}

function getConsoleById(id) {
  return CONSOLE_BY_ID.get(id) || null;
}

module.exports = {
  CONSOLES,
  detectConsoleByFilename,
  getConsoleById
};
