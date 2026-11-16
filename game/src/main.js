// main.js — bootstrap and the game loop for DUSTFALL, a three.js tactical
// FPS: 5v5, round-based, Counter-Strike-style, with plant/defuse, a buy
// menu, money between rounds, bots, and gunfire where accuracy counts
// more than speed.
//
// The simulation runs on a fixed 1/60 s step, kept apart from rendering:
// sim() moves the player, bots, grenades and round timers; render() only
// copies state into the scene and the HUD. No object is allocated per
// frame in the hot path.
import * as THREE from 'three';
import { createState, WEAPONS, ROUND } from './state.js';
import { World } from './world.js';
import { Sfx } from './audio.js';
import { Combat } from './weapons.js';
import { BotManager } from './bots.js';
import { updatePlayer, buyItem } from './player.js';
import { startMatch, updateRounds, plantBomb, defuseBomb } from './rounds.js';
import { Hud } from './hud.js';
import { attachInput } from './input.js';

const STEP = 1 / 60;
const G = createState();
G.player.team = 'atk';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const sfx = new Sfx();
const world = new World(scene);
const combat = new Combat(scene, world, sfx, {
  onKill: (victim, attacker, head) => {
    hud.feedKill(victim, attacker, head);
    if (victim === G.player) {
      G.player.deaths++;
      hud.banner('YOU ARE DOWN', 'Spectating your squad — the round plays on.');
    }
    if (attacker === G.player && victim !== G.player) hud.hitmarker(true);
  },
  onPlayerDamage: () => hud.flashDamage(),
  onShot: (shooter, x, z) => bots.hearShot(G, shooter, x, z),
  onShake: (k) => { shake = Math.max(shake, k); },
});
const bots = new BotManager(scene, world, combat, sfx, {
  onPlant: (site, planter) => plantBomb(G, site, planter, roundHooks),
  onDefuse: (bot) => defuseBomb(G, bot, roundHooks),
});
const hud = new Hud(G, {
  onBuy: (id) => {
    const msg = buyItem(G, id, sfx);
    hud.setHint(msg);
    hud.refreshShop();
  },
  onPlay: () => {
    sfx.ensure();
    if (!matchStarted) {
      matchStarted = true;
      startMatch(G, bots, roundHooks);
    }
    hud.hideStart();
    hud.showHud();
    input.lock();
  },
  onRestart: () => {
    hud.hideEnd();
    matchStarted = false;
    G.matchOver = false;
    startMatch(G, bots, roundHooks);
    hud.hideStart();
    hud.showHud();
    input.lock();
  },
});
hud.showHud = () => document.getElementById('hud').classList.add('on');

const roundHooks = {
  bots,
  sfx,
  clearGrenades: () => {
    for (const g of G.grenades) combat.scene.remove(g.mesh);
    G.grenades.length = 0;
  },
  banner: (t, s) => hud.banner(t, s),
  onRoundStart: () => { hud.setBuyOpen(false); },
  onRoundEnd: () => { hud.setBuyOpen(false); },
  onPlant: () => {},
  onMatchEnd: (winner, score) => {
    const text = winner === 'atk'
      ? `The Dusters take Kestrel Foundry ${score.atk}—${score.def}. ${G.player.kills} eliminations for you.`
      : `The Wardens hold Kestrel Foundry ${score.def}—${score.atk}. Regroup and run it back.`;
    hud.showEnd(winner, score, text);
    input.unlock();
  },
};

let matchStarted = false;
let shake = 0;
let expectUnlock = false;

const input = attachInput(G, renderer.domElement, {
  onBuyToggle: () => {
    if (hud.buyOpen) {
      hud.setBuyOpen(false);
      input.lock();
    } else if (G.phase === 'buy' && matchStarted && !G.matchOver) {
      hud.setBuyOpen(true);
      expectUnlock = true;
      input.unlock();
    } else if (matchStarted) {
      hud.setHint('Buy menu opens only during the buy phase.');
    }
  },
  onCanvasClick: () => {
    if (matchStarted && !G.matchOver && !hud.buyOpen) input.lock();
  },
  onLockChange: (locked) => {
    if (!locked && matchStarted && !G.matchOver && !hud.buyOpen && !expectUnlock) {
      hud.showStart(true); // paused
    }
    expectUnlock = false;
  },
  onEscape: () => { if (hud.buyOpen) { hud.setBuyOpen(false); input.lock(); } },
  onRestart: () => { if (G.matchOver) hud.hooks.onRestart(); },
});

