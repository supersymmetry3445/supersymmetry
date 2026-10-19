'use strict';

const PLATFORMS = {
  snes: {
    consoleId: 'snes',
    consoleName: 'Super Nintendo',
    core: 'snes9x',
    ext: '.zip',
    archiveBase:
      'https://archive.org/download/No-Intro_SNES_Collection/mnt/user/ROMS/Nintendo/SNES_2/SNES.zip/SNES%2F',
    boxartBase:
      'https://thumbnails.libretro.com/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/',
    snapBase:
      'https://thumbnails.libretro.com/Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Snaps/'
  },
  gba: {
    consoleId: 'gba',
    consoleName: 'Game Boy Advance',
    core: 'mgba',
    ext: '.zip',
    archiveBase:
      'https://archive.org/download/No-Intro_GameBoy_Advance_Collection/mnt/user/ROMS/Nintendo/GBA_2/GBA.zip/GBA%2F',
    boxartBase:
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy%20Advance/Named_Boxarts/',
    snapBase:
      'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy%20Advance/Named_Snaps/'
  },
  segaMD: {
    consoleId: 'segaMD',
    consoleName: 'Mega Drive',
    core: 'genesis_plus_gx',
    ext: '.7z',
    archiveBase: 'https://archive.org/download/nointro.md/',
    boxartBase:
      'https://thumbnails.libretro.com/Sega%20-%20Mega%20Drive%20-%20Genesis/Named_Boxarts/',
    snapBase:
      'https://thumbnails.libretro.com/Sega%20-%20Mega%20Drive%20-%20Genesis/Named_Snaps/'
  }
};

function createCatalogItem(platformKey, spec) {
  const platform = PLATFORMS[platformKey];
  const encoded = encodeURIComponent(spec.noIntroName);
  return {
    slug: spec.slug,
    title: spec.title,
    consoleId: platform.consoleId,
    consoleName: platform.consoleName,
    core: platform.core,
    maxPlayers: spec.players,
    category: spec.category,
    genre: spec.genre,
    filename: `${spec.noIntroName}${platform.ext}`,
    archiveUrl: `${platform.archiveBase}${encoded}${platform.ext}`,
    boxartUrl: `${platform.boxartBase}${encoded}.png`,
    snapUrl: `${platform.snapBase}${encoded}.png`,
    verifiedSource: 'No-Intro Verified'
  };
}

