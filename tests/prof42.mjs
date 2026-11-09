import { Sim } from './hydro23-sim.mjs';
const sim = Sim.fresh(41, { convoy: { merchants: 56, escorts: 8, arrive: 1800, miss: 2000 }, independents: 2 });
for (let i = 0; i < 3000; i++) sim.step();
const t0 = performance.now();
for (let i = 0; i < 36000; i++) sim.step();
console.log('tps', Math.round(36000 / ((performance.now() - t0) / 1000)), 'ai', sim.state.world.ships.filter(s=>s.ai).length, 'charges', sim.state.esc.charges.length);
