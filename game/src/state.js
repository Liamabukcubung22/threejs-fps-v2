// state.js — every static definition and the single mutable game state.
// Nothing here touches the DOM or three.js; other modules read and write
// this one object, so the whole match lives in one place.

// ---- Weapons: accuracy beats speed. Standing still is far more accurate
// than firing on the move; every shot adds bloom that decays while you wait.
export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 SIDEARM', price: 0, damage: 24, headMult: 2.5,
    interval: 0.28, mag: 12, reserve: 48, spread: 0.014, moveSpread: 2.2,
    recoil: 0.011, range: 90, auto: false, sound: 'pistol', tracer: 0xffd27a },
  smg: { id: 'smg', name: 'VK-9 CARBINE', price: 1500, damage: 20, headMult: 2.5,
    interval: 0.095, mag: 28, reserve: 84, spread: 0.021, moveSpread: 2.0,
    recoil: 0.008, range: 70, auto: true, sound: 'smg', tracer: 0xffc46e },
  rifle: { id: 'rifle', name: 'AR-77 LONGSHOT', price: 2700, damage: 33, headMult: 2.5,
    interval: 0.135, mag: 25, reserve: 75, spread: 0.009, moveSpread: 2.6,
    recoil: 0.014, range: 110, auto: true, sound: 'rifle', tracer: 0xffe9a8 },
  sniper: { id: 'sniper', name: 'M90 MARKSMAN', price: 4750, damage: 95, headMult: 2.5,
    interval: 1.25, mag: 5, reserve: 15, spread: 0.003, moveSpread: 3.0,
    recoil: 0.05, range: 140, auto: false, sound: 'sniper', tracer: 0x9fe8ff },
};

export const GRENADE = { id: 'grenade', name: 'FRAG-9 GRENADE', price: 300,
  damage: 90, radius: 6.5, fuse: 2.6 };
export const ARMOR = { id: 'armor', name: 'KEVLAR VEST', price: 650, reduction: 0.3 };

export const TEAMS = {
  atk: { id: 'atk', name: 'DUSTERS', color: 0xffb454, css: '#ffb454' },
  def: { id: 'def', name: 'WARDENS', color: 0x57c8b8, css: '#57c8b8' },
};

export const ROUND = {
  BUY_SECONDS: 12,
  LIVE_SECONDS: 100,
  BOMB_SECONDS: 35,
  PLANT_SECONDS: 3,
  DEFUSE_SECONDS: 5,
  END_SECONDS: 4,
  WIN_ROUNDS: 5,
  START_MONEY: 800,
  WIN_MONEY: 3250,
  LOSS_MONEY: 1900,
  KILL_MONEY: 300,
  PLANT_MONEY: 300,
  DEFUSE_MONEY: 300,
};

export const BOT_NAMES = {
  atk: ['ROOK', 'SABLE', 'FLINT', 'JUNO'],
  def: ['HAVEN', 'BRAM', 'ONYX', 'KITE', 'VERA'],
};

export function createState() {
  return {
    // match
    matchOver: false,
    winner: null,
    roundNumber: 1,
    score: { atk: 0, def: 0 },
    // round
    phase: 'buy',          // 'buy' | 'live' | 'end'
    phaseT: ROUND.BUY_SECONDS,
    roundWinner: null,
    roundReason: '',
    // bomb
    bomb: { state: 'held', site: null, x: 0, z: 0, timer: 0, carrier: null,
      plantT: 0, defuseT: 0, planter: null, defuser: null },
    // player
    player: {
      team: 'atk',
      x: 0, z: 16, y: 1.62, yaw: 0, pitch: 0,
      vx: 0, vz: 0, hp: 100, armor: false, alive: true,
      money: ROUND.START_MONEY,
      weapons: ['pistol'], current: 0,
      ammo: { pistol: { mag: 12, reserve: 48 } },
      grenades: 0, bloom: 0, reloadT: 0, lastShot: -9,
      crouch: false, moving: false, speed: 0,
      plantT: 0, defuseT: 0, kills: 0, deaths: 0,
    },
    bots: [],
    grenades: [],           // live thrown grenades
    feed: [],               // kill-feed entries {text, cls}
    time: 0,
    // input (filled by input.js)
    input: { fwd: 0, strafe: 0, crouch: false, walk: false, fire: false,
      fireEdge: false, reload: false, use: false, buy: false,
      slot: 0, grenadeKey: false, turn: 0, lookDX: 0, lookDY: 0 },
    // transient flags consumed by the sim
    events: [],
  };
}

