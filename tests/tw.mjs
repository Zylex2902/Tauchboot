import { Tweens } from './tw-sim.mjs';
class Container { y = 0; destroyed = false; destroy() { this.destroyed = true; Object.defineProperty(this, 'y', { set() { throw new TypeError("Cannot set properties of null (setting 'y')"); } }); } }
let cb; const tw = new Tweens({ add: (f) => (cb = f) });
const a = new Container(), b = new Container();
let doneA = false;
tw.to(a, { y: 50 }, { duration: 100 }).then(() => (doneA = true));
tw.to(b, { y: 50 }, { duration: 100 });
cb({ deltaMS: 30 }); a.destroy();
let ok = true; try { for (let i = 0; i < 5; i++) cb({ deltaMS: 30 }); } catch (e) { ok = false; console.log(e.message); }
await Promise.resolve();
console.log(ok && doneA && b.y === 50 ? 'PASS  a tween on a destroyed sprite is dropped, the rest run on' : `FAIL ${ok} ${doneA} ${b.y}`);
