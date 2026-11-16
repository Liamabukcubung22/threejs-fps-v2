# DUSTFALL — Verification Results (threejs-fps-02 round 2)

**Game:** DUSTFALL — a three.js tactical FPS, 5v5, round-based, Counter-Strike-style.
Two teams (DUSTERS attackers, amber; WARDENS defenders, teal) fight round-based
matches on the original map "Kestrel Foundry" (60×40 m, three lanes, two bomb
sites A and B). Attackers plant the device (hold E, 3 s) and defenders defuse
it (hold E, 5 s, 35 s fuse); a round also ends by elimination. Between rounds
there is a buy menu with money: weapons (P9 Sidearm free, VK-9 Carbine $1500,
AR-77 Longshot $2700, M90 Marksman $4750), FRAG-9 grenade $300, Kevlar $650.
Round economy: start $800, win $3250, loss $1900, kill/plant/defuse $300.
Nine bots play alongside the player (4 friendly, 5 enemy) with waypoint
routing, line-of-sight + hearing perception, burst fire, planting and
defusing. Gunfire is built so accuracy matters more than speed: spread grows
while moving and shrinks while crouched or standing still, headshots deal
2.5× damage, and the buy menu itself says so ("stop moving before you shoot
— accuracy beats speed"). Map, name, art, and all sounds (WebAudio
synthesis) are original. The game runs offline from static files, no console
error, no failed request, no external request.

**Freshness:** this repo was created first with `makefun init` (anchor
`bee17308f03abc9635b4c43f079c8d17eda94bea`, round 34013081) and every line of
game code was written from scratch in that session — nothing was read from
the round 1 entry, its dev folder, or the kit starter.

## Headless play-test (Playwright + Chromium, real keyboard/mouse)

Full suite: **24/24 checks PASS** (run 17 Nov 2026 ~00:10 WIB, and re-run
after the final staging change — same result).

- Smoke: game boots, canvas + HUD, WebGL2, 9 bots spawned.
- Start: Play begins (buy phase, HUD on, pointer lock).
- Move: W walks the player (4.20 m; a furnace pillar stops the walk —
  collision works). Look: arrow-key turn moves yaw 0.00 → 1.38.
- Round: buy → live transition works.
- Shoot: mouse click fires (ammo 12 → 11); aimed shot damages a bot
  (hp 100 → 40, a pistol headshot: 24 × 2.5 = 60 damage).
- Reload: mag refills to 12.
- Buy: menu opens in buy phase; rifle bought, money $3000 → $300.
- Grenade: throw consumes one and spawns a live grenade; it explodes after
  the 2.6 s fuse.
- Plant: hold E at Site A plants the device (state `planted`, site A,
  timer 33.7 s).
- Defuse: with all attackers down, defenders converge on Site A and defuse
  (state `defused`, winner `def`, phase `end`) — verified in the full
  sequence and in an isolated probe with per-5-second traces.
- Bots: fight each other without the player (kills and damage in the feed).
- Round: eliminating the defenders wins the round (phase `end`, score 5–2).
- Match: 5 rounds ends the match with overlay ("DUSTERS WIN", 5–2).
- All 4 `?scene=` stagings render; no console errors / pageerrors;
  no failed requests; no external requests.

## Bugs found and fixed during verification

- Waypoint graph edges crossed walls: the plaza-to-site edges ran straight
  through the site pillars, so bots pushed against a pillar face forever and
  never reached the bomb (defuse failed in the full sequence while working
  in isolation). Fixed by moving crates/pillars off the lanes and routing
  site approaches via the lane nodes; verified with a Euclidean-clearance
  edge check (`dev/edge-check.mjs`, all edges ≥ 0.5 m clear of every wall,
  bot radius 0.42 m). Defuse now works in the full sequence.
- Shots passed through walls (wall meshes lacked the raycast flag);
  `G.input` missed look deltas (NaN yaw); bot hit-mesh reference was wrong;
  arrow-key turn was consumed every tick; two waypoint nodes sat inside a
  wall footprint; sim raycasts depended on renderer matrix updates.
  All fixed in game code; each fix was re-proven by the play-test.

## Determinism

`MAKEFUN_OUTPUT_DIR=out1 node main.ts` and `MAKEFUN_OUTPUT_DIR=out2 node
main.ts`, then `diff -r out1 out2`: **byte-identical** (dossier.json
334,815 bytes in both runs).

## Sizes (kit limits)

- `game/`: 14 files, 2,220,582 bytes (limit 993 files / 48 MiB)
- `game/index.html`: 10,912 bytes (limit 1 MiB)
- Source text (`main.ts` + `game/src/*.js` + `README.md`): 79,339 bytes
  (limit 160 KiB)
- Screenshots: 4 JPEG, 1280×720 each — 1-cover.jpg 42,832 B,
  2-buy.jpg 60,498 B, 3-plant.jpg 52,051 B, 4-end.jpg 28,282 B
  (limit 4 files / 256 KiB each)
- `dossier.json`: 334,815 bytes (limit 1.5 MiB)
- Symlinks in the repo: 0. External requests at runtime: 0 (verified in
  the play-test; the only `http…` strings anywhere in `game/` are URLs in
  comments inside the vendored three.js files, plus the SVG namespace
  string — no network fetch).
- three.js 0.187.0 vendored (hash-verified against the kit).

## Screenshots

All four are real renders of this game, taken headless at 1280×720
(JPEG q80, no page errors):
1-cover.jpg — live firefight, HUD, kill feed, bots in view;
2-buy.jpg — buy menu with all six items and prices;
3-plant.jpg — device planted at Site A, a Warden mid-defuse in the
crosshair; 4-end.jpg — "DUSTERS WIN 5–2" match-end overlay.
