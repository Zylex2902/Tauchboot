import { solveTrack, bearingTo } from './plot-sim.mjs';
const KN=0.5144;
function run(tgt, course, kn, times, errs, ownCourse=0, ownKn=0, guess=8) {
  const v={x:Math.sin(course*Math.PI/180)*kn*KN, y:Math.cos(course*Math.PI/180)*kn*KN};
  const ov={x:Math.sin(ownCourse*Math.PI/180)*ownKn*KN, y:Math.cos(ownCourse*Math.PI/180)*ownKn*KN};
  const L=times.map((t,i)=>{const P={x:ov.x*t,y:ov.y*t}; const T={x:tgt.x+v.x*t,y:tgt.y+v.y*t}; return {at:t, from:P, brg:bearingTo(P,T)+(errs[i]??0)}});
  const s=solveTrack(L, guess); return s? s.course.toFixed(1)+' '+s.knots.toFixed(1) : null;
}
console.log('own2 noerr guess8', run({x:5000,y:9000},235,9,[0,400,900],[], 90, 2));
console.log('own2 noerr guess9', run({x:5000,y:9000},235,9,[0,400,900],[], 90, 2, 9));
console.log('own0 err +-1 10min', run({x:5000,y:9000},235,9,[0,600,1200],[-1,1,-1]));
console.log('own0 err round 5min', run({x:5000,y:9000},235,9,[0,300,600],[0.4,-0.3,0.5]));
console.log('own0 err +-1 5min', run({x:5000,y:9000},235,9,[0,300,600],[-1,1,-1]));
console.log('own1 err +-1 10min', run({x:5000,y:9000},235,9,[0,600,1200],[-1,1,-1],0,1));
