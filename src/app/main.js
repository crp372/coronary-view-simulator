// index.html's entry point: starts the DRR (or keeps the model fallback), and runs the frame loop.
import {state,chOn,app,reduce,$} from './state.js';
import {deg,SOD,SID,dirs,drrView} from '../geometry.js';
import {TUNE} from '../drr/tune.js';
import {loadScan} from '../drr/data.js';
import {drrSupport,createDRR} from '../drr/engine.js';
import {drrCine} from '../drr/cine.js';
import {HEART_U,heartForward} from '../drr/heart.js';
import {mon,drrCv,fr,fScene,oScene,fcam,anat,ovl,sysGroups,bones,ovDir,cineStep} from './fluoro.js';
import {rr,rScene,rcam,orbit,tableG,carm,holder,beamGeo,roomCath,roomCamStep} from './room.js';
import {VES,CH,addCT} from './ct.js';
import {placeLabels} from './labels.js';
import {syncUI,setMode,fillHearts} from './ui.js';
import {runPick} from './pointer.js';
import {loadHearts} from '../hearts.js';
const V3=THREE.Vector3;

function updateGeometry(){
  const {d,t}=dirs(state.lao,state.cra);
  const off=new V3(state.tx,state.ty,state.tz);
  anat.position.copy(off);ovl.position.copy(off);tableG.position.copy(off);
  // camera at the tube looking toward the detector; mirror so the image reads as seen from the detector
  fcam.position.copy(d).multiplyScalar(-SOD);fcam.up.copy(t);fcam.lookAt(0,0,0);
  fcam.fov=2*Math.atan(state.fov/2/SID)/deg;fcam.aspect=1;fcam.updateProjectionMatrix();
  fcam.projectionMatrix.elements[0]*=-1;fcam.projectionMatrixInverse.copy(fcam.projectionMatrix).invert();fcam.updateMatrixWorld();
  const X=new V3().crossVectors(d,t);
  carm.matrix.makeBasis(X,d,t);
  holder.rotation.z=-state.lao*deg;   // turns with the arc's plane about the patient's long axis
  // beam: tube focal spot to the four detector corners, plus the detector outline
  const s=d.clone().multiplyScalar(-SOD),c=d.clone().multiplyScalar(SID-SOD),h=state.fov/2;
  const cn=[[1,1],[1,-1],[-1,-1],[-1,1]].map(([i,j])=>c.clone().addScaledVector(X,i*h).addScaledVector(t,j*h));
  const arr=beamGeo.attributes.position.array;let k=0;const put=v=>{arr[k++]=v.x;arr[k++]=v.y;arr[k++]=v.z;};
  cn.forEach(p=>{put(s);put(p);});for(let i=0;i<4;i++){put(cn[i]);put(cn[(i+1)%4]);}
  beamGeo.attributes.position.needsUpdate=true;beamGeo.computeBoundingSphere();
  sysGroups.L.visible=state.inj==='L';sysGroups.R.visible=state.inj==='R';
  ovDir.value.copy(d);
  VES.forEach((e,i)=>{e.ov.visible=state.ovV||app.hover===i;});
  roomCath.forEach(m=>{m.visible=state.cath&&m.userData.side===state.inj;});
  CH.forEach(c=>{const on=chOn[c.s.id]!==false;c.ov.visible=state.ovC&&on;c.room.visible=on;});
  bones.visible=state.bones;
}


// The DRR fluoro: X-rays traced through the chosen heart's CT. If it can't start (no WebGL2 or float targets,
// file://, fetch failure), the model renderer stays on. Choosing the model heart (?model) skips the CT.
async function startDRR(){
  const fail=why=>{app.why=why;app.mode='model';setMode();};
  // fetch can't read local files (file://, or a data: snapshot), so don't try
  if(!/^https?:$/.test(location.protocol))return fail('file');
  const hearts=await loadHearts();fillHearts(hearts);app.heart=hearts.heart;setMode();   // names the heart being loaded
  if(hearts.model)return fail('chosen');
  const dom={right:'a right-dominant',left:'a left-dominant',co:'a co-dominant'}[hearts.heart.dominance];
  const fnd=hearts.heart.finding?` with ${hearts.heart.finding}`:'';
  $('heartDesc').textContent=(dom?`${hearts.heart.source}, ${dom} heart`:hearts.heart.source)+fnd;
  const gl=drrCv.getContext('webgl2',{antialias:false,depth:false,preserveDrawingBuffer:true});
  const no=drrSupport(gl);if(no)return fail(no);
  let scan;
  try{scan=await loadScan(app.heart.dir);app.drr=createDRR(gl,drrCv,scan,{fine:state.fine,reduce});}
  catch(e){console.warn('DRR unavailable, using the model renderer:',e);return fail('the CT couldn’t be loaded ('+String(e.message||e)+')');}
  addCT(scan);
  const m=scan.meta.ct;app.scanCm=m.dims.map((n,i)=>Math.round(n*m.spacing_cm[i])).join(' × ');
  app.mode='drr';setMode();
}

