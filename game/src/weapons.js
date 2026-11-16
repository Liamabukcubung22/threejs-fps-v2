// weapons.js — shooting, damage and grenades, shared by the player and bots.
// A shot is a ray from the muzzle: spread grows while moving and with bloom
// (each shot adds bloom, waiting sheds it), so stopping to aim pays.
// Head hits deal 2.5x damage. Tracers and flashes come from a fixed pool —
// nothing is allocated per shot in the hot path.
import * as THREE from 'three';
import { GRENADE } from './state.js';

const TRACER_POOL = 24;
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up2 = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

export class Combat {
  constructor(scene, world, sfx, hooks) {
    this.scene = scene;
    this.world = world;
    this.sfx = sfx;
    this.hooks = hooks; // { onKill(victim, attacker, head), onPlayerDamage(amount) }
    this.ray = new THREE.Raycaster();
    this.ray.far = 160;
    this.shootables = [];
    // tracer pool
    this.tracers = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < TRACER_POOL; i++) {
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo.clone(), mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;
    // muzzle flash light (reused)
    this.flash = new THREE.PointLight(0xffc46e, 0, 9, 1.6);
    scene.add(this.flash);
    this.flashT = 0;
    // explosion flash (reused)
    this.boomLight = new THREE.PointLight(0xff7a2a, 0, 22, 1.4);
    scene.add(this.boomLight);
    this.boomT = 0;
    const boomGeo = new THREE.SphereGeometry(1, 12, 10);
    this.boomMesh = new THREE.Mesh(boomGeo,
      new THREE.MeshBasicMaterial({ color: 0xffa04e, transparent: true, opacity: 0 }));
    this.boomMesh.visible = false;
    scene.add(this.boomMesh);
    this.grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
    this.grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2c3a24 });
  }

  rebuildShootables(bots) {
    this.shootables = [...this.world.wallMeshes];
    for (const b of bots) {
      if (!b.alive) continue;
      for (const m of b.mesh.hitMeshes) this.shootables.push(m);
    }
  }

  // Fire one shot. `shooter` is the player object or a bot; `target` is only
  // used for the analytic player-capsule test when a bot shoots the player.
  fire(G, shooter, def, ox, oy, oz, dx, dy, dz, opts = {}) {
    const moving = shooter.speed > 0.6;
    const crouch = shooter.crouch;
    let spread = def.spread * (moving ? def.moveSpread : 1) * (crouch ? 0.7 : 1)
      + shooter.bloom + (opts.extraSpread || 0);
    // perturb the direction inside a small cone
    _d.set(dx, dy, dz).normalize();
    const r1 = (Math.random() * 2 - 1) * spread;
    const r2 = (Math.random() * 2 - 1) * spread;
    // build an orthonormal basis around the direction (scratch vectors only)
    if (Math.abs(_d.y) > 0.9) _up.set(1, 0, 0); else _up.set(0, 1, 0);
    _right.crossVectors(_d, _up).normalize();
    _up2.crossVectors(_right, _d).normalize();
    _d.addScaledVector(_right, r1).addScaledVector(_up2, r2).normalize();
    _o.set(ox, oy, oz);

    this.ray.set(_o, _d);
    this.ray.far = def.range;
    const hits = this.ray.intersectObjects(this.shootables, false);
    let endDist = def.range;
    let hitBot = null, hitPart = null, hitPoint = null;
    for (const h of hits) {
      if (h.object.userData.wall) { endDist = h.distance; break; }
      const b = h.object.userData.bot;
      if (b && b !== shooter && b.alive) { hitBot = b; hitPart = h.object.userData.part; hitPoint = h.point; endDist = h.distance; break; }
    }
    // player capsule test (bots shooting the player)
    let hitPlayer = false, hitPlayerHead = false;
    if (shooter !== G.player && G.player.alive) {
      const res = this._rayCapsule(_o, _d, G.player);
      if (res && res.dist < endDist) {
        hitPlayer = true; hitPlayerHead = res.head;
        endDist = res.dist; hitPoint = res.point;
      }
    }
    _p.copy(_o).addScaledVector(_d, endDist);
    this.spawnTracer(_o, _p, def.tracer);
    this.flash.position.copy(_o);
    this.flash.intensity = 14;
    this.flashT = 0.05;
    const dist = Math.sqrt((ox - G.player.x) ** 2 + (oy - G.player.y) ** 2 + (oz - G.player.z) ** 2);
    this.sfx.shot(def.sound, Math.max(0.08, 1 - dist / 55));

    if (hitBot) {
      const dmg = def.damage * (hitPart === 'head' ? def.headMult : 1);
      this.applyDamage(G, hitBot, dmg, hitPart === 'head', shooter);
      return { hit: hitPart, target: hitBot, point: hitPoint };
    }
    if (hitPlayer) {
      const dmg = def.damage * (hitPlayerHead ? def.headMult : 1);
      this.applyDamage(G, G.player, dmg, hitPlayerHead, shooter);
      return { hit: hitPlayerHead ? 'head' : 'body', target: G.player, point: hitPoint };
    }
    return { hit: endDist < def.range ? 'wall' : 'none', point: _p };
  }

  // Closest approach of a ray to the player's standing capsule (r 0.42,
  // y 0..1.7; head is y > 1.42). Returns {dist, head, point} or null.
  _rayCapsule(o, d, player) {
    // sample the capsule axis in 5 slices; cheap and exact enough
    let best = null;
    for (let i = 0; i <= 4; i++) {
      const y = 0.15 + (i / 4) * 1.5;
      const cx = player.x, cz = player.z;
      const px = cx - o.x, py = y - o.y, pz = cz - o.z;
      const t = px * d.x + py * d.y + pz * d.z;
      if (t < 0) continue;
      const qx = o.x + d.x * t, qy = o.y + d.y * t, qz = o.z + d.z * t;
      const dd = Math.sqrt((qx - cx) ** 2 + (qy - y) ** 2 + (qz - cz) ** 2);
      if (dd < 0.42 && (!best || t < best.dist)) {
        _hitPoint.set(qx, qy, qz);
        best = { dist: t, head: y > 1.42, point: _hitPoint };
      }
    }
    return best;
  }

  applyDamage(G, target, amount, isHead, attacker) {
    if (!target.alive) return;
    let dmg = amount;
    if (target === G.player && target.armor) dmg *= 0.7;
    target.hp -= dmg;
    if (target === G.player) this.hooks.onPlayerDamage(dmg);
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      if (attacker === G.player) {
        G.player.money += 300;
        G.player.kills++;
      }
      this.hooks.onKill(target, attacker, isHead);
    }
  }

  spawnTracer(from, to, color) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % TRACER_POOL;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.07;
  }

  throwGrenade(G, owner, ox, oy, oz, dx, dy, dz) {
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.position.set(ox, oy, oz);
    this.scene.add(mesh);
    const g = {
      mesh, owner,
      x: ox, y: oy, z: oz,
      vx: dx * 13, vy: dy * 13 + 3.5, vz: dz * 13,
      fuse: GRENADE.fuse, bounced: false,
    };
    G.grenades.push(g);
    this.sfx.bounce();
  }

  updateGrenades(G, dt) {
    for (let i = G.grenades.length - 1; i >= 0; i--) {
      const g = G.grenades[i];
      g.vy -= 18 * dt;
      const px = g.x, pz = g.z;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const p = { x: g.x, z: g.z };
      this.world.resolveCircle(p, 0.12);
      if (p.x !== g.x || p.z !== g.z) {
        // bounced off a wall: reflect the horizontal velocity
        const nx = p.x - px, nz = p.z - pz;
        const nl = Math.hypot(nx, nz) || 1;
        const dot = g.vx * (nx / nl) + g.vz * (nz / nl);
        g.vx -= 2 * dot * (nx / nl);
        g.vz -= 2 * dot * (nz / nl);
        g.vx *= 0.55; g.vz *= 0.55;
        g.x = p.x; g.z = p.z;
        this.sfx.bounce();
      }
      if (g.y < 0.12) {
        g.y = 0.12;
        g.vy = Math.abs(g.vy) * 0.45;
        g.vx *= 0.7; g.vz *= 0.7;
        if (Math.abs(g.vy) > 1) this.sfx.bounce();
      }
      g.mesh.position.set(g.x, g.y, g.z);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.explode(G, g);
        this.scene.remove(g.mesh);
        G.grenades.splice(i, 1);
      }
    }
    // decay flashes
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
    if (this.boomT > 0) {
      this.boomT -= dt;
      const k = Math.max(0, this.boomT / 0.4);
      this.boomLight.intensity = 40 * k;
      this.boomMesh.material.opacity = 0.55 * k;
      const s = 1 + (1 - k) * GRENADE.radius * 1.4;
      this.boomMesh.scale.set(s, s, s);
      if (this.boomT <= 0) { this.boomLight.intensity = 0; this.boomMesh.visible = false; }
    }
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
  }

  explode(G, g) {
    this.sfx.explosion();
    this.boomMesh.position.set(g.x, Math.max(0.6, g.y), g.z);
    this.boomMesh.visible = true;
    this.boomLight.position.set(g.x, g.y + 1, g.z);
    this.boomT = 0.4;
    const hurt = (ent, ex, ez, ey) => {
      if (!ent.alive) return;
      const d = Math.hypot(ent.x - ex, (ent.y ?? 1) - ey, ent.z - ez);
      if (d > GRENADE.radius) return;
      const dmg = GRENADE.damage * (1 - d / (GRENADE.radius + 1.5));
      this.applyDamage(G, ent, dmg, false, g.owner);
    };
    hurt(G.player, g.x, g.z, 1.0);
    for (const b of G.bots) hurt(b, g.x, g.z, 1.0);
    // camera shake for the player
    const pd = Math.hypot(G.player.x - g.x, G.player.z - g.z);
    if (pd < 14) this.hooks.onShake(Math.max(0.15, 1 - pd / 14));
  }
}