// ---- viewmodel gun (boxes attached to the camera) ----
const gun = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color: 0x23211e });
  const mid = new THREE.MeshLambertMaterial({ color: 0x4a4238 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), mid);
  barrel.position.set(0, 0.02, -0.4);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), dark);
  grip.position.set(0, -0.13, 0.16);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), mid);
  sight.position.set(0, 0.09, -0.05);
  gun.add(body, barrel, grip, sight);
  gun.position.set(0.26, -0.24, -0.5);
  camera.add(gun);
}
const muzzle = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
muzzle.position.set(0.26, -0.21, -0.95);
camera.add(muzzle);

// ---- planted device mesh (hidden until a plant) ----
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x2c2c26 }));
  box.position.y = 0.1;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1e }));
  lamp.position.set(0.1, 0.24, 0);
  bombMesh.add(box, lamp);
  bombMesh.userData.lamp = lamp;
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// ---- fixed-step simulation ----
function simStep(dt) {
  G.time += dt;
  if (!matchStarted || G.matchOver) return;
  updatePlayer(G, dt, world, combat, sfx, {
    onWeaponSwitch: () => {},
    onGrenade: () => {},
    onPlantProgress: (f, site) => hud.showProgress(f > 0 ? `PLANTING DEVICE — SITE ${site}…` : null, f),
    onDefuseProgress: (f) => hud.showProgress(f > 0 ? 'DEFUSING DEVICE…' : null, f),
    onPlant: (site, p) => plantBomb(G, site, p, roundHooks),
    onDefuse: (p) => defuseBomb(G, p, roundHooks),
  });
  bots.update(G, dt);
  combat.updateGrenades(G, dt);
  updateRounds(G, dt, roundHooks);
  if (G.bomb.state === 'planted') {
    bombMesh.visible = true;
    bombMesh.position.set(G.bomb.x, 0, G.bomb.z);
    const blink = (Math.sin(G.time * 6) > 0) ? 1 : 0.15;
    bombMesh.userData.lamp.material.color.setRGB(1 * blink, 0.1 * blink, 0.05 * blink);
  } else {
    bombMesh.visible = false;
  }
}

// ---- render: copy state into the scene ----
let kick = 0;
function render(dt) {
  const p = G.player;
  // camera: player, or spectate the first living squadmate when down
  let cx = p.x, cy = p.y, cz = p.z, cyaw = p.yaw, cpitch = p.pitch;
  if (!p.alive && matchStarted) {
    const mate = G.bots.find((b) => b.alive && b.team === 'atk');
    if (mate) {
      cx = mate.x; cy = 1.55; cz = mate.z; cyaw = mate.yaw; cpitch = -0.05;
    }
  }
  shake = Math.max(0, shake - dt * 1.4);
  const shX = shake * (Math.random() - 0.5) * 0.05;
  const shY = shake * (Math.random() - 0.5) * 0.05;
  camera.position.set(cx, cy, cz);
  camera.rotation.set(cpitch + shY, cyaw + shX, 0);
  // viewmodel: recoil kick + muzzle flash right after a shot
  kick = Math.max(0, kick - dt * 0.35);
  if (G.time - p.lastShot < 0.06) kick = 0.06;
  gun.position.z = -0.5 + kick;
  gun.visible = p.alive && matchStarted;
  muzzle.visible = G.time - p.lastShot < 0.05 && p.alive;
  // plane faces +z, i.e. toward the camera, by construction
  muzzle.rotation.z = Math.random() * Math.PI;
  renderer.render(scene, camera);
  hud.update(dt);
  // contextual hint
  if (matchStarted && !G.matchOver) {
    if (!p.alive) hud.setHint('You are down — spectating your squad.');
    else if (G.phase === 'buy') hud.setHint('Buy phase — press B for the buy menu.');
    else if (G.bomb.state === 'held') hud.setHint('Plant the device: hold E inside Site A or B.');
    else if (G.bomb.state === 'planted') hud.setHint('Device planted — defend Site ' + G.bomb.site + '.');
  }
}

