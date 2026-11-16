// world.js — the Kestrel Foundry map: geometry, collision, waypoints.
// Original map: a dusty abandoned foundry yard. Three lanes (west, mid,
// east) join a south plaza (Dusters spawn) to a north plaza holding
// Site A (west) and Site B (east). Crates and pillars break sightlines.
import * as THREE from 'three';

// A wall / crate: axis-aligned box in the XZ plane, height h.
// {x0, z0, x1, z1, h, mat} — mat picks the palette entry.
const WALLS = [
  // perimeter (h 4)
  { x0: -31, z0: -21, x1: 31, z1: -20, h: 4, mat: 'concrete' },
  { x0: -31, z0: 20, x1: 31, z1: 21, h: 4, mat: 'concrete' },
  { x0: -31, z0: -20, x1: -30, z1: 20, h: 4, mat: 'concrete' },
  { x0: 30, z0: -20, x1: 31, z1: 20, h: 4, mat: 'concrete' },
  // lane dividers, middle band only — lanes join at both plazas
  { x0: -12, z0: -8, x1: -11, z1: 8, h: 3.2, mat: 'rust' },
  { x0: 11, z0: -8, x1: 12, z1: 8, h: 3.2, mat: 'rust' },
  // mid: central foundry block breaks the long sightline
  { x0: -2.5, z0: -2.5, x1: 2.5, z1: 2.5, h: 2.6, mat: 'furnace' },
  // north plaza: site back walls + pillars
  { x0: -28, z0: -16.5, x1: -16, z1: -15.5, h: 3, mat: 'concrete' },
  { x0: 16, z0: -16.5, x1: 28, z1: -15.5, h: 3, mat: 'concrete' },
  { x0: -15, z0: -13, x1: -13, z1: -11, h: 4, mat: 'pillar' },
  { x0: 13, z0: -13, x1: 15, z1: -11, h: 4, mat: 'pillar' },
  // south plaza furnace stack (kept off the mid lane from spawn)
  { x0: 4, z0: 11, x1: 7, z1: 13.5, h: 4, mat: 'furnace' },
  // low crates (h 1.2 — waist-high cover: they block movement and shots
  // below 1.2 m, while a standing eye sees over them).
  // Every crate sits clear of the waypoint lanes: a bot walks its edges
  // in straight lines, so no crate may touch a lane (verified with the
  // edge check in dev/edge-check.mjs).
  { x0: -24, z0: 5, x1: -21, z1: 7, h: 1.2, mat: 'crate' },
  { x0: 21, z0: 4, x1: 24, z1: 6, h: 1.2, mat: 'crate' },
  { x0: -25, z0: -5, x1: -22, z1: -3, h: 1.2, mat: 'crate' },
  { x0: 22, z0: -5, x1: 25, z1: -3, h: 1.2, mat: 'crate' },
  { x0: -6, z0: -18.5, x1: -3, z1: -17, h: 1.2, mat: 'crate' },
  { x0: 4, z0: -15, x1: 7, z1: -13, h: 1.2, mat: 'crate' },
  { x0: -9, z0: 6, x1: -7, z1: 8, h: 1.2, mat: 'crate' },
  { x0: 7, z0: 6, x1: 9, z1: 8, h: 1.2, mat: 'crate' },
  { x0: -11, z0: -6, x1: -9, z1: -4, h: 1.2, mat: 'crate' },
  { x0: -24, z0: -6, x1: -21, z1: -4, h: 1.2, mat: 'crate' },
  { x0: 21, z0: -6, x1: 24, z1: -4, h: 1.2, mat: 'crate' },
  { x0: 8, z0: 16, x1: 12, z1: 17.5, h: 1.2, mat: 'crate' },
];

export const SITES = {
  A: { x: -22, z: -12, r: 4.5, label: 'A' },
  B: { x: 22, z: -12, r: 4.5, label: 'B' },
};
export const SPAWNS = {
  atk: [ { x: -6, z: 16 }, { x: -3, z: 17 }, { x: 0, z: 16 }, { x: 3, z: 17 }, { x: 6, z: 16 } ],
  def: [ { x: -6, z: -16 }, { x: -3, z: -17 }, { x: 0, z: -16 }, { x: 3, z: -17 }, { x: 6, z: -16 } ],
};

// Waypoint graph. Nodes are open ground; edges never cross a wall.
const NODES = [
  [0, 16], [-16, 14], [16, 14], [0, 10],          // 0-3 south plaza
  [-20, 10], [-20, 0], [-20, -6], [-20, -10],     // 4-7 west lane
  [-22, -12],                                     // 8 site A
  [20, 10], [20, 0], [20, -6], [20, -10],         // 9-12 east lane
  [22, -12],                                      // 13 site B
  [-6, 4], [6, 4], [-6, -4], [6, -4],             // 14-17 mid sides
  [0, -10], [-10, -12], [10, -12], [0, -16],      // 18-21 north plaza
  [-14, -17], [14, -17],                          // 22-23 defender corners
  // NOTE: the corners sit at x=±14, clear of the site back walls
  // (x=∓16..∓28, z=-16.5..-15.5) — a waypoint inside a wall's footprint
  // can never be reached and strands the bot following it.
];
// NOTE: the plaza-to-site edges route around the site pillars
// (x=∓15..∓13, z=-13..-11) via the lane nodes 6/11: the direct edges
// crossed straight through the pillars and stranded bots against them.
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 4], [2, 9], [3, 14], [3, 15],
  [4, 5], [5, 6], [6, 7], [6, 19], [6, 8],
  [9, 10], [10, 11], [11, 12], [11, 20], [11, 13],
  [14, 16], [15, 17], [14, 3], [15, 3], [16, 18], [17, 18],
  [16, 19], [17, 20], [18, 19], [18, 20], [18, 21],
  [19, 22], [20, 23], [21, 22], [21, 23],
];
export const SITE_NODE = { A: 8, B: 13 };
export const SPAWN_NODE = { atk: 0, def: 21 };

