// Chunk 3.1: the recognition manual. Twelve classes, their silhouettes, the mix at sea, neutrals, the drill.
import * as M from './recog31-sim.mjs';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const K = M.MANUAL_ORDER;

// 1. The book: twelve types, every mast height different, sim hulls agree with the manual.
{
  const masts = K.map((k) => M.SHIP_CLASSES[k].mast);
  check(K.length === 12 && new Set(masts).size === 12, `12 classes, 12 different mast heights (${masts.join(' ')} m)`);
  const bad = K.filter((k) => M.HULLS[k].mast !== M.SHIP_CLASSES[k].mast || M.HULLS[k].maxKn !== M.SHIP_CLASSES[k].maxKn || M.HULLS[k].tons !== M.SHIP_CLASSES[k].tons);
  check(bad.length === 0, `sim hulls match the manual's mast, top speed and tonnage${bad.length ? ': ' + bad.join(',') : ''}`);
  check(M.MERCHANT_KEYS.length === 8 && K.filter((k) => M.SHIP_CLASSES[k].warship).length === 4, '8 merchants, 4 warships');
}

// 2. Each silhouette's masthead stands at her mast height (what the stadimeter ranges on), at any scale.
{
  const off = [];
  for (const k of K) for (const s of [0.3, 0.9, 2.2]) {
    const sil = M.silhouette(k, s, 1, 1);
    let top = sil.h;
    for (let y = 0; y < sil.h && top === sil.h; y++) for (let x = 0; x < sil.w; x++) if (sil.data[y * sil.w + x] >= 0) { top = y; break; }
    const hpx = sil.h - 1 - top;
    if (Math.abs(hpx - M.SHIP_CLASSES[k].mast * s) > 1) off.push(`${k}@${s}: ${hpx}px vs ${(M.SHIP_CLASSES[k].mast * s).toFixed(1)}`);
  }
  check(off.length === 0, `mastheads at the manual's height at three scales${off.length ? ': ' + off.join('; ') : ''}`);
}

// 3. Told apart: a ship as the scope shows her (6x at 1.5-3 km, foreshortened up to AOB 50,
// either way round, with stays, waves at her waterline and haze) matched against the manual's
// clean drawings, each laid over her at her apparent length: the page that covers her best.
{
  // What stands up from the water in each column (stays hanging between mastheads do not count).
  const stand = (sil) => {
    const on = (x, y) => y >= 0 && sil.data[y * sil.w + x] >= 0;
    const col = [];
    for (let x = 0; x < sil.w; x++) {
      let y = sil.h - 3, top = -1;
      while (y >= 0 && (on(x, y) || on(x, y - 1))) { if (on(x, y)) top = y; y--; }
      col.push(top >= 0 ? sil.h - 2 - top : 0);
    }
    let x0 = col.findIndex((v) => v > 0), x1 = col.length - 1 - [...col].reverse().findIndex((v) => v > 0);
    return col.slice(x0, x1 + 1);
  };
  const overlap = (a, b) => {
    const n = Math.max(a.length, b.length);
    let i = 0, u = 0;
    for (let x = 0; x < n; x++) { const p = a[x] ?? 0, q = b[x] ?? 0; i += Math.min(p, q); u += Math.max(p, q); }
    return i / u;
  };
  const rnd = new M.Rng(31);
  let n = 0, right = 0; const wrong = {};
  const byRange = {};
  for (const k of K) for (const range of [1500, 2200, 3000]) for (const aob of [90, 70, 50]) for (const dir of [1, -1]) {
    const s = (188 / 6) * (180 / Math.PI) / range; // px per metre at 6x
    const k1 = Math.round(Math.sin((aob * Math.PI) / 180) * 40) / 40;
    const sil = M.silhouette(k, s, k1, dir);
    const d = Int8Array.from(sil.data);
    for (let i = 0; i < d.length; i++) if (d[i] >= 0 && rnd.next() < 0.08) d[i] = -1; // haze
    let seen = stand({ ...sil, data: d });
    if (dir === -1) seen = seen.reverse(); // turned round in his head: bow to the right, as in the book
    // Each page laid over her: drawn as long as she looks, and as tall as that makes her.
    let best = null, bd = -1;
    for (const q of K) {
      const c = M.SHIP_CLASSES[q];
      const sq = seen.length / (c.length * k1);
      const page = stand(M.silhouette(q, sq, k1, 1, 25, 26, null, false));
      const o = overlap(seen, page);
      if (o > bd) { bd = o; best = q; }
    }
    n++;
    byRange[range] ??= [0, 0]; byRange[range][1]++;
    if (best === k) { right++; byRange[range][0]++; } else wrong[`${k}->${best}@${range}`] = (wrong[`${k}->${best}@${range}`] ?? 0) + 1;
  }
  check(right / n >= 0.95, `told apart by shape alone: ${right} of ${n} scope views matched their own page (${Object.entries(byRange).map(([r, [a, b]]) => `${a}/${b} at ${r} m`).join(', ')}; ${Object.entries(wrong).map(([a, b]) => `${a} x${b}`).join(', ') || 'no mix-ups'})`);
}