$('cine').addEventListener('click',()=>{app.cine={t0:performance.now()};});

/* ---------- Sizing ---------- */
function sizeAll(){
  const m=mon.clientWidth;fr.setSize(m,m,false);
  const dw=Math.max(1,Math.min(1600,Math.round(m*Math.min(window.devicePixelRatio||1,2))));if(drrCv.width!==dw)drrCv.width=drrCv.height=dw;
  const room=$('room');rr.setSize(room.clientWidth,room.clientHeight,false);rcam.aspect=room.clientWidth/Math.max(1,room.clientHeight);rcam.updateProjectionMatrix();
}
new ResizeObserver(sizeAll).observe(mon);new ResizeObserver(sizeAll).observe($('room'));sizeAll();

/* ---------- Noise ---------- */
const nc=$('noise'),nx=nc.getContext('2d'),nimg=nx.createImageData(nc.width,nc.height);
// seeded (mulberry32), so a still frame looks the same on every load
let nseed=0x2f6b;
const rnd=()=>{let t=nseed=(nseed+0x6d2b79f5)|0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
function noise(){const a=nimg.data;for(let i=0;i<a.length;i+=4){const v=128+(rnd()-0.5)*110;a[i]=a[i+1]=a[i+2]=v;a[i+3]=255;}nx.putImageData(nimg,0,0);}
noise();

/* ---------- Loop ---------- */
let frame=0;
function step(now){
  const tween=app.tween;
  if(tween){const k=Math.min(1,(now-tween.t0)/tween.dur),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    state.lao=tween.from.lao+(tween.to.lao-tween.from.lao)*e;state.cra=tween.from.cra+(tween.to.cra-tween.from.cra)*e;
    if(k>=1){state.lao=tween.to.lao;state.cra=tween.to.cra;app.tween=null;}syncUI();}
  updateGeometry();
  fr.autoClear=true;
  if(app.mode==='drr'){
    const cs=drrCine(app.cine,now,state.motion);if(app.cine&&app.cine.done)app.cine=null;
    app.drr.render(drrView(state),cs,reduce?0:Math.floor(now/1000*15));   // noise and motion refresh at 15 pulses/s
    if(state.ovV||state.ovC||app.hover!==null)fr.render(oScene,fcam);else fr.clear();   // transparent over the DRR
  }else if(app.mode==='model'){   // while loading, the monitor shows a status instead
    cineStep(now);
    fr.render(fScene,fcam);
    if(state.ovC){fr.autoClear=false;fr.render(oScene,fcam);fr.autoClear=true;}
    if(!reduce&&(frame++%2===0))noise();
  }
  runPick();
  placeLabels();
  roomCamStep(now);orbit.update();rr.render(rScene,rcam);
}
let paused=false;   // sim.pause(): checks drive the frames themselves
function loop(now){if(!paused)step(now);requestAnimationFrame(loop);}


// for automated checks; frame() renders one frame without rAF, which stops while the page is hidden
window.sim={state,chOn,tune:TUNE,heart:HEART_U,heartForward,get mode(){return app.mode;},get drr(){return app.drr;},get cine(){return app.cine;},
  set(o){Object.assign(state,o);app.tween=null;syncUI();if(app.drr)app.drr.invalidate();},
  // frame(at): render one frame as if the clock read `at` ms (default now), for deterministic checks
  frame(at){const t0=performance.now();step(at??t0);if(app.drr)app.drr.finish();return performance.now()-t0;},
  // runCine(at): start a cine run at clock `at` ms (null cancels it); advanceCine(at): move the run on to clock `at`
  // without drawing (frame() does both); pause(on): stop the rAF loop drawing, so only frame() does
  runCine(at){app.cine=at===null?null:{t0:at??performance.now()};},
  advanceCine(at){drrCine(app.cine,at,state.motion);if(app.cine&&app.cine.done)app.cine=null;},
  pause(on=true){paused=on;}};
setMode();window.sim.ready=startDRR();requestAnimationFrame(loop);
