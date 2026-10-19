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
    year: spec.year || '1995',
    accent: spec.accent || '#e50914',
    synopsis:
      spec.synopsis ||
      'Clássico preservado com suporte instantâneo a controles Bluetooth, USB, celular via QR Code e salas multiplayer P2P.',
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
    year: '1996',
    accent: '#ef4444',
    category: 'multiplayer',
    genre: 'Party · Arena 4 Jogadores',
    synopsis:
      'Monte montarias especiais, lance bombas através da arena e dispute partidas explosivas para até 4 amigos simultâneos.'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-5',
    title: 'Super Bomberman 5',
    noIntroName: 'Super Bomberman 5 (Japan)',
    players: 4,
    year: '1997',
    accent: '#f97316',
    category: 'multiplayer',
    genre: 'Party · Edição Comemorativa',
    synopsis:
      'O capítulo definitivo da era 16-bits com fases não-lineares e arenas clássicas reunidas para batalhas multiplayer.'
  }),
  createCatalogItem('snes', {
    slug: 'iss-deluxe',
    title: 'International Superstar Soccer Deluxe',
    noIntroName: 'International Superstar Soccer Deluxe (USA)',
    players: 4,
    year: '1995',
    accent: '#10b981',
    category: 'multiplayer',
    genre: 'Esporte · Futebol Clássico',
    synopsis:
      'Narração icônica, 36 seleções mundiais e partidas eletrizantes de 2 a 4 jogadores com controles rápidos e precisos.'
  }),
  createCatalogItem('snes', {
    slug: 'super-mario-kart',
    title: 'Super Mario Kart',
    noIntroName: 'Super Mario Kart (USA)',
    players: 2,
    year: '1992',
    accent: '#ef4444',
    category: 'multiplayer',
    genre: 'Corrida · Battle Mode',
    synopsis:
      'Derrape em Mode 7 pelas copas clássicas da Nintendo ou estoure os balões do adversário no lendário Battle Mode.'
  }),
  createCatalogItem('snes', {
    slug: 'top-gear',
    title: 'Top Gear',
    noIntroName: 'Top Gear (USA)',
    players: 2,
    year: '1992',
    accent: '#3b82f6',
    category: 'multiplayer',
    genre: 'Corrida · Split-Screen',
    synopsis:
      'Trilha sonora inesquecível de Barry Leitch, corridas noturnas sob neblina e disputas de tela dividida em alta velocidade.'
  }),
  createCatalogItem('snes', {
    slug: 'top-gear-2',
    title: 'Top Gear 2',
    noIntroName: 'Top Gear 2 (USA)',
    players: 2,
    year: '1993',
    accent: '#6366f1',
    category: 'multiplayer',
    genre: 'Corrida · Upgrade & Clima',
    synopsis:
      'Evolua motor, câmbio e pneus através de 64 pistas ao redor do mundo com clima dinâmico e modo cooperativo.'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-3',
    title: 'Super Bomberman 3',
    noIntroName: 'Super Bomberman 3 (Europe)',
    players: 4,
    year: '1995',
    accent: '#f59e0b',
    category: 'multiplayer',
    genre: 'Party · Louies & Arena',
    synopsis:
      'A estreia dos cangurus Louie com habilidades únicas em arenas temáticas para até 4 jogadores.'
  }),
  createCatalogItem('snes', {
    slug: 'super-bomberman-2',
    title: 'Super Bomberman 2',
    noIntroName: 'Super Bomberman 2 (USA)',
    players: 4,
    year: '1994',
    accent: '#ec4899',
    category: 'multiplayer',
    genre: 'Party · Batalha Clássica',
    synopsis:
      'Arenas táticas com esteiras, teletransportes e morte súbita para disputas intensas entre amigos.'
  }),
  createCatalogItem('snes', {
    slug: 'sunset-riders',
    title: 'Sunset Riders',
    noIntroName: 'Sunset Riders (USA)',
    players: 2,
    year: '1993',
    accent: '#d97706',
    category: 'multiplayer',
    genre: 'Arcade · Ação Co-op',
    synopsis:
      'Escolha entre Steve, Billy, Bob e Cormano neste clássico arcade de faroeste da Konami com ação cooperativa.'
  }),
  createCatalogItem('snes', {
    slug: 'street-fighter-ii-turbo',
    title: 'Street Fighter II Turbo',
    noIntroName: 'Street Fighter II Turbo (USA)',
    players: 2,
    year: '1993',
    accent: '#dc2626',
    category: 'multiplayer',
    genre: 'Luta · Arcade Versus',
    synopsis:
      'Velocidade ajustável, golpes especiais inéditos e os quatro chefes da Shadaloo liberados para duelos 1 contra 1.'
  }),
  createCatalogItem('snes', {
    slug: 'umk3-snes',
    title: 'Ultimate Mortal Kombat 3',
    noIntroName: 'Ultimate Mortal Kombat 3 (USA)',
    players: 2,
    year: '1996',
    accent: '#b91c1c',
    category: 'multiplayer',
    genre: 'Luta · Torneio Versus',
    synopsis:
      'Combos encadeados, elenco expandido com Scorpion, Kitana e Reptile e modos de torneio para até 8 lutadores.'
  }),
  createCatalogItem('snes', {
    slug: 'super-mario-world',
    title: 'Super Mario World',
    noIntroName: 'Super Mario World (USA)',
    players: 2,
    year: '1990',
    accent: '#22c55e',
    category: 'adventure',
    genre: 'Plataforma · Obra-Prima 16-Bit',
    synopsis:
      'Explore Dinosaur Land com Yoshi, descubra 96 saídas secretas e alterne turnos em dupla pela Star Road.'
  }),
  createCatalogItem('snes', {
    slug: 'donkey-kong-country',
    title: 'Donkey Kong Country',
    noIntroName: 'Donkey Kong Country (USA)',
    players: 2,
    year: '1994',
    accent: '#eab308',
    category: 'adventure',
    genre: 'Plataforma · Co-op Dupla',
    synopsis:
      'Visuais pré-renderizados revolucionários e trilha atmosférica de David Wise com campanha para dois jogadores.'
  }),
  createCatalogItem('gba', {
    slug: 'pokemon-emerald',
    title: 'Pokémon Emerald Version',
    noIntroName: 'Pokemon - Emerald Version (USA, Europe)',
    players: 1,
    year: '2005',
    accent: '#10b981',
    category: 'adventure',
    genre: 'RPG · Edição Definitiva Hoenn',
    synopsis:
      'Enfrente Kyogre, Groudon e Rayquaza e desafie a lendária Battle Frontier na versão mais completa da 3ª geração.'
  }),
  createCatalogItem('gba', {
    slug: 'pokemon-firered',
    title: 'Pokémon FireRed Version',
    noIntroName: 'Pokemon - FireRed Version (USA, Europe)',
    players: 1,
    year: '2004',
    accent: '#f97316',
    category: 'adventure',
    genre: 'RPG · Clássico Kanto',
    synopsis:
      'A jornada original por Kanto recriada em cores vibrantes com as Sevii Islands e pós-jogo expandido.'
  }),
  createCatalogItem('gba', {
    slug: 'mario-kart-super-circuit',
    title: 'Mario Kart: Super Circuit',
    noIntroName: 'Mario Kart - Super Circuit (USA)',
    players: 4,
    year: '2001',
    accent: '#ef4444',
    category: 'multiplayer',
    genre: 'Corrida · 40 Pistas',
    synopsis:
      '20 circuitos inéditos mais todas as 20 pistas originais do Super Nintendo desbloqueáveis em um só cartucho.'
  }),
  createCatalogItem('gba', {
    slug: 'zelda-minish-cap',
    title: 'The Legend of Zelda: The Minish Cap',
    noIntroName: 'Legend of Zelda, The - The Minish Cap (USA)',
    players: 1,
    year: '2004',
    accent: '#16a34a',
    category: 'adventure',
    genre: 'Aventura · Mundo em Miniatura',
    synopsis:
      'Com a ajuda do chapéu falante Ezlo, encolha até o tamanho dos Picori e desvende masmorras engenhosas em Hyrule.'
  }),
  createCatalogItem('gba', {
    slug: 'metroid-zero-mission',
    title: 'Metroid: Zero Mission',
    noIntroName: 'Metroid - Zero Mission (USA)',
    players: 1,
    year: '2004',
    accent: '#8b5cf6',
    category: 'adventure',
    genre: 'Ação · Sci-Fi Metroidvania',
    synopsis:
      'A primeira missão de Samus Aran no planeta Zebes reimaginada com controles ágeis e um ato furtivo inédito.'
  }),
  createCatalogItem('gba', {
    slug: 'metal-slug-advance',
    title: 'Metal Slug Advance',
    noIntroName: 'Metal Slug Advance (USA)',
    players: 1,
    year: '2004',
    accent: '#f59e0b',
    category: 'adventure',
    genre: 'Arcade · Run & Gun',
    synopsis:
      'Pixel art detalhada da SNK, tanques SV-001 customizáveis e sistema de cartas colecionáveis em missões explosivas.'
  }),
  createCatalogItem('gba', {
    slug: 'sonic-advance',
    title: 'Sonic Advance',
    noIntroName: 'Sonic Advance (USA) (En,Ja)',
    players: 2,
    year: '2001',
    accent: '#2563eb',
    category: 'adventure',
    genre: 'Plataforma · Alta Velocidade',
    synopsis:
      'Corra com Sonic, Tails, Knuckles e Amy através de zonas inéditas com física clássica do Mega Drive.'
  }),
  createCatalogItem('gba', {
    slug: 'db-advanced-adventure',
    title: 'Dragon Ball: Advanced Adventure',
    noIntroName: 'Dragon Ball - Advanced Adventure (USA)',
    players: 2,
    year: '2004',
    accent: '#ea580c',
    category: 'adventure',
    genre: 'Ação · Beat-em-up & Torneio',
    synopsis:
      'Reviva a saga clássica do jovem Goku combinando fases de ação lateral e combates de artes marciais 1v1.'
  }),
  createCatalogItem('segaMD', {
    slug: 'mega-bomberman',
    title: 'Mega Bomberman',
    noIntroName: 'Mega Bomberman (USA)',
    players: 4,
    year: '1994',
    accent: '#06b6d4',
    category: 'multiplayer',
    genre: 'Party · Arena 16-Bit',
    synopsis:
      'A versão consagrada do Mega Drive com trilha chiptune marcante e batalhas frenéticas para até 4 jogadores.'
  }),
  createCatalogItem('segaMD', {
    slug: 'streets-of-rage-2',
    title: 'Streets of Rage 2',
    noIntroName: 'Streets of Rage 2 (USA)',
    players: 2,
    year: '1992',
    accent: '#e11d48',
    category: 'multiplayer',
    genre: 'Beat-em-up · Co-op Urbano',
    synopsis:
      'Axel, Blaze, Skate e Max enfrentam o sindicato de Mr. X ao som da lendária trilha eletrônica de Yuzo Koshiro.'
  }),
  createCatalogItem('segaMD', {
    slug: 'sonic-3',
    title: 'Sonic The Hedgehog 3',
    noIntroName: 'Sonic The Hedgehog 3 (USA)',
    players: 2,
    year: '1994',
    accent: '#3b82f6',
    category: 'adventure',
    genre: 'Plataforma · Angel Island',
    synopsis:
      'Escudos elementais, fases interconectadas sem cortes e modo competitivo de tela dividida em 60 quadros por segundo.'
  })
];

function getVerifiedBySlug(slug) {
  return VERIFIED_CATALOG.find((item) => item.slug === slug) || null;
}

module.exports = {
  VERIFIED_CATALOG,
  getVerifiedBySlug
};
