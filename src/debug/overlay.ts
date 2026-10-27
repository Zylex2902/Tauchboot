import { obs } from '../obs';
import type { Sim } from '../sim/core';
import { FIRM, radiated } from '../sim/enemy-sense';
import { decoyEcho } from '../sim/decoy';
import { DECOYS_CARRIED, DECOYS_FROM, doctrineAt, warMs } from '../sim/doctrine';
import { HULLS } from '../sim/fleet';
import { layerAt, layerLoss, waterTemp } from '../sim/ocean';
import { keyOwner, sightRanges } from '../sim/sense';
import { beaufortOf, seaStateOf, waveHeight } from '../sim/weather';

/**
 * The truth overlay (chunk 2.2, debug only: loaded on ?debug, never part of the game's
 * UI paths). Lays what the boat senses over what is really there: the true ships and
 * own boat on a map, with the hydrophone's bearings as heard, the lookouts' calls, the
 * navigator's dead reckoning and command's reports; beside it, the weather as judged
 * against the weather as it is, the thermometer against the water, and each heard sound
 * against the ship that makes it. A dev tool: plain canvas, a plain monospace face.
 * Toggle with the TRUTH tab or the T key; tap the map to change its scale. The WAR tab (or Y)
 * steps the date the escorts' kit and doctrine are taken from (chunk 4.3), to try the
 * counters and the decoy canister (from 1942) in the slice's June 1941 engagement.
 */

/** War dates the WAR tab steps through (null: the patrol's own clock). */
const WARS: [string, number | null][] = [
  ['AS PATROL', null],
  ['1942', Date.UTC(1942, 5, 1)],
  ['EARLY 1943', Date.UTC(1943, 2, 1)],
  ['1944', Date.UTC(1944, 5, 1)],
];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const wrap = (d: number) => norm(d + 180) - 180;
const pad3 = (n: number) => String(Math.round(norm(n)) % 360).padStart(3, '0');
const SCALES = [5000, 25000, 100000];
const COL = {
  bg: 'rgba(11,12,14,0.93)',
  grid: '#2b2f34',
  text: '#c3c7c4',
  dim: '#7a828a',
  merchant: '#98a0a6',
  tanker: '#c9a85a',
  escort: '#c23a2a',
  own: '#f4f1e6',
  heard: '#e0a030',
  look: '#6c8a72',
  sig: '#3e4a6a',
  box: '#4a5058',
};

