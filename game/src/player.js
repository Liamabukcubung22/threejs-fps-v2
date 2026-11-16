// player.js — the human Duster: movement with acceleration and crouch,
// shooting with recoil and bloom, reloading, weapon switching, grenades
// and planting the device. Movement speed feeds the spread model, so
// stopping to aim is a real decision, not flavour text.
import { WEAPONS, GRENADE, ROUND } from './state.js';
import { SITES } from './world.js';

const WALK = 4.3;
const CROUCH_SPEED = 2.1;
const SLOW_SPEED = 2.3;
const ACCEL = 34;
const RADIUS = 0.42;

export function updatePlayer(G, dt, world, combat, sfx, hooks) {
  const p = G.player;
  const inp = G.input;
  // --- look (mouse deltas are consumed here so the sim owns the yaw) ---
  // Consumed even when dead or between rounds so no delta piles up.
  p.yaw -= inp.lookDX * 0.0022;
  p.pitch -= inp.lookDY * 0.0022;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  p.yaw += inp.turn * 2.3 * dt;
  // lookDX/lookDY are edge deltas: consumed. turn is a level from the
  // held arrow key: left alone, input.js maintains it from key state.
  inp.lookDX = 0; inp.lookDY = 0;
  if (!p.alive || (G.phase !== 'live' && G.phase !== 'buy')) return;

  // --- movement: accelerate toward the wish direction, friction on stop ---
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // forward is -Z rotated by yaw: ( -sin, -cos )? Camera looks along -Z
  // rotated by yaw, so forward = (-sin(yaw), -cos(yaw)).
  const fx = -sin, fz = -cos;
  const rx = -fz, rz = fx; // right vector
  let wx = fx * inp.fwd + rx * inp.strafe;
  let wz = fz * inp.fwd + rz * inp.strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }
  const crouch = inp.crouch;
  p.crouch = crouch;
  const targetSpeed = crouch ? CROUCH_SPEED : inp.walk ? SLOW_SPEED : WALK;
  const tx = wx * targetSpeed, tz = wz * targetSpeed;
  p.vx += (tx - p.vx) * Math.min(1, dt * 10);
  p.vz += (tz - p.vz) * Math.min(1, dt * 10);
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  world.resolveCircle(p, RADIUS);
  p.speed = Math.hypot(p.vx, p.vz);
  p.moving = p.speed > 0.6;
  // eye height: crouch lowers the camera
  const eyeTarget = crouch ? 1.12 : 1.62;
  p.y += (eyeTarget - p.y) * Math.min(1, dt * 12);

  // footsteps
  p.stepAcc = (p.stepAcc || 0) + p.speed * dt;
  if (p.stepAcc > 2.4 && p.moving) { p.stepAcc = 0; sfx.step(); }

  // --- bloom decays while waiting ---
  p.bloom = Math.max(0, p.bloom - dt * 0.085);

  // --- reload ---
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      const def = WEAPONS[p.weapons[p.current]];
      const a = p.ammo[def.id];
      const need = def.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
    }
  }

  // --- weapon switching (1/2/3 = owned guns in buy order) ---
  if (inp.slot > 0) {
    const idx = inp.slot - 1;
    if (idx < p.weapons.length && idx !== p.current && p.reloadT <= 0) {
      p.current = idx;
      p.reloadT = 0;
      hooks.onWeaponSwitch();
    }
    inp.slot = 0;
  }

  // --- grenade throw (G or 4); live phase only ---
  if (inp.grenadeKey) {
    inp.grenadeKey = false;
    if (G.phase === 'live' && p.grenades > 0 && p.reloadT <= 0) {
      p.grenades--;
      const dx = -Math.sin(p.yaw) * Math.cos(p.pitch);
      const dy = Math.sin(p.pitch);
      const dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
      combat.throwGrenade(G, p, p.x, p.y - 0.1, p.z, dx, dy, dz);
      hooks.onGrenade();
    } else if (G.phase === 'live' && p.grenades <= 0) {
      sfx.denied();
    }
  }

  // --- fire ---
  const def = WEAPONS[p.weapons[p.current]];
  const a = p.ammo[def.id];
  const wantFire = def.auto ? inp.fire : inp.fireEdge;
  inp.fireEdge = false;
  if (wantFire && G.phase === 'live' && p.reloadT <= 0 && G.time - p.lastShot >= def.interval) {
    if (a.mag <= 0) {
      sfx.dry();
      startReload(G, p, def, sfx);
      p.lastShot = G.time;
    } else {
      a.mag--;
      p.lastShot = G.time;
      p.bloom = Math.min(0.055, p.bloom + (def.id === 'rifle' ? 0.0075 : def.id === 'sniper' ? 0.03 : 0.005));
      p.pitch += def.recoil * (p.crouch ? 0.8 : 1);
      p.yaw += (Math.random() - 0.5) * def.recoil * 0.5;
      const dx = -Math.sin(p.yaw) * Math.cos(p.pitch);
      const dy = Math.sin(p.pitch);
      const dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
      const res = combat.fire(G, p, def, p.x, p.y, p.z, dx, dy, dz);
      combat.hooks.onShot(p, p.x, p.z);
      if (res.hit === 'head' || res.hit === 'body') {
        sfx.hit();
        if (res.target && !res.target.alive) sfx.kill();
      }
    }
  }

  // --- manual reload ---
  if (inp.reload) {
    inp.reload = false;
    startReload(G, p, def, sfx);
  }

  // --- plant / defuse progress (hold E, standing still) ---
  if (inp.use && G.phase === 'live' && p.speed < 0.8) {
    if (G.bomb.state === 'held' && p.team === 'atk') {
      const site = nearSite(p);
      if (site) {
        p.plantT += dt;
        hooks.onPlantProgress(p.plantT / ROUND.PLANT_SECONDS, site);
        if (p.plantT >= ROUND.PLANT_SECONDS) {
          p.plantT = 0;
          hooks.onPlant(site, p);
        }
      } else {
        p.plantT = 0;
        hooks.onPlantProgress(0, null);
      }
    } else if (G.bomb.state === 'planted' && p.team === 'def') {
      const d = Math.hypot(p.x - G.bomb.x, p.z - G.bomb.z);
      if (d < 2.6) {
        p.defuseT += dt;
        hooks.onDefuseProgress(p.defuseT / ROUND.DEFUSE_SECONDS);
        if (p.defuseT >= ROUND.DEFUSE_SECONDS) {
          p.defuseT = 0;
          hooks.onDefuse(p);
        }
      } else {
        p.defuseT = 0;
        hooks.onDefuseProgress(0);
      }
    }
  } else {
    if (p.plantT > 0) { p.plantT = 0; hooks.onPlantProgress(0, null); }
    if (p.defuseT > 0) { p.defuseT = 0; hooks.onDefuseProgress(0); }
  }
}

