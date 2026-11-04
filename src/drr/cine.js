import {TUNE} from './tune.js';
import {CYCLE,lvCurve} from './heart.js';

// Cine injection for the DRR engine, shared by index.html and drr.html. A run is an object {t0: start clock, ms}
// that drrCine() advances; it sets run.done once the run is over. Along the real tree in mm, timed to a 72/min
// heartbeat:
//  - injection: the front advances with coronary flow, which is mostly diastolic, so it surges between beats
//  - hold, then washout: unopacified blood clears the tree from the ostium outward, also in pulses
//  - the heart beats only during the run (unless motion is off), like recording on a real system; outside it the
//    image holds still. Heart time ht starts at end-diastole (the CT's own shape) when the run starts, and the run
//    ends only once the last beat has come back to end-diastole, so neither end jumps
//  - everything is sampled at 15 pulses/s (t)
// motion: the heart beats during the run. Returns the cine state for the engine's render().
export function drrCine(cine,now,motion){
  const tq=Math.floor(now/1000*15)/15;
  const full={fill:999,washF:0,wash:1,t:tq,ht:0,hm:0};
  if(!cine||cine.done)return full;
  const e=tq-cine.t0/1000,ht=Math.max(0,e),hm=motion?1:0,f=(ht%CYCLE)/CYCLE;
  const dt=Math.min(0.1,Math.max(0,tq-(cine.last??tq)));cine.last=tq;
  const flow=0.3+0.7*(1-lvCurve(f)),v=TUNE.stream.speed,at=o=>Object.assign({fill:999,washF:0,wash:1,t:tq,ht,hm},o);
  if(cine.fill===undefined){cine.fill=4;cine.washF=0;}
  if(e<2.6){cine.fill=Math.min(999,cine.fill+v*flow*dt);if(cine.fill>300)cine.fill=999;return at({fill:cine.fill});}
  if(e<3.8)return at({});
  if(cine.washF<260){cine.washF+=1.3*v*flow*dt;if(cine.washF>=260)cine.cleared=tq;return at({washF:Math.max(1,cine.washF)});}
  const k=(tq-cine.cleared)/0.5;   // tree clear; fade the static view back in
  if(k<1)return at({wash:Math.max(0,k)});
  // finish the beat: keep going until the next beat would start, where the heart is back at end-diastole
  if(hm){cine.endAt??=Math.ceil(ht/CYCLE-1e-6)*CYCLE;if(ht<cine.endAt)return at({});}
  cine.done=true;return full;
}