// 4. At sea: the finer mix (all twelve types across patrols), neutrals among the independents.
{
  const count = {}; let indep = 0, neutral = 0, convoyNeutral = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = M.newWorld(new M.Rng(seed), { independents: 3, convoy: { slow: seed % 2 === 0 } });
    for (const s of w.ships) {
      count[s.hull] = (count[s.hull] ?? 0) + 1;
      if (s.role === 'independent') { indep++; if (s.flag) neutral++; }
      else if (s.flag) convoyNeutral++;
    }
  }
  check(K.every((k) => count[k] > 0), `all twelve types at sea over 60 patrols: ${K.map((k) => `${k} ${count[k] ?? 0}`).join(', ')}`);
  check(neutral / indep > 0.25 && neutral / indep < 0.55 && convoyNeutral === 0, `neutrals: ${neutral} of ${indep} independents (none in convoy)`);
}

// 5. The fleet's own draws are untouched: the same convoy, ship for ship, sails the same track.
{
  const a = M.newWorld(new M.Rng(5));
  const b = M.newWorld(new M.Rng(5));
  check(JSON.stringify(a) === JSON.stringify(b), 'a world from one seed is the same every time (types and flags included)');
}

// 6. The drill: any of the eight merchants, now and then a neutral, at drill speed.
{
  const seen = {}; let flags = 0; let fast = 0;
  for (let i = 1; i <= 400; i++) {
    const d = M.newDrillState(new M.Rng(i * 7919));
    seen[d.ship.cls] = (seen[d.ship.cls] ?? 0) + 1;
    if (d.ship.flag) flags++;
    if (d.ship.knots > 11) fast++;
  }
  check(M.MERCHANT_KEYS.every((k) => seen[k] > 20) && Object.keys(seen).length === 8, `drill ship from all 8 merchant types (${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  check(flags > 60 && flags < 140 && fast === 0, `drill neutrals: ${flags} of 400; none faster than 11 kn`);
}

// 7. Saves: a drill on a neutral resumes with her flag, and the scope's sight carries the marks.
{
  let sim = null, flag = null;
  for (let seed = 1; seed < 80 && !flag; seed++) {
    sim = M.Sim.fresh(seed);
    flag = sim.state.drill?.ship?.flag ?? null;
  }
  for (let i = 0; i < 30; i++) sim.step();
  const b = M.Sim.load(JSON.parse(JSON.stringify(sim.snapshot())));
  b.command({ type: 'scopeSet', height: 1, trained: 0, high: true });
  for (let i = 0; i < 30; i++) b.step();
  b.present?.(1);
  check(!!flag && b.state.drill.ship.flag === flag, `a neutral drill ship keeps her flag through a save (${flag})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