// Palette — dusty ochre ground, rust containers, teal accents, warm sun.
const PALETTE = {
  ground: 0xb99b6b, concrete: 0x8a7f70, rust: 0x9c4a28, furnace: 0x5d4a3a,
  pillar: 0x6e6258, crate: 0xa8763e, trim: 0x2e6f6a,
};

function letterTexture(letter, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, 112, 112);
  g.fillStyle = fg; g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(letter, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.walls = WALLS;
    this.colliders = [];
    this.wallMeshes = [];
    this.build(scene);
  }

  build(scene) {
    // sky + lights
    scene.background = new THREE.Color(0xd9a86c);
    scene.fog = new THREE.Fog(0xd9a86c, 55, 130);
    const hemi = new THREE.HemisphereLight(0xffe6bf, 0x4a3a28, 0.95);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    sun.position.set(30, 45, 20);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fc8ff, 0.25);
    fill.position.set(-20, 30, -25);
    scene.add(fill);

    // ground
    const groundMat = new THREE.MeshLambertMaterial({ color: PALETTE.ground });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = false;
    scene.add(ground);
    // dusty patches: darker flat quads scattered on the ground
    const patchMat = new THREE.MeshLambertMaterial({ color: 0x9c7f55 });
    const patchGeo = new THREE.PlaneGeometry(6, 4);
    for (const [px, pz, r] of [[-14, 6, 0.4], [12, -2, 1.1], [2, -12, 0.7], [-24, 2, 1.9], [18, 12, 0.2], [-4, -16, 2.4]]) {
      const p = new THREE.Mesh(patchGeo, patchMat);
      p.rotation.x = -Math.PI / 2; p.rotation.z = r;
      p.position.set(px, 0.01, pz);
      scene.add(p);
    }

    const mats = {};
    for (const k of Object.keys(PALETTE)) {
      if (k === 'ground') continue;
      mats[k] = new THREE.MeshLambertMaterial({ color: PALETTE[k] });
    }
    const trimMat = new THREE.MeshLambertMaterial({ color: PALETTE.trim });
    for (const w of WALLS) {
      const geo = new THREE.BoxGeometry(w.x1 - w.x0, w.h, w.z1 - w.z0);
      const m = new THREE.Mesh(geo, mats[w.mat]);
      m.position.set((w.x0 + w.x1) / 2, w.h / 2, (w.z0 + w.z1) / 2);
      // marks the mesh as a shot-blocker for the raycast in weapons.js
      m.userData.wall = true;
      scene.add(m);
      this.wallMeshes.push(m);
      this.colliders.push(w);
      // teal trim on tall walls so lanes read at a glance
      if (w.h >= 3) {
        const trim = new THREE.Mesh(
          new THREE.BoxGeometry(w.x1 - w.x0 + 0.06, 0.18, w.z1 - w.z0 + 0.06), trimMat);
        trim.position.set((w.x0 + w.x1) / 2, w.h - 0.09, (w.z0 + w.z1) / 2);
        scene.add(trim);
      }
    }

    // site decals: painted A / B rings on the ground
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      const tex = letterTexture(key, 'rgba(46,111,106,0.85)', '#ffe9b0');
      const decal = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.set(s.x, 0.02, s.z);
      scene.add(decal);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(s.r - 0.15, s.r, 48),
        new THREE.MeshBasicMaterial({ color: 0x2e6f6a, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(s.x, 0.03, s.z);
      scene.add(ring);
    }
  }

  // Push a circle (x, z, radius r) out of every wall it overlaps.
  // Returns nothing; mutates the passed {x, z} object in place.
  resolveCircle(p, r) {
    for (const w of this.colliders) {
      const cx = Math.max(w.x0, Math.min(p.x, w.x1));
      const cz = Math.max(w.z0, Math.min(p.z, w.z1));
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration
        const pl = p.x - w.x0, pr = w.x1 - p.x, pt = p.z - w.z0, pb = w.z1 - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = w.x0 - r;
        else if (m === pr) p.x = w.x1 + r;
        else if (m === pt) p.z = w.z0 - r;
        else p.z = w.z1 + r;
      }
    }
    // clamp to the yard
    p.x = Math.max(-29.5, Math.min(29.5, p.x));
    p.z = Math.max(-19.5, Math.min(19.5, p.z));
  }

  // Line of sight between two eye positions, blocked by any wall mesh.
  // Reuses one raycaster and scratch vectors; no allocation per call.
  hasLOS(ray, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.001) return true;
    World._o.set(ax, ay, az);
    World._d.set(dx / dist, dy / dist, dz / dist);
    ray.set(World._o, World._d);
    ray.far = dist;
    return ray.intersectObjects(this.wallMeshes, false).length === 0;
  }

  nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < NODES.length; i++) {
      const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // BFS shortest path of node indices from `from` to `to`.
  findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(NODES.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    const adj = World._adj;
    while (queue.length) {
      const n = queue.shift();
      if (n === to) break;
      for (const m of adj[n]) {
        if (prev[m] === -1) { prev[m] = n; queue.push(m); }
      }
    }
    if (prev[to] === -1) return [to];
    const path = [];
    let cur = to;
    while (cur !== from) { path.push(cur); cur = prev[cur]; }
    path.push(from);
    path.reverse();
    return path;
  }
}

// adjacency + LOS scratch vectors, built once
World._o = new THREE.Vector3();
World._d = new THREE.Vector3();
World._adj = NODES.map(() => []);
for (const [a, b] of EDGES) { World._adj[a].push(b); World._adj[b].push(a); }
export { NODES };