export function mountTruth(sim: Sim): void {
  const tab = document.createElement('button');
  tab.textContent = 'TRUTH';
  const tabStyle = {
    position: 'fixed',
    left: 'calc(env(safe-area-inset-left) + 4px)',
    bottom: 'calc(env(safe-area-inset-bottom) + 4px)',
    zIndex: '30',
    font: '11px ui-monospace, monospace',
    background: '#202327',
    color: '#e0a030',
    border: '1px solid #4a5058',
    padding: '4px 8px',
  };
  Object.assign(tab.style, tabStyle);
  const cv = document.createElement('canvas');
  Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '29', display: 'none', touchAction: 'none' });
  const war = document.createElement('button');
  war.textContent = 'WAR: AS PATROL';
  Object.assign(war.style, { ...tabStyle, left: 'calc(env(safe-area-inset-left) + 64px)' });
  document.body.append(cv, tab, war);
  let warK = 0;
  const stepWar = () => {
    warK = (warK + 1) % WARS.length;
    const [name, ms] = WARS[warK];
    const st = sim.state as { world: { war?: number; t0: number }; boat: { canisters: number } };
    if (ms === null) delete st.world.war;
    else st.world.war = ms;
    // Into 1942 or later with none aboard (the slice is June 1941): the boat gets her canisters.
    if ((ms ?? st.world.t0) >= DECOYS_FROM && st.boat.canisters === 0 && !used) (st.boat.canisters = DECOYS_CARRIED), (used = true);
    war.textContent = `WAR: ${name}`;
    if (on) draw();
  };
  let used = false;
  war.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    stepWar();
  });
  window.addEventListener('keydown', (e) => e.key.toLowerCase() === 'y' && stepWar());
  let on = false;
  let scale = 1;
  const toggle = () => {
    on = !on;
    cv.style.display = on ? 'block' : 'none';
    if (on) draw();
  };
  tab.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    toggle();
  });
  window.addEventListener('keydown', (e) => e.key.toLowerCase() === 't' && toggle());
  cv.addEventListener('pointerdown', () => {
    scale = (scale + 1) % SCALES.length;
    draw();
  });
  Object.assign(window, { __truth: { toggle, isOn: () => on, draw } });
  window.setInterval(() => on && draw(), 250);

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.bg;
    g.fillRect(0, 0, W, H);
    const s = sim.state;
    const w = s.world;
    const se = s.sense;
    const b = s.boat;
    const t = w.n * 0.1;
    const own = w.own;
    // Map: own boat at the centre, north up.
    const M = Math.min(H - 16, W * 0.42);
    const mx = 8 + M / 2;
    const my = 8 + M / 2;
    const R = SCALES[scale];
    const k = M / 2 / R;
    const P = (x: number, y: number): [number, number] => [mx + (x - own.x) * k, my - (y - own.y) * k];
    g.save();
    g.beginPath();
    g.rect(8, 8, M, M);
    g.clip();
    g.strokeStyle = COL.grid;
    g.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      g.beginPath();
      g.arc(mx, my, (M / 2) * (i / 4), 0, Math.PI * 2);
      g.stroke();
    }
    const [bx0, by0] = P(-25000, 25000);
    g.strokeStyle = COL.box;
    g.strokeRect(bx0, by0, 50000 * k, 50000 * k);
    // True ships.
    for (const sh of w.ships) {
      if (sh.gone) continue;
      const [x, y] = P(sh.x, sh.y);
      if (x < -20 || y < -20 || x > W || y > H) continue;
      g.fillStyle = sh.role === 'escort' ? COL.escort : sh.hull === 'tanker' ? COL.tanker : sh.role === 'independent' ? COL.own : COL.merchant;
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
      g.strokeStyle = g.fillStyle;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(sh.course * D2R) * 7, y - Math.cos(sh.course * D2R) * 7);
      g.stroke();
    }
    // Aircraft (chunk 2.4): a cross with its heading, its mode, and its height.
    for (const a of w.air.list) {
      const [x, y] = P(a.x, a.y);
      if (x < -20 || y < -20 || x > W || y > H) continue;
      g.strokeStyle = g.fillStyle = COL.escort;
      g.beginPath();
      g.moveTo(x - 4, y);
      g.lineTo(x + 4, y);
      g.moveTo(x, y - 3);
      g.lineTo(x, y + 3);
      g.moveTo(x, y);
      g.lineTo(x + Math.sin(a.course * D2R) * 10, y - Math.cos(a.course * D2R) * 10);
      g.stroke();
      g.fillText(`${a.mode.toUpperCase()} ${Math.round(a.alt)}M${a.cloud ? ' CLOUD' : ''}`, x + 6, y - 4);
    }
    // The scope drill's merchant, laid out around own boat heading 000.
    if (s.kind === 'scope') {
      const d = s.drill.ship;
      const [x, y] = P(own.x + d.x, own.y + d.y);
      g.fillStyle = COL.tanker;
      g.fillRect(x - 2, y - 2, 4, 4);
      g.fillText('DRILL', x + 5, y + 3);
    }
    // Hydrophone: bearings as heard (solid), true bearings of the same ships (dashed).
    g.font = '10px ui-monospace, monospace';
    for (const src of obs.sound.sources) {
      const brg = norm(src.bearing + own.course);
      const len = (M / 2) * (0.35 + 0.65 * Math.max(0, 1 + Math.log10(Math.max(1e-3, src.level)) / 1.5));
      g.strokeStyle = COL.heard;
      g.globalAlpha = 0.35 + 0.65 * Math.min(1, src.level * 3);
      g.beginPath();
      g.moveTo(mx, my);
      g.lineTo(mx + Math.sin(brg * D2R) * len, my - Math.cos(brg * D2R) * len);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = COL.heard;
      g.fillText(src.key, mx + Math.sin(brg * D2R) * len + 2, my - Math.cos(brg * D2R) * len);
    }
    // Lookout calls of the last 20 minutes.
    for (const l of obs.lookouts) {
      if (t - l.at > 1200) continue;
      const brg = norm(l.bearing + own.course);
      g.strokeStyle = COL.look;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(mx, my);
      g.lineTo(mx + Math.sin(brg * D2R) * M, my - Math.cos(brg * D2R) * M);
      g.stroke();
      g.setLineDash([]);
    }
    // Command's reports.
    for (const sg of obs.signals) {
      const x = Math.sin(sg.from.bearing * D2R) * sg.from.miles * 1852;
      const y = Math.cos(sg.from.bearing * D2R) * sg.from.miles * 1852;
      const [px, py] = P(x, y);
      g.strokeStyle = '#7d8fc0';
      g.beginPath();
      g.moveTo(px - 5, py - 5);
      g.lineTo(px + 5, py + 5);
      g.moveTo(px + 5, py - 5);
      g.lineTo(px - 5, py + 5);
      g.stroke();
      g.fillStyle = '#7d8fc0';
      g.fillText(`SIG ${sg.n} (${((t - sg.about) / 3600).toFixed(1)} H OLD)`, px + 7, py + 3);
    }
    // Chunk 4.1: where each escort thinks the boat is (a ring; filled when she holds firm contact).
    for (const [id, e] of Object.entries(s.detect.esc ?? {})) {
      if (!e.datum) continue;
      const [x, y] = P(e.datum.x, e.datum.y);
      g.strokeStyle = COL.escort;
      g.globalAlpha = e.firm ? 1 : 0.45;
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.stroke();
      if (e.firm) g.fillRect(x - 2, y - 2, 4, 4);
      g.globalAlpha = 1;
      g.fillStyle = COL.escort;
      g.fillText(`${id} ${e.datum.by.toUpperCase()}${e.datum.of !== undefined ? ` ON C${e.datum.of}` : ''}`, x + 7, y + 3);
    }
    // Chunk 4.2: charges sinking (crosses) and the last two minutes' explosions (rings).
    g.strokeStyle = COL.escort;
    for (const c of s.esc.charges) {
      const [x, y] = P(c.x, c.y);
      g.beginPath();
      g.moveTo(x - 3, y - 3);
      g.lineTo(x + 3, y + 3);
      g.moveTo(x + 3, y - 3);
      g.lineTo(x - 3, y + 3);
      g.stroke();
    }
    // Chunk 4.3: decoy canisters (diamonds; dotted ring while its echo is strong).
    for (const q of s.esc.decoys) {
      const [x, y] = P(q.x, q.y);
      g.strokeStyle = COL.heard;
      g.beginPath();
      g.moveTo(x, y - 5);
      g.lineTo(x + 5, y);
      g.lineTo(x, y + 5);
      g.lineTo(x - 5, y);
      g.closePath();
      g.stroke();
      g.fillStyle = COL.heard;
      g.fillText(`C${q.id}${q.classed.length ? ' CLASSED' : ''}`, x + 7, y + 3);
      g.strokeStyle = COL.escort;
    }
    for (const x0 of s.esc.booms) {
      const [x, y] = P(x0.x, x0.y);
      g.globalAlpha = Math.max(0.15, 1 - (t - x0.t) / 120);
      g.beginPath();
      g.arc(x, y, 4 + (t - x0.t) / 10, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    // Own boat, true and dead-reckoned.
    const [dx, dy] = P(se.dr.x, se.dr.y);
    g.strokeStyle = COL.heard;
    g.beginPath();
    g.moveTo(dx - 4, dy);
    g.lineTo(dx + 4, dy);
    g.moveTo(dx, dy - 4);
    g.lineTo(dx, dy + 4);
    g.stroke();
    g.strokeStyle = COL.own;
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(dx, dy);
    g.stroke();
    g.fillStyle = COL.own;
    g.beginPath();
    const oc = own.course * D2R;
    g.moveTo(mx + Math.sin(oc) * 7, my - Math.cos(oc) * 7);
    g.lineTo(mx + Math.sin(oc + 2.5) * 5, my - Math.cos(oc + 2.5) * 5);
    g.lineTo(mx + Math.sin(oc - 2.5) * 5, my - Math.cos(oc - 2.5) * 5);
    g.fill();
    g.restore();
    g.strokeStyle = COL.box;
    g.strokeRect(8, 8, M, M);
    g.fillStyle = COL.dim;
    g.font = '10px ui-monospace, monospace';
    g.fillText(`RADIUS ${R / 1000} KM (TAP)   TRUE SHIPS: GREY/GOLD/RED   HEARD: AMBER   CALLED: GREEN   DR: AMBER +`, 12, 8 + M - 6);

    // Text: truth against what the boat has.
    const lines: [string, string?][] = [];
    const L = (a: string, c?: string) => lines.push([a, c]);
    const clock = new Date(w.t0 + t * 1000);
    const wx = w.weather;
    const env = obs.env;
    const ss = seaStateOf(waveHeight(wx));
    L(`TRUTH OVERLAY  ${clock.toISOString().slice(0, 16).replace('T', ' ')} UTC   SUN ${w.sky.sunElev.toFixed(1)}  ${w.sky.phase.toUpperCase()}  MOON ${Math.round(w.sky.moonLit * 100)}% ${w.sky.moonElev > 0 ? 'UP' : 'DOWN'}`, COL.own);
    L('');
    L('WEATHER        TRUE                 JUDGED' + (env.at === null ? ' (NOT YET)' : ` ${Math.round((t - env.at) / 60)} MIN AGO`), COL.dim);
    L(`  WIND         F${beaufortOf(wx.wind + wx.gust)} FROM ${pad3(wx.dir)} (${(wx.wind + wx.gust).toFixed(1)} M/S)`.padEnd(37) + `F${env.force} FROM ${pad3(env.windFrom)}`);
    L(`  SEA STATE    ${ss} (${waveHeight(wx).toFixed(1)} M, ${wx.kind.toUpperCase()})`.padEnd(37) + `${env.seaState}`);
    L(`  VISIBILITY   ${wx.vis.toFixed(1)} KM`.padEnd(37) + `${env.visMiles} NM${env.fog ? ' FOG' : ''}`);
    L(`  CLOUD/RAIN   ${Math.round(wx.cloud * 8)}/8 ${wx.precip.toUpperCase()}${wx.squall ? ' (SQUALL)' : ''}`.padEnd(37) + `${env.cloud}/8 ${env.rain.toUpperCase()}`);
    const lay = layerAt(w.ocean, t);
    L(`  WATER AT ${b.depth.toFixed(0)} M`.padEnd(15) + `${waterTemp(w.ocean, t, b.depth).toFixed(2)} C`.padEnd(22) + `THERMOMETER ${env.seaTemp.toFixed(1)} C`);
    L(`  LAYER        ${w.ocean.layer ? `${lay.top.toFixed(0)}-${(lay.top + lay.thick).toFixed(0)} M, ${w.ocean.dT.toFixed(1)} C DROP, ${layerLoss(w.ocean, t, 6, b.depth + 3).toFixed(1)} DB TO US` : 'NONE (MIXED)'}`);
    L('');
    const err = Math.hypot(se.dr.x - own.x, se.dr.y - own.y);
    L(`OWN BOAT       TRUE ${(own.x / 1000).toFixed(2)}, ${(own.y / 1000).toFixed(2)} KM   DR ${(se.dr.x / 1000).toFixed(2)}, ${(se.dr.y / 1000).toFixed(2)} KM   DR OFF ${err.toFixed(0)} M`, COL.dim);
    L(`  CURRENT ${w.current.kn.toFixed(2)} KN SETTING ${pad3(w.current.set)}   FIX ${(se.fixAge / 3600).toFixed(1)} H OLD   NOISE ${b.power.noise.toFixed(0)} DB${obs.sound.deaf ? '  DEAF' : ''}`);
    // Chunk 4.1: being found. Own radiated noise and what makes it; each escort's margins (dB, 0 = even odds a roll comes good).
    const rad = radiated(b, s.torp);
    L(`BEING FOUND    NOISE ${rad.db.toFixed(0)} DB${b.silent ? ' (SILENT RUNNING)' : ''}: ${Object.entries(rad.parts).map(([k, v]) => `${k.toUpperCase()} ${Math.round(v!)}`).join(' ')}   SCOPE EXPOSURE ${s.detect.e.toFixed(2)}   CONTACTS ${s.detect.contacts ?? 0}`, COL.dim);
    const wm = warMs(w);
    const doc = doctrineAt(wm);
    L(`  WAR DATE ${new Date(wm).toISOString().slice(0, 7)}${w.war !== undefined ? ' (OVERRIDE, Y)' : ''}   DOCTRINE: CHARGES TO ${doc.maxSet} M, ECHO CLASSING ${doc.classK}, HOLD ${Math.round(doc.huntMax / 60)} MIN (${Math.round(doc.lostMax / 60)} LOST), ${doc.layerWise ? 'LAYER-WISE' : 'NO BT'}, DECOY CLASSED IN ${doc.decoyClass > 1e8 ? '-' : `${doc.decoyClass} S`}   CANISTERS ${b.canisters}`, COL.dim);
    for (const q of s.esc.decoys) L(`  CANISTER C${q.id}  ${Math.round(t - q.t0)} S OLD, ${q.z.toFixed(0)} M, ECHO ${decoyEcho(t - q.t0).toFixed(0)} DB, ${Math.round(Math.hypot(q.x - own.x, q.y - own.y))} M FROM US${q.classed.length ? `, CLASSED BY ${q.classed.join(' ')}` : ''}  WATCHED ${Object.entries(q.watch).map(([k, v]) => `${k}:${v}`).join(' ')}`, COL.heard);
    for (const sh of w.ships) {
      const e = s.detect.esc?.[sh.id];
      if (!e) continue;
      const r = Math.hypot(sh.x - own.x, sh.y - own.y);
      const off = e.datum ? Math.hypot(e.datum.x - own.x, e.datum.y - own.y) : NaN;
      const m = (v: number) => (v < -90 ? '  --' : (v >= 0 ? '+' : '') + v.toFixed(0)).padStart(4);
      L(`  ${String(sh.id).padStart(3)} ${sh.hull.toUpperCase().padEnd(9)} ${(r / 1000).toFixed(1)}KM ${sh.kn.toFixed(0).padStart(2)}KN  ASDIC${m(e.m.asdic)} EARS${m(e.m.ears)} RADAR${m(e.m.radar)}  EV ${e.ev.toFixed(1)}/${FIRM}${e.firm ? ' FIRM' : ''}${e.datum ? `  DATUM ${Math.round(off)} M OFF` : ''}${sh.ai ? `  ${sh.ai.mode.toUpperCase()}${sh.ai.mode === 'attack' ? ` SET ${Math.round(sh.ai.set)} M` : ''} RUNS ${sh.ai.attacks}` : sh.hunt ? '  SENT' : ''}  DC ${s.esc.racks[sh.id] ?? '-'}`, e.firm ? COL.escort : undefined);
    }
    L('');
    L('SOUNDS  KEY    HEARD  TRUE   ERR   LEVEL  RPM HEARD/TRUE  SHIP', COL.dim);
    const srcs = [...obs.sound.sources].sort((a, c) => c.level - a.level).slice(0, 14);
    for (const src of srcs) {
      const id = keyOwner(se, src.key);
      let tb = NaN;
      let rpm = NaN;
      let who = '?';
      if (id === 'drill') {
        const d = s.drill.ship;
        tb = norm(Math.atan2(d.x, d.y) * R2D);
        rpm = d.rpm;
        who = `DRILL ${d.cls.toUpperCase()} ${(Math.hypot(d.x, d.y) / 1000).toFixed(1)}KM`;
      } else if (id) {
        const sh = w.ships.find((x) => `w${x.id}` === id);
        if (sh) {
          tb = norm(Math.atan2(sh.x - own.x, sh.y - own.y) * R2D - own.course);
          rpm = sh.rpm;
          who = `${sh.hull.toUpperCase()} ${(Math.hypot(sh.x - own.x, sh.y - own.y) / 1000).toFixed(1)}KM ${sh.kn.toFixed(0)}KN`;
        }
      }
      const e = wrap(src.bearing - tb);
      L(`        ${src.key.padEnd(6)} ${pad3(src.bearing)}    ${pad3(tb)}    ${(e >= 0 ? '+' : '') + e.toFixed(1)}`.padEnd(37) + `${(20 * Math.log10(src.level)).toFixed(0).padStart(4)} DB  ${src.rpm.toFixed(0).padStart(4)}/${rpm.toFixed(0)}`.padEnd(22) + who);
    }
    if (!srcs.length) L('        NOTHING HEARD');
    L('');
    L('LOOKOUTS (CALLED / WHAT IS THERE)', COL.dim);
    for (const l of obs.lookouts.slice(-4)) L(`  ${Math.round((t - l.at) / 60)} MIN AGO: ${l.text}`);
    const near = w.ships.filter((sh) => !sh.gone).map((sh) => ({ sh, r: Math.hypot(sh.x - own.x, sh.y - own.y) })).sort((a, c) => a.r - c.r)[0];
    if (near) {
      const [rs, rm, rh] = sightRanges(w, HULLS[near.sh.hull]);
      L(`  NEAREST SHIP ${(near.r / 1000).toFixed(1)} KM; SEEN FROM: SMOKE ${(rs / 1000).toFixed(1)}  MASTS ${(rm / 1000).toFixed(1)}  HULL ${(rh / 1000).toFixed(1)} KM`);
    }
    L('');
    L('COMMAND', COL.dim);
    for (const sg of obs.signals.slice(-2)) {
      const gx = w.groups.find((x) => x.kind === 'convoy');
      const lead = gx && w.ships.find((x) => x.id === gx.ships[0]);
      let off = '';
      if (lead) {
        const i = Math.round((sg.about - lead.trackT) / 300);
        if (i >= 0 && 2 * i + 1 < lead.track.length) {
          const x = Math.sin(sg.from.bearing * D2R) * sg.from.miles * 1852;
          const y = Math.cos(sg.from.bearing * D2R) * sg.from.miles * 1852;
          off = `  (${(Math.hypot(x - lead.track[2 * i], y - lead.track[2 * i + 1]) / 1000).toFixed(0)} KM OFF; TRUE COURSE ${pad3(gx.frame)})`;
        }
      }
      L(`  ${sg.text}${off}`);
    }
    if (!obs.signals.length) L(`  NO SIGNAL YET (NEXT IN ${((se.nextSig - t) / 3600).toFixed(1)} H${se.held.length ? ', ONE WAITING FOR THE AERIAL' : ''})`);
    const x0 = 8 + M + 14;
    // Fit the text to the space beside the map.
    const longest = Math.max(...lines.map(([l]) => l.length));
    const px = Math.max(8, Math.min(11, Math.floor(((W - x0 - 6) / longest) / 0.6)));
    g.font = `${px}px ui-monospace, monospace`;
    let y = 8 + px;
    for (const [text, c] of lines) {
      g.fillStyle = c ?? COL.text;
      g.fillText(text, x0, y);
      y += px + 2;
      if (y > H - 4) break;
    }
  }
}