export function startReload(G, p, def, sfx) {
  const a = p.ammo[def.id];
  if (p.reloadT > 0 || a.mag >= def.mag || a.reserve <= 0) return;
  p.reloadT = def.id === 'sniper' ? 2.6 : 1.9;
  sfx.reload();
}

export function nearSite(p) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) return key;
  }
  return null;
}

// Buy a shop item for the player. Returns a message for the HUD.
export function buyItem(G, id, sfx) {
  const p = G.player;
  if (G.phase !== 'buy') return 'Buy menu is only open during the buy phase.';
  if (id === 'grenade') {
    if (p.grenades >= 3) return 'You already carry 3 frags.';
    if (p.money < GRENADE.price) return 'Not enough money.';
    p.money -= GRENADE.price;
    p.grenades++;
    sfx.buy();
    return 'FRAG-9 bought.';
  }
  if (id === 'armor') {
    if (p.armor) return 'You already wear kevlar.';
    if (p.money < 650) return 'Not enough money.';
    p.money -= 650;
    p.armor = true;
    sfx.buy();
    return 'Kevlar vest bought.';
  }
  const def = WEAPONS[id];
  if (!def) return 'Unknown item.';
  if (p.weapons.includes(id)) return 'You already own that weapon.';
  if (p.money < def.price) return 'Not enough money.';
  p.money -= def.price;
  p.weapons.push(id);
  p.ammo[id] = { mag: def.mag, reserve: def.reserve };
  p.current = p.weapons.length - 1;
  sfx.buy();
  return `${def.name} bought.`;
}
