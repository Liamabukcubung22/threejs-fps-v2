// hud.js — everything drawn in the DOM: health, ammo, money, timer,
// score, kill feed, crosshair spread, banners, the buy menu and overlays.
// The sim never touches the DOM directly; it calls these methods.
import { WEAPONS, GRENADE, ARMOR, ROUND } from './state.js';

const $ = (id) => document.getElementById(id);

export const SHOP = [
  { key: '1', id: 'pistol', name: 'P9 SIDEARM', desc: 'Reliable sidearm. Free, always with you.', price: 0 },
  { key: '2', id: 'smg', name: 'VK-9 CARBINE', desc: 'Fast close-quarters spray. 28-round mag.', price: WEAPONS.smg.price },
  { key: '3', id: 'rifle', name: 'AR-77 LONGSHOT', desc: 'Accurate rifle. Stopping to aim pays off.', price: WEAPONS.rifle.price },
  { key: '4', id: 'sniper', name: 'M90 MARKSMAN', desc: 'One-shot precision at long range. Slow.', price: WEAPONS.sniper.price },
  { key: '5', id: 'grenade', name: 'FRAG-9 GRENADE', desc: 'Thrown explosive. G or 4 to throw.', price: GRENADE.price },
  { key: '6', id: 'armor', name: 'KEVLAR VEST', desc: 'Takes 30% off every hit this round.', price: ARMOR.price },
];

export class Hud {
  constructor(G, hooks) {
    this.G = G;
    this.hooks = hooks; // { onBuy(id), onPlay(), onRestart() }
    this.buyOpen = false;
    this.hitT = 0;
    this.dmgT = 0;
    this.bannerT = 0;
    this._buildShop();
    window.addEventListener('keydown', (e) => {
      if (!this.buyOpen) return;
      const item = SHOP.find((s) => s.key === e.code.replace('Digit', ''));
      if (item) this.hooks.onBuy(item.id);
    });
    $('playBtn').addEventListener('click', () => this.hooks.onPlay());
    $('againBtn').addEventListener('click', () => this.hooks.onRestart());
  }

  _buildShop() {
    const shop = $('shop');
    shop.innerHTML = '';
    for (const item of SHOP) {
      const row = document.createElement('div');
      row.className = 'shopRow';
      row.dataset.id = item.id;
      row.innerHTML = `<span class="k">${item.key}</span><span class="n">${item.name}</span>` +
        `<span class="d">${item.desc}</span><span class="p">$${item.price}</span>`;
      row.addEventListener('click', () => this.hooks.onBuy(item.id));
      shop.appendChild(row);
    }
  }

  refreshShop() {
    const G = this.G, p = G.player;
    for (const row of document.querySelectorAll('.shopRow')) {
      const id = row.dataset.id;
      const owned = id === 'pistol' || p.weapons.includes(id)
        || (id === 'armor' && p.armor);
      const afford = id === 'grenade'
        ? p.money >= GRENADE.price && p.grenades < 3
        : id === 'armor' ? p.money >= ARMOR.price && !p.armor
        : id === 'pistol' ? true
        : p.money >= WEAPONS[id].price && !p.weapons.includes(id);
      row.classList.toggle('owned', owned);
      row.classList.toggle('cant', !afford && !owned);
      const priceEl = row.querySelector('.p');
      if (id === 'grenade' && p.grenades > 0) priceEl.textContent = `×${p.grenades} · $${GRENADE.price}`;
      else if (owned) priceEl.textContent = 'OWNED';
      else priceEl.textContent = `$${SHOP.find((s) => s.id === id).price}`;
    }
    $('buyMoney').textContent = `$${p.money}`;
  }

  setBuyOpen(open) {
    this.buyOpen = open;
    $('buy').classList.toggle('on', open);
    if (open) this.refreshShop();
  }

  showStart(paused) {
    $('start').classList.remove('hidden');
    if (paused) {
      document.querySelector('#start h1').textContent = 'DUSTFALL';
      document.querySelector('#start h3').textContent = 'PAUSED — CLICK TO RESUME';
      $('playBtn').textContent = 'RESUME';
    }
  }
  hideStart() { $('start').classList.add('hidden'); }
  showEnd(winner, score, text) {
    $('endTitle').textContent = winner === 'atk' ? 'DUSTERS WIN' : 'WARDENS WIN';
    $('endTitle').style.color = winner === 'atk' ? '#ffb454' : '#57c8b8';
    $('endScore').textContent = `${score.atk} — ${score.def}`;
    $('endText').textContent = text;
    $('end').classList.remove('hidden');
  }
  hideEnd() { $('end').classList.add('hidden'); }

