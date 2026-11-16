# DUSTFALL — Tactical FPS

A three.js tactical FPS, 5v5 and round-based, in the style Counter-Strike
made famous — with its own map, names, art and sounds.

You are a **Duster** fighting the **Wardens** on **Kestrel Foundry**, a dusty
abandoned foundry yard with three lanes (west, mid, east) and two bomb
sites, A and B. Plant the device at a site or eliminate the other team.
Win rounds, earn dollars, and spend them in the buy menu between rounds.
First to 5 rounds takes the match.

Gunfire rewards accuracy over speed: standing still is far more accurate
than firing on the move, every shot adds bloom, and headshots deal 2.5×
damage. Bots follow routes through the map, hold positions, react to what
they see and hear, and fight each other too — a round can be won or lost
without you firing a shot.

## How to run

Serve `game/` with any static file server and open `index.html` in desktop
Chrome, for example:

```sh
cd game
python3 -m http.server 8080
# open http://localhost:8080 in Chrome
```

The game runs fully offline from static files — no network requests, no
build step. three.js 0.187.0 is vendored under `game/vendor/three/`.

To build the submission output (what `main.ts` hands in):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That copies `game/` and `screenshots/` into `out/` and writes
`out/dossier.json`. Run it twice and the bytes are identical.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to capture the mouse) |
| Click | Fire |
| R | Reload |
| 1 / 2 / 3 | Switch weapon |
| 4 / G | Throw frag grenade |
| C / Ctrl | Crouch |
| Shift | Walk slowly (steadier aim) |
| E (hold) | Plant the device (inside Site A or B) |
| B | Buy menu (buy phase only) |
| ← → | Turn (if you play without a mouse) |

## The shop

| Item | Price |
| --- | --- |
| P9 Sidearm | free |
| VK-9 Carbine (SMG) | $1,500 |
| AR-77 Longshot (rifle) | $2,700 |
| M90 Marksman (sniper) | $4,750 |
| FRAG-9 grenade | $300 |
| Kevlar vest (−30% damage) | $650 |

Round win pays $3,250, a loss $1,900, a kill $300, a plant $300.
Weapons stay with you while you survive the round.

## Files

- `game/index.html` — page, HUD and buy menu
- `game/src/main.js` — bootstrap, fixed-step loop, rendering
- `game/src/state.js` — weapon/team definitions and the single game state
- `game/src/world.js` — the Kestrel Foundry map, collision, waypoints
- `game/src/player.js` — movement, shooting, reload, plant
- `game/src/bots.js` — bot AI: routes, holds, sight, hearing, bursts
- `game/src/weapons.js` — raycast shooting, tracers, grenades, damage
- `game/src/rounds.js` — round/match state machine and economy
- `game/src/hud.js` — DOM HUD and shop
- `game/src/input.js` — keyboard, mouse, pointer lock
- `game/src/audio.js` — synthesized WebAudio sounds (no audio files)
- `main.ts` — the entry program: copies the game and writes the dossier
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `screenshots/` — real renders of the game

## License

MIT — see `LICENSE`.