const VERIFIED_CATALOG = [
  createCatalogItem('snes', {
    slug: 'super-bomberman-4',
    title: 'Super Bomberman 4',
    noIntroName: 'Super Bomberman 4 (Japan)',
    players: 4,
    category: 'multiplayer',
    genre: 'Party / Battle 4 Jogadores'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-5',
    title: 'Super Bomberman 5',
    noIntroName: 'Super Bomberman 5 (Japan)',
    players: 4,
    category: 'multiplayer',
    genre: 'Party / Battle 5 Jogadores'
  }),
  createCatalogItem('snes', {
    slug: 'iss-deluxe',
    title: 'International Superstar Soccer Deluxe',
    noIntroName: 'International Superstar Soccer Deluxe (USA)',
    players: 4,
    category: 'multiplayer',
    genre: 'Futebol Clássico'
  }),
  createCatalogItem('snes', {
    slug: 'super-mario-kart',
    title: 'Super Mario Kart',
    noIntroName: 'Super Mario Kart (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Corrida / Battle Mode'
  }),
  createCatalogItem('snes', {
    slug: 'top-gear',
    title: 'Top Gear',
    noIntroName: 'Top Gear (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Corrida Split-Screen'
  }),
  createCatalogItem('snes', {
    slug: 'top-gear-2',
    title: 'Top Gear 2',
    noIntroName: 'Top Gear 2 (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Corrida Split-Screen'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-3',
    title: 'Super Bomberman 3',
    noIntroName: 'Super Bomberman 3 (Europe)',
    players: 4,
    category: 'multiplayer',
    genre: 'Party / Battle 4 Jogadores'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-2',
    title: 'Super Bomberman 2',
    noIntroName: 'Super Bomberman 2 (USA)',
    players: 4,
    category: 'multiplayer',
    genre: 'Party / Battle 4 Jogadores'
  }),
  createCatalogItem('snes', {
    slug: 'sunset-riders',
    title: 'Sunset Riders',
    noIntroName: 'Sunset Riders (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Ação Co-op Arcade'
  }),
  createCatalogItem('snes', {
    slug: 'street-fighter-ii-turbo',
    title: 'Street Fighter II Turbo',
    noIntroName: 'Street Fighter II Turbo (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Luta Versus'
  }),
  createCatalogItem('snes', {
    slug: 'umk3-snes',
    title: 'Ultimate Mortal Kombat 3',
    noIntroName: 'Ultimate Mortal Kombat 3 (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Luta Versus'
  }),
  createCatalogItem('snes', {
    slug: 'super-mario-world',
    title: 'Super Mario World',
    noIntroName: 'Super Mario World (USA)',
    players: 2,
    category: 'adventure',
    genre: 'Plataforma Clássico'
  }),
  createCatalogItem('snes', {
    slug: 'donkey-kong-country',
    title: 'Donkey Kong Country',
    noIntroName: 'Donkey Kong Country (USA)',
    players: 2,
    category: 'adventure',
    genre: 'Plataforma Co-op'
  }),
  createCatalogItem('gba', {
    slug: 'pokemon-emerald',
    title: 'Pokémon Emerald Version',
    noIntroName: 'Pokemon - Emerald Version (USA, Europe)',
    players: 1,
    category: 'adventure',
    genre: 'RPG / Aventura'
  }),
  createCatalogItem('gba', {
    slug: 'pokemon-firered',
    title: 'Pokémon FireRed Version',
    noIntroName: 'Pokemon - FireRed Version (USA, Europe)',
    players: 1,
    category: 'adventure',
    genre: 'RPG / Aventura'
  }),
  createCatalogItem('gba', {
    slug: 'mario-kart-super-circuit',
    title: 'Mario Kart: Super Circuit',
    noIntroName: 'Mario Kart - Super Circuit (USA)',
    players: 4,
    category: 'multiplayer',
    genre: 'Corrida GBA'
  }),
  createCatalogItem('gba', {
    slug: 'zelda-minish-cap',
    title: 'The Legend of Zelda: The Minish Cap',
    noIntroName: 'Legend of Zelda, The - The Minish Cap (USA)',
    players: 1,
    category: 'adventure',
    genre: 'Ação / Aventura'
  }),
  createCatalogItem('gba', {
    slug: 'metroid-zero-mission',
    title: 'Metroid: Zero Mission',
    noIntroName: 'Metroid - Zero Mission (USA)',
    players: 1,
    category: 'adventure',
    genre: 'Ação Sci-Fi'
  }),
  createCatalogItem('gba', {
    slug: 'metal-slug-advance',
    title: 'Metal Slug Advance',
    noIntroName: 'Metal Slug Advance (USA)',
    players: 1,
    category: 'adventure',
    genre: 'Run & Gun Arcade'
  }),
  createCatalogItem('gba', {
    slug: 'sonic-advance',
    title: 'Sonic Advance',
    noIntroName: 'Sonic Advance (USA) (En,Ja)',
    players: 2,
    category: 'adventure',
    genre: 'Plataforma Alta Velocidade'
  }),
  createCatalogItem('gba', {
    slug: 'db-advanced-adventure',
    title: 'Dragon Ball: Advanced Adventure',
    noIntroName: 'Dragon Ball - Advanced Adventure (USA)',
    players: 2,
    category: 'adventure',
    genre: 'Ação / Beat-em-up'
  }),
  createCatalogItem('segaMD', {
    slug: 'mega-bomberman',
    title: 'Mega Bomberman',
    noIntroName: 'Mega Bomberman (USA)',
    players: 4,
    category: 'multiplayer',
    genre: 'Party / Battle 4 Jogadores'
  }),
  createCatalogItem('segaMD', {
    slug: 'streets-of-rage-2',
    title: 'Streets of Rage 2',
    noIntroName: 'Streets of Rage 2 (USA)',
    players: 2,
    category: 'multiplayer',
    genre: 'Beat-em-up Co-op'
  }),
  createCatalogItem('segaMD', {
    slug: 'sonic-3',
    title: 'Sonic The Hedgehog 3',
    noIntroName: 'Sonic The Hedgehog 3 (USA)',
    players: 2,
    category: 'adventure',
    genre: 'Plataforma Clássico'
  })
];

function getVerifiedBySlug(slug) {
  return VERIFIED_CATALOG.find((item) => item.slug === slug) || null;
}

module.exports = {
  VERIFIED_CATALOG,
  getVerifiedBySlug
};
