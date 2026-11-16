// bots.js — the nine bots (4 Dusters beside you, 5 Wardens against you).
// Each bot follows the waypoint graph to its objective, holds a position,
// reacts to what it sees (line of sight + field of view) and hears
// (gunshots within 26 m turn it toward the shooter), and fights in bursts
// with a human-like reaction delay. Bots also fight each other, so a round
// can be won or lost without the player firing a shot.
import * as THREE from 'three';
import { WEAPONS, BOT_NAMES, ROUND, TEAMS } from './state.js';
import { NODES, SITE_NODE } from './world.js';

const EYE = 1.5;
const WALK_SPEED = 3.4;
const AIM_SPEED = 1.2;

function makeBotMesh(team) {
  const color = TEAMS[team].color;
  const dark = team === 'atk' ? 0x7a4a1a : 0x1e4a44;
  const group = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.32), mat(0x2a2620));
  legs.position.y = 0.35;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.78, 0.38), mat(color));
  torso.position.y = 1.09;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.4, 0.42), mat(dark));
  vest.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), mat(0xc9a37e));
  head.position.y = 1.66;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, 1.2), mat(dark));
  helmet.position.y = 1.7;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.78), mat(0x1c1a17));
  gun.position.set(0.28, 1.25, 0.42);
  group.add(legs, torso, vest, head, helmet, gun);
  const hitMeshes = [head, torso, legs];
  head.userData.part = 'head';
  torso.userData.part = 'body';
  legs.userData.part = 'body';
  return { group, hitMeshes };
}

export class BotManager {
  constructor(scene, world, combat, sfx, hooks) {
    this.scene = scene;
    this.world = world;
    this.combat = combat;
    this.sfx = sfx;
    this.hooks = hooks; // { onPlant(site), onDefuse(), onBotKill }
    this.ray = new THREE.Raycaster();
  }

  spawnAll(G) {
    // remove old meshes
    for (const b of G.bots) this.scene.remove(b.mesh.group);
    G.bots = [];
    const loadouts = ['rifle', 'rifle', 'smg', 'smg', 'pistol'];
    for (let i = 0; i < 4; i++) this._make(G, 'atk', BOT_NAMES.atk[i], loadouts[i], i);
    for (let i = 0; i < 5; i++) this._make(G, 'def', BOT_NAMES.def[i], loadouts[i], i);
    this.combat.rebuildShootables(G.bots);
  }

  _make(G, team, name, weaponId, idx) {
    const spawn = team === 'atk'
      ? { x: -6 + idx * 3, z: 16 } : { x: -6 + idx * 3, z: -16 };
    const { group, hitMeshes } = makeBotMesh(team);
    const bot = {
      id: `${team}${idx}`, name, team, isBot: true,
      x: spawn.x, z: spawn.z, y: 1.0, yaw: team === 'atk' ? Math.PI : 0,
      hp: 100, alive: true, armor: false,
      weaponId, weapon: WEAPONS[weaponId],
      ammo: { mag: WEAPONS[weaponId].mag, reserve: 999 },
      bloom: 0, lastShot: -9, reloadT: 0, speed: 0, crouch: false,
      state: 'route', path: [], pathIdx: 0, holdNode: -1, site: null,
      carrier: false, target: null, targetIsPlayer: false,
      lastSeenX: 0, lastSeenZ: 0, alertT: 0, alertX: 0, alertZ: 0,
      reactionT: 0, burstLeft: 0, burstPause: 0, thinkT: Math.random() * 0.2,
      plantT: 0, defuseT: 0, scanT: Math.random() * 6, moving: false,
      mesh: { group, hitMeshes }, kills: 0,
    };
    for (const m of hitMeshes) m.userData.bot = bot;
    group.position.set(bot.x, 0, bot.z);
    this.scene.add(group);
    G.bots.push(bot);
    return bot;
  }

  // Assign objectives for a fresh round.
  assignRound(G) {
    const atk = G.bots.filter((b) => b.team === 'atk' && b.alive);
    const def = G.bots.filter((b) => b.team === 'def' && b.alive);
    // attackers split between the sites; the first one carries the device
    const siteA = [], siteB = [];
    for (const b of atk) (Math.random() < 0.5 ? siteA : siteB).push(b);
    if (!siteA.length) siteA.push(siteB.pop());
    if (!siteB.length) siteB.push(siteA.pop());
    for (const b of siteA) this._routeTo(G, b, SITE_NODE.A, 'A');
    for (const b of siteB) this._routeTo(G, b, SITE_NODE.B, 'B');
    atk[0].carrier = true;
    G.bomb.carrier = atk[0];
    // defenders: two hold A, two hold B, one roams mid
    const holds = [19, 20, 18, 22, 23]; // A flank, B flank, north mid, corners
    def.forEach((b, i) => {
      const node = holds[i % holds.length];
      b.holdNode = node;
      b.site = node === 19 ? 'A' : node === 20 ? 'B' : null;
      this._routeTo(G, b, node, b.site);
    });
  }