// ---- main loop ----
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  let guard = 0;
  while (acc >= STEP && guard < 8) {
    simStep(STEP);
    acc -= STEP;
    guard++;
  }
  if (renderEnabled) render(dt);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- screenshot staging (?scene=cover|buy|plant|end) ----
// Real renders of the real game: the scene param only stages the match
// (positions, phase, loadout) and skips the start overlay + pointer lock.
function stageScene(name) {
  matchStarted = true;
  hud.hideStart();
  hud.showHud();
  if (name === 'end') {
    G.score.atk = 5; G.score.def = 2;
    G.matchOver = true;
    G.winner = 'atk';
    G.player.kills = 7;
    hud.showEnd('atk', G.score, 'The Dusters take Kestrel Foundry 5—2. 7 eliminations for you.');
    return;
  }
  startMatch(G, bots, roundHooks);
  const p = G.player;
  if (name === 'cover') {
    G.phase = 'live'; G.phaseT = 82;
    p.x = -1; p.z = 9; p.yaw = 0.12; p.pitch = -0.02;
    p.money = 2700;
    buyItem(G, 'rifle', sfx); // staged loadout, same code path as the shop
    p.money = 2700;
    const defs = G.bots.filter((b) => b.team === 'def');
    defs[0].x = -3.5; defs[0].z = -5; defs[0].state = 'hold'; defs[0].path = []; defs[0].yaw = Math.PI;
    defs[1].x = 4; defs[1].z = -7; defs[1].state = 'hold'; defs[1].path = []; defs[1].yaw = Math.PI;
    defs[2].x = -8; defs[2].z = -2; defs[2].state = 'hold'; defs[2].path = [];
    const atk = G.bots.filter((b) => b.team === 'atk');
    atk[0].x = -6; atk[0].z = 4; atk[0].state = 'hold'; atk[0].path = []; atk[0].yaw = 0;
    hud.banner('ROUND 1', 'Plant the device or eliminate the Wardens.');
  } else if (name === 'buy') {
    G.phase = 'buy'; G.phaseT = 9;
    p.x = 0; p.z = 16; p.yaw = 0; p.pitch = 0;
    p.money = 2700;
    hud.setBuyOpen(true);
  } else if (name === 'plant') {
    G.phase = 'live'; G.phaseT = 61;
    plantBomb(G, 'A', G.bots[0], roundHooks);
    G.bomb.timer = 32.4;
    // player looks at the planted device (site A, -22,-12): yaw 0.9 aims
    // the view north-west at the device, pitch slightly down to centre it
    p.x = -17; p.z = -8; p.yaw = 0.9; p.pitch = -0.08;
    const defs = G.bots.filter((b) => b.team === 'def');
    // Every defender must already be in 'defuse' state for site A with an
    // empty path: _think re-routes any defender that is not, and the
    // re-routed ones converge on the site and shoot the player mid-shot.
    // Bot forward is (sin yaw, cos yaw), so yaw PI faces north.
    // one defender kneeling at the device, mid-defuse, back to the player
    defs[0].x = -21; defs[0].z = -11; defs[0].state = 'defuse'; defs[0].site = 'A';
    defs[0].path = []; defs[0].yaw = -2.36; defs[0].defuseT = 0;
    // the rest stand at the north spawn facing north (player is south of
    // them, outside their forward cone), so nobody engages the player
    const rest = [[-6, -16], [-2, -16], [2, -16], [6, -16]];
    for (let i = 1; i < defs.length; i++) {
      defs[i].x = rest[i - 1][0]; defs[i].z = rest[i - 1][1];
      defs[i].state = 'defuse'; defs[i].site = 'A'; defs[i].path = [];
      defs[i].yaw = Math.PI;
    }
  }
}

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene');
if (sceneName) {
  stageScene(sceneName);
} else {
  hud.showStart(false);
}

// debug handle for play-testing (not part of the game loop):
// step(n) advances the fixed-step sim n ticks without waiting for a
// frame, and setRender(false) skips WebGL rendering so logic tests run
// fast on software rasterizers. The shipped game never calls either.
let renderEnabled = true;
window.__dust = { G, bots, combat, world,
  startMatch: () => startMatch(G, bots, roundHooks),
  step: (n) => { for (let i = 0; i < n; i++) simStep(STEP); },
  setRender: (on) => { renderEnabled = on; },
};

requestAnimationFrame(frame);
