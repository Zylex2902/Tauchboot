import { solveTrack, bearingTo } from './plot-sim.mjs';
const KN=0.5144;
function run(own, tgt, course, kn, times, err=0, ownCourse=0, ownKn=0) {
  const v={x:Math.sin(course*Math.PI/180)*kn*KN, y:Math.cos(course*Math.PI/180)*kn*KN};
  const ov={x:Math.sin(ownCourse*Math.PI/180)*ownKn*KN, y:Math.cos(ownCourse*Math.PI/180)*ownKn*KN};
  const L=times.map((t,i)=>{const P={x:own.x+ov.x*t,y:own.y+ov.y*t}; const T={x:tgt.x+v.x*t,y:tgt.y+v.y*t}; return {at:t, from:P, brg:bearingTo(P,T)+(i%2?err:-err)}});
  return solveTrack(L, 8);
}
console.log(JSON.stringify(run({x:0,y:0},{x:-9000,y:6000},120,8,[0,300,600])));
console.log(JSON.stringify(run({x:0,y:0},{x:-9000,y:6000},120,7,[0,300,600],1.5)));
console.log(JSON.stringify(run({x:0,y:0},{x:5000,y:9000},235,9,[0,400,900],1, 90, 2)));
console.log(JSON.stringify(run({x:0,y:0},{x:5000,y:9000},235,9,[0,400,900,1300],1, 90, 6)));