  _routeTo(G, bot, node, site) {
    const from = this.world.nearestNode(bot.x, bot.z);
    bot.path = this.world.findPath(from, node);
    bot.pathIdx = 0;
    bot.site = site;
    bot.state = 'route';
    bot.plantT = 0;
    bot.defuseT = 0;
  }

  // A gunshot at (x, z): enemy bots nearby turn toward the sound.
  hearShot(G, shooter, x, z) {
    for (const b of G.bots) {
      if (!b.alive || b.team === shooter.team) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < 26) {
        b.alertX = x; b.alertZ = z; b.alertT = 1.6;
      }
    }
  }

  update(G, dt) {
    // freeze time: bots hold still during the buy phase
    if (G.phase === 'buy') return;
    for (const b of G.bots) {
      if (!b.alive) continue;
      b.thinkT -= dt;
      if (b.thinkT <= 0) {
        b.thinkT = 0.15;
        this._think(G, b);
      }
      this._act(G, b, dt);
      this._syncMesh(b, dt);
    }
    this._separate(G);
  }

  _visibleEnemy(G, b) {
    // nearest enemy with line of sight, in front, within 48 m
    let best = null, bestD = 48;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const consider = (ex, ez, ey, ent, isPlayer) => {
      const dx = ex - b.x, dz = ez - b.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || d < 0.3) return;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.25 && d > 3) return; // outside ~75 deg forward cone
      if (!this.world.hasLOS(this.ray, b.x, EYE, b.z, ex, ey, ez)) return;
      best = { ent, isPlayer, x: ex, z: ez, y: ey };
      bestD = d;
    };
    // the player, when on the other team
    if (G.player.alive && G.player.team !== b.team) {
      consider(G.player.x, G.player.z, G.player.y, G.player, true);
    }
    for (const o of G.bots) {
      if (!o.alive || o.team === b.team || o === b) continue;
      consider(o.x, o.z, EYE - 0.1, o, false);
    }
    return best;
  }

  _think(G, b) {
    const seen = this._visibleEnemy(G, b);
    if (seen) {
      if (b.target !== seen.ent) {
        b.reactionT = 0.35 + Math.random() * 0.3; // human-like delay
        b.burstLeft = 0;
      }
      b.target = seen.ent;
      b.targetIsPlayer = seen.isPlayer;
      b.lastSeenX = seen.x; b.lastSeenZ = seen.z;
      b.state = 'engage';
      return;
    }
    b.target = null;
    // bomb planted: defenders converge on the site
    if (G.bomb.state === 'planted' && b.team === 'def') {
      const site = G.bomb.site;
      if (b.state !== 'defuse' || b.site !== site) {
        this._routeTo(G, b, SITE_NODE[site], site);
        b.state = 'defuse';
      }
      return;
    }
    // no target: resume the objective
    if (b.state === 'engage') {
      if (b.team === 'atk' && b.site) this._routeTo(G, b, SITE_NODE[b.site], b.site);
      else if (b.holdNode >= 0) this._routeTo(G, b, b.holdNode, b.site);
      else b.state = 'hold';
    }
    if (b.state === 'route' && b.pathIdx >= b.path.length) {
      if (b.team === 'atk' && b.carrier && G.bomb.state === 'held'
        && this._atSite(b, b.site)) {
        b.state = 'plant';
        b.plantT = 0;
      } else {
        b.state = 'hold';
      }
    }
  }

  _atSite(b, site) {
    if (!site) return false;
    const s = { A: { x: -22, z: -12 }, B: { x: 22, z: -12 } }[site];
    return Math.hypot(b.x - s.x, b.z - s.z) < 3.5;
  }

  _act(G, b, dt) {
    b.reloadT = Math.max(0, b.reloadT - dt);
    b.bloom = Math.max(0, b.bloom - dt * 0.09);
    b.moving = false;

    if (b.state === 'engage' && b.target && b.target.alive) {
      // face the target, stand (or slow-strafe), fire in bursts
      const tx = b.target.x, tz = b.target.z;
      b.yaw = Math.atan2(tx - b.x, tz - b.z);
      b.reactionT -= dt;
      if (b.reactionT <= 0 && b.reloadT <= 0) {
        if (b.burstLeft <= 0) {
          b.burstPause -= dt;
          if (b.burstPause <= 0) {
            b.burstLeft = 3 + Math.floor(Math.random() * 3);
            b.burstPause = 0.7 + Math.random() * 0.6;
          }
        } else if (G.time - b.lastShot >= b.weapon.interval) {
          this._shootAt(G, b, b.target);
          b.burstLeft--;
        }
      }
      b.speed = 0;
      return;
    }

    if (b.state === 'plant') {
      if (!b.target) {
        b.plantT += dt;
        if (b.plantT >= ROUND.PLANT_SECONDS) {
          b.state = 'hold';
          this.hooks.onPlant(b.site, b);
        }
      }
      return;
    }

    if (b.state === 'defuse') {
      const s = { A: { x: -22, z: -12 }, B: { x: 22, z: -12 } }[G.bomb.site];
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      if (d < 2.6 && !b.target) {
        b.defuseT += dt;
        if (b.defuseT >= ROUND.DEFUSE_SECONDS) {
          b.defuseT = 0;
          b.state = 'hold';
          this.hooks.onDefuse(b);
        }
      } else {
        this._followPath(G, b, dt);
      }
      return;
    }

    if (b.state === 'route') {
      this._followPath(G, b, dt);
      return;
    }

    // hold: scan the surroundings slowly
    b.scanT += dt;
    b.yaw += Math.sin(b.scanT * 0.5) * dt * 0.35;
    if (b.alertT > 0) {
      b.alertT -= dt;
      b.yaw = Math.atan2(b.alertX - b.x, b.alertZ - b.z);
    }
    b.speed = 0;
  }

  _followPath(G, b, dt) {
    if (b.pathIdx >= b.path.length) return;
    const n = NODES[b.path[b.pathIdx]];
    const dx = n[0] - b.x, dz = n[1] - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) { b.pathIdx++; b.stuckT = 0; return; }
    // stuck guard: if a waypoint cannot be reached (a wall in the way),
    // skip it after a few seconds instead of stalling the bot forever
    b.stuckT = (b.stuckT || 0) + dt;
    if (b.stuckT > 3.5) { b.pathIdx++; b.stuckT = 0; return; }
    const sp = WALK_SPEED;
    b.x += (dx / d) * sp * dt;
    b.z += (dz / d) * sp * dt;
    b.yaw = Math.atan2(dx, dz);
    b.speed = sp;
    b.moving = true;
    this.world.resolveCircle(b, 0.42);
  }

  _shootAt(G, b, target) {
    const def = b.weapon;
    if (b.ammo.mag <= 0) {
      b.reloadT = 1.8;
      b.ammo.mag = def.mag;
      this.sfx.reload();
      return;
    }
    b.ammo.mag--;
    b.lastShot = G.time;
    b.bloom = Math.min(0.05, b.bloom + 0.006);
    const dist = Math.hypot(target.x - b.x, target.z - b.z);
    const extra = 0.012 + dist * 0.0009 + (target.speed > 0.6 ? 0.02 : 0);
    const ty = target === G.player ? target.y - 0.15 : EYE - 0.1;
    const dx = target.x - b.x, dy = ty - EYE, dz = target.z - b.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.combat.fire(G, b, def, b.x, EYE, b.z, dx / len, dy / len, dz / len,
      { extraSpread: extra });
    this.combat.hooks.onShot(b, b.x, b.z);
  }

  _syncMesh(b, dt) {
    const g = b.mesh.group;
    g.position.set(b.x, b.moving ? Math.abs(Math.sin(b.mesh.bobT || 0)) * 0.04 : 0, b.z);
    g.rotation.y = b.yaw;
    b.mesh.bobT = (b.mesh.bobT || 0) + dt * (b.moving ? 9 : 0);
    g.visible = b.alive;
    // Keep the hit-mesh matrices in step with the sim, not the renderer:
    // shots raycast against these meshes, so a skipped render frame must
    // never leave a bot's body behind where the sim says it is.
    g.updateMatrixWorld(true);
  }

  _separate(G) {
    const bots = G.bots;
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j++) {
        const c = bots[j];
        if (!c.alive) continue;
        const dx = c.x - a.x, dz = c.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.81 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (0.9 - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          c.x += nx * push; c.z += nz * push;
        }
      }
    }
  }
}
