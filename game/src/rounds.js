// rounds.js — the match state machine: buy phase, live round, plant and
// defuse, detonation, round money and the first-to-5 match. One function
// owns every transition so the rules live in exactly one place.
import { ROUND, WEAPONS } from './state.js';
import { SITES } from './world.js';

export function startMatch(G, bots, hooks) {
  G.matchOver = false;
  G.winner = null;
  G.score.atk = 0;
  G.score.def = 0;
  G.roundNumber = 1;
  G.player.money = ROUND.START_MONEY;
  G.player.kills = 0;
  G.player.deaths = 0;
  startRound(G, bots, hooks);
  hooks.banner('MATCH START', 'First to 5 rounds takes Kestrel Foundry.');
}

export function startRound(G, bots, hooks) {
  const p = G.player;
  // survivors keep their guns; the dead re-buy from the pistol
  if (!p.alive) {
    p.weapons = ['pistol'];
    p.current = 0;
    p.ammo = { pistol: { mag: 12, reserve: 48 } };
    p.armor = false;
    p.grenades = 0;
  }
  p.hp = 100;
  p.alive = true;
  p.x = 0; p.z = 16; p.y = 1.62;
  p.yaw = 0; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.bloom = 0; p.reloadT = 0;
  p.plantT = 0; p.defuseT = 0;
  G.bomb = { state: 'held', site: null, x: 0, z: 0, timer: 0,
    carrier: null, plantT: 0, defuseT: 0, planter: null, defuser: null };
  if (hooks.clearGrenades) hooks.clearGrenades();
  bots.spawnAll(G);
  bots.assignRound(G);
  G.phase = 'buy';
  G.phaseT = ROUND.BUY_SECONDS;
  G.roundWinner = null;
  G.roundReason = '';
  hooks.onRoundStart(G.roundNumber);
}

export function updateRounds(G, dt, hooks) {
  if (G.matchOver) return;
  if (G.phase === 'buy') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      G.phase = 'live';
      G.phaseT = ROUND.LIVE_SECONDS;
      hooks.banner(`ROUND ${G.roundNumber}`, 'Plant the device or eliminate the Wardens.');
    }
    return;
  }
  if (G.phase === 'live') {
    G.phaseT -= dt;
    if (G.bomb.state === 'planted') {
      G.bomb.timer -= dt;
      if (G.bomb.timer <= 0) {
        endRound(G, 'atk', 'DEVICE DETONATED', hooks);
        return;
      }
    } else if (G.phaseT <= 0) {
      endRound(G, 'def', 'TIME EXPIRED — SITE HELD', hooks);
      return;
    }
    checkElimination(G, hooks);
    return;
  }
  if (G.phase === 'end') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      if (G.score.atk >= ROUND.WIN_ROUNDS || G.score.def >= ROUND.WIN_ROUNDS) {
        G.matchOver = true;
        G.winner = G.score.atk > G.score.def ? 'atk' : 'def';
        hooks.onMatchEnd(G.winner, G.score);
      } else {
        G.roundNumber++;
        startRound(G, hooks.bots, hooks);
      }
    }
  }
}

function checkElimination(G, hooks) {
  const atkAlive = G.player.alive || G.bots.some((b) => b.alive && b.team === 'atk');
  const defAlive = G.bots.some((b) => b.alive && b.team === 'def');
  if (!defAlive) {
    endRound(G, 'atk', 'WARDENS ELIMINATED', hooks);
    return;
  }
  if (!atkAlive && G.bomb.state !== 'planted') {
    endRound(G, 'def', 'DUSTERS ELIMINATED', hooks);
  }
}

export function endRound(G, winner, reason, hooks) {
  if (G.phase === 'end' || G.matchOver) return;
  G.phase = 'end';
  G.phaseT = ROUND.END_SECONDS;
  G.roundWinner = winner;
  G.roundReason = reason;
  G.score[winner]++;
  // round economy
  if (winner === 'atk') {
    G.player.money += ROUND.WIN_MONEY;
  } else {
    G.player.money += ROUND.LOSS_MONEY;
  }
  if (winner === 'atk') hooks.sfx.roundWin(); else hooks.sfx.roundLose();
  hooks.banner(
    winner === 'atk' ? 'DUSTERS TAKE THE ROUND' : 'WARDENS TAKE THE ROUND',
    `${reason}  ·  ${G.score.atk} — ${G.score.def}`);
  hooks.onRoundEnd(winner, reason);
}

export function plantBomb(G, site, planter, hooks) {
  if (G.bomb.state !== 'held' || G.phase !== 'live') return;
  const s = SITES[site];
  G.bomb.state = 'planted';
  G.bomb.site = site;
  G.bomb.x = s.x;
  G.bomb.z = s.z;
  G.bomb.timer = ROUND.BOMB_SECONDS;
  G.bomb.planter = planter;
  if (planter === G.player) {
    G.player.money += ROUND.PLANT_MONEY;
    hooks.sfx.plantBeep();
  }
  hooks.banner('DEVICE PLANTED', `Site ${site} — ${ROUND.BOMB_SECONDS}s to detonation.`);
  hooks.onPlant(site);
}

export function defuseBomb(G, defuser, hooks) {
  if (G.bomb.state !== 'planted') return;
  G.bomb.state = 'defused';
  G.bomb.defuser = defuser;
  if (defuser === G.player) G.player.money += ROUND.DEFUSE_MONEY;
  endRound(G, 'def', 'DEVICE DEFUSED', hooks);
}