  banner(title, sub) {
    $('banner').textContent = title;
    $('subbanner').textContent = sub || '';
    $('banner').style.opacity = 1;
    $('subbanner').style.opacity = 1;
    this.bannerT = 3.2;
  }

  feedKill(victim, attacker, head) {
    const feed = $('feed');
    const div = document.createElement('div');
    const cls = (e) => (e === this.G.player ? 'you' : e.team === 'atk' ? 'atk' : 'def');
    const nm = (e) => (e === this.G.player ? 'YOU' : e.name);
    div.innerHTML = `<b class="${cls(attacker)}">${nm(attacker)}</b> ${head ? '☠' : '✕'} <b class="${cls(victim)}">${nm(victim)}</b>`;
    feed.prepend(div);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  }

  hitmarker(kill) {
    const el = $('hitmark');
    el.classList.toggle('kill', kill);
    el.style.opacity = 1;
    this.hitT = kill ? 0.5 : 0.18;
  }

  flashDamage() {
    $('vignette').style.opacity = 1;
    this.dmgT = 0.6;
  }

  showProgress(label, frac) {
    const w = $('progressWrap');
    if (frac <= 0 || label === null) { w.style.display = 'none'; return; }
    w.style.display = 'block';
    $('progressLabel').textContent = label;
    $('progressBar').style.width = `${Math.round(frac * 100)}%`;
  }

  setHint(text) { $('hint').textContent = text || ''; }

  fmtTime(s) {
    const t = Math.max(0, Math.ceil(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  update(dt) {
    const G = this.G, p = G.player;
    // timers / banners decay
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) { $('banner').style.opacity = 0; $('subbanner').style.opacity = 0; }
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) $('hitmark').style.opacity = 0;
    }
    if (this.dmgT > 0) {
      this.dmgT -= dt;
      $('vignette').style.opacity = Math.max(0, this.dmgT / 0.6);
    }
    // top bar
    $('roundLabel').textContent = `ROUND ${G.roundNumber}`;
    const timerEl = $('timer');
    if (G.phase === 'buy') {
      timerEl.textContent = `BUY ${this.fmtTime(G.phaseT)}`;
      timerEl.classList.remove('low');
    } else if (G.phase === 'live') {
      timerEl.textContent = this.fmtTime(G.phaseT);
      timerEl.classList.toggle('low', G.phaseT < 15);
    } else {
      timerEl.textContent = '—';
    }
    $('score').innerHTML = `<span class="atk">DUSTERS ${G.score.atk}</span> &nbsp;—&nbsp; <span class="def">${G.score.def} WARDENS</span>`;
    $('money').textContent = `$${p.money}`;
    // health / ammo
    $('hpNum').textContent = Math.ceil(p.hp);
    const hpBar = $('hpBar');
    hpBar.style.width = `${Math.max(0, p.hp)}%`;
    hpBar.classList.toggle('low', p.hp < 35);
    $('armorLine').textContent = p.armor ? '⬢ KEVLAR VEST — 30% DAMAGE REDUCTION' : '';
    const def = WEAPONS[p.weapons[p.current]];
    const a = p.ammo[def.id];
    $('ammo').innerHTML = p.reloadT > 0
      ? `<span style="font-size:22px">RELOADING…</span>`
      : `${a.mag} <small>/ ${a.reserve}</small>`;
    $('gunName').textContent = def.name + (p.weapons.length > 1 ? `  ·  [${p.weapons.map((w, i) => `${i + 1}:${WEAPONS[w].name.split(' ')[0]}`).join(' ')}]` : '');
    $('grenades').textContent = `FRAG ×${p.grenades}  ·  B — BUY MENU  ·  KILLS ${p.kills}`;
    // crosshair gap grows with spread + bloom + movement
    const gap = 9 + def.spread * 900 + p.bloom * 500 + (p.moving ? 7 : 0);
    document.getElementById('crosshair').style.setProperty('--gap', `${gap.toFixed(0)}px`);
    // bomb status
    const bs = $('bombStatus');
    if (G.bomb.state === 'planted') {
      bs.style.display = 'block';
      bs.textContent = `DEVICE PLANTED — SITE ${G.bomb.site} — ${G.bomb.timer.toFixed(1)}s`;
    } else if (G.bomb.state === 'held' && G.phase === 'live') {
      bs.style.display = 'block';
      bs.style.color = '#cbbfa5';
      bs.textContent = 'DEVICE NOT PLANTED — HOLD E AT A SITE';
    } else {
      bs.style.display = 'none';
    }
    if (this.buyOpen) this.refreshShop();
  }
}
