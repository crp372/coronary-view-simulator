// drr.html: the DRR engine on its own, for checking and tuning the image. Same engine, TUNE, cine and heart
// motion as index.html, plus an iodine-strength slider and the CT centrelines drawn in 2D.
import {SOD,SID,dirs,drrView} from './geometry.js';
import {PRESETS,angTxt} from './presets.js';
import {TUNE,DRR_N} from './drr/tune.js';
import {loadScan} from './drr/data.js';
import {drrSupport,createDRR} from './drr/engine.js';
import {drrCine} from './drr/cine.js';
import {heartForward,heartFrame} from './drr/heart.js';
import {loadHearts} from './hearts.js';
const V3=THREE.Vector3;
const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const $=id=>document.getElementById(id);

// tx, ty, tz: table offset in cm (patient x, y, z); the anatomy moves with it. The iodine strength is TUNE.iod.
const state={lao:-30,cra:-25,tx:0,ty:0,tz:0,fov:20,inj:'L',cath:true,fine:true,motion:true,labels:true,lines:false};
let drr=null,heart=null,cine=null,dirty=true,tween=null,paused=false,lastNow=0;
const stats={frameMs:0};

/* ---------- Vessel labels and centrelines (vessels.json), projected like the DRR ---------- */
const cv=$('gl'),ov=$('ov'),ctx=ov.getContext('2d'),labelsEl=$('labels');
let VESSELS=[];const LABELS=[];
const pw=new V3(),ps=new V3();
// cone-beam projection of an anatomy point to screen coords in [-1,1] (x right, y up); it moves with the heart
function projector(v){const S=new V3(...v.S),C=new V3(...v.C),r=new V3(...v.r),t=new V3(...v.t),d=C.clone().sub(S).normalize();
  return p=>{heartForward(p,pw).sub(S);ps.copy(S).addScaledVector(pw,SID/pw.dot(d)).sub(C);return [ps.dot(r)/v.h,ps.dot(t)/v.h];};}
function buildLabels(){
  VESSELS.forEach(v=>{v.p3=v.pts.map(p=>new V3(...p));
    const el=document.createElement('span');el.className='lbl'+(v.sys==='R'?' r':'');el.textContent=v.lab;el.hidden=true;labelsEl.appendChild(el);
    LABELS.push({el,v,p:v.p3[Math.floor(v.pts.length*(v.pts.length<20?0.5:0.45))]});});
}
function drawOverlay(v){
  const W=ov.width,H=ov.height,cw=ov.clientWidth,ch=ov.clientHeight,pr=projector(v);ctx.clearRect(0,0,W,H);
  const toPx=(p,w,h)=>{const s=pr(p);return [(s[0]+1)/2*w,(1-s[1])/2*h];};
  if(state.lines){const css=getComputedStyle(document.documentElement);
    ctx.lineWidth=1.5*W/cw;ctx.lineJoin='round';ctx.globalAlpha=0.85;
    VESSELS.forEach(e=>{if(e.sys!==state.inj)return;ctx.strokeStyle=css.getPropertyValue(e.sys==='R'?'--cool':'--accent');ctx.beginPath();
      e.p3.forEach((p,i)=>{const [x,y]=toPx(p,W,H);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();});
    ctx.globalAlpha=1;}
  LABELS.forEach(l=>{if(!state.labels||l.v.sys!==state.inj){l.el.hidden=true;return;}
    const [x,y]=toPx(l.p,cw,ch);
    if(x<14||x>cw-14||y<14||y>ch-14){l.el.hidden=true;return;}
    l.el.hidden=false;l.el.style.left=x+'px';l.el.style.top=y+'px';});
}

/* ---------- Presets ---------- */
const presetBtns=[];
PRESETS.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='pre';b.setAttribute('aria-pressed','false');
  b.innerHTML=`<span class="pn">${p.name}</span><span class="pa">${angTxt(p.lao,p.cra)}</span><span class="pb">${p.best}</span>`;
  b.addEventListener('click',()=>goTo(p));$(p.inj==='L'?'presetsL':'presetsR').appendChild(b);presetBtns.push({b,p});});
function goTo(p){setInj(p.inj);if(reduce){state.lao=p.lao;state.cra=p.cra;syncUI();return;}
  tween={t0:performance.now(),dur:850,from:{lao:state.lao,cra:state.cra},to:{lao:p.lao,cra:p.cra}};}

/* ---------- UI wiring ---------- */
const sliders={lao:$('sLao'),cra:$('sCra')},sIod=$('sIod');
Object.entries(sliders).forEach(([k,el])=>el.addEventListener('input',()=>{state[k]=parseFloat(el.value);tween=null;syncUI(true);}));
sIod.addEventListener('input',()=>{TUNE.iod=parseFloat(sIod.value);syncUI(true);});
function syncUI(fromSlider){
  dirty=true;
  if(!fromSlider){for(const k in sliders)sliders[k].value=state[k];sIod.value=TUNE.iod;}
  $('oLao').textContent=Math.round(state.lao)===0?'AP':(state.lao>0?'LAO ':'RAO ')+Math.abs(Math.round(state.lao))+'°';
  $('oCra').textContent=Math.round(state.cra)===0?'0°':(state.cra>0?'Cranial ':'Caudal ')+Math.abs(Math.round(state.cra))+'°';
  $('oIod').textContent=TUNE.iod===0?'off':`+${(TUNE.iod/1000).toFixed(1)}k HU`;
  document.querySelectorAll('#fovSeg button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.fov===state.fov)));
  document.querySelectorAll('#injSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.inj===state.inj)));
  const a=angTxt(state.lao,state.cra);
  $('roAng').innerHTML=`<b>${a.replace('  ','<br>')}</b>`;
  $('roFov').innerHTML=`FOV ${state.fov} cm<br>SID ${SID} cm`;
  $('roInj').textContent=state.inj==='L'?'LCA injection':'RCA injection';
  const tb=[state.tx,state.tz,state.ty].map(v=>(v>=0?'+':'')+v.toFixed(1));
  $('roSrc').innerHTML=`TBL ${tb.join(' / ')}<br>DRR · ${heart?heart.short:'…'}`;
  $('nowAng').textContent=a;
  let hit=null;presetBtns.forEach(({b,p})=>{const on=p.inj===state.inj&&Math.abs(p.lao-state.lao)<=5&&Math.abs(p.cra-state.cra)<=5;b.setAttribute('aria-pressed',String(on));if(on)hit=p;});
  $('nowName').textContent=hit?hit.name:'Custom view';
  $('nowBest').innerHTML=hit?`<strong>Best for:</strong> ${hit.best}`:'Not a standard view. Pick a preset below, or keep adjusting and watch which segments separate or overlap.';
}
function setInj(s){state.inj=s;syncUI();}
document.querySelectorAll('#injSeg button').forEach(b=>b.addEventListener('click',()=>setInj(b.dataset.inj)));
document.querySelectorAll('#fovSeg button').forEach(b=>b.addEventListener('click',()=>{state.fov=+b.dataset.fov;syncUI();}));
function toggle(id,key,after){const b=$(id);b.addEventListener('click',()=>{state[key]=!state[key];b.setAttribute('aria-pressed',String(state[key]));dirty=true;after&&after();});}
toggle('tLabels','labels');toggle('tLines','lines');toggle('tCath','cath');toggle('tMotion','motion');
toggle('tFine','fine',()=>{if(drr&&drr.hasFine)drr.setFine(state.fine);});
$('cine').addEventListener('click',()=>{cine={t0:performance.now()};});

// drag the image to pan the table (the anatomy follows the pointer), as in index.html
const mon=$('monitor');let drag=null;
mon.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};mon.setPointerCapture(e.pointerId);mon.classList.add('drag');});
mon.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};
  const {d,t}=dirs(state.lao,state.cra),right=new V3().crossVectors(t,d),cpp=state.fov/(SID/SOD)/mon.clientWidth;
  const mv=right.multiplyScalar(dx*cpp).addScaledVector(t,-dy*cpp),cl=(v,a)=>Math.max(-a,Math.min(a,Math.round(v*2)/2));
  state.tx=cl(state.tx+mv.x,12);state.ty=cl(state.ty+mv.y,10);state.tz=cl(state.tz+mv.z,15);
  syncUI();});
const endDrag=()=>{drag=null;mon.classList.remove('drag');};
mon.addEventListener('pointerup',endDrag);mon.addEventListener('pointercancel',endDrag);
$('tblReset').addEventListener('click',()=>{state.tx=state.ty=state.tz=0;syncUI();});

/* ---------- Sizing ---------- */
function size(){const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.max(1,Math.min(1600,Math.round(mon.clientWidth*dpr)));
  cv.width=cv.height=ov.width=ov.height=w;dirty=true;}
new ResizeObserver(size).observe(mon);size();

/* ---------- Loop ---------- */
function step(now){
  if(tween){const k=Math.min(1,(now-tween.t0)/tween.dur),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    state.lao=tween.from.lao+(tween.to.lao-tween.from.lao)*e;state.cra=tween.from.cra+(tween.to.cra-tween.from.cra)*e;
    if(k>=1){state.lao=tween.to.lao;state.cra=tween.to.cra;tween=null;}syncUI();}
  const v=drrView(state),cs=drrCine(cine,now,state.motion);if(cine&&cine.done)cine=null;
  drr.render(v,cs,reduce?0:Math.floor(now/1000*15));   // noise and motion refresh at 15 pulses/s
  if(dirty||cs.hm>0){drawOverlay(v);dirty=false;}      // labels and centrelines ride with the beating heart
}
function loop(now){if(!paused)step(now);if(lastNow)stats.frameMs+=((now-lastNow)-stats.frameMs)*0.1;lastNow=now;requestAnimationFrame(loop);}
setInterval(()=>{if(!drr)return;const s=drr.stats;$('perf').textContent=`DRR pass ${s.drrMs.toFixed(1)} ms · iodine pass ${s.iodMs.toFixed(1)} ms · ${DRR_N}² rays · ${stats.frameMs?Math.round(1000/stats.frameMs):'–'} fps`;},500);

/* ---------- Start ---------- */
function fail(msg){const s=$('status');s.hidden=false;s.classList.add('err');s.innerHTML=msg;}
async function start(){
  syncUI();
  const gl=cv.getContext('webgl2',{antialias:false,depth:false,preserveDrawingBuffer:true});
  const no=drrSupport(gl);if(no){fail(`The DRR renderer can’t run: ${no}.`);return;}
  // ?heart=<id> as in index.html; this page has no model heart, so ?model shows the default heart
  const hs=await loadHearts();heart=hs.heart||hs.list[0];syncUI();
  let scan;
  try{scan=await loadScan(heart.dir);}
  catch(e){console.error(e);fail('Couldn’t load the CT data from <code>'+heart.dir+'</code>: '+String(e.message||e));return;}
  try{drr=createDRR(gl,cv,scan,{fine:state.fine,reduce});}catch(e){console.error(e);fail(String(e.message||e));return;}
  if(scan.chambers)heartFrame(scan.chambers);   // the heart's frame for cardiac motion
  for(const [id,on] of [['tCath',!!scan.cath],['tFine',drr.hasFine]])$(id).hidden=!on;
  VESSELS=scan.vessels;buildLabels();
  if(scan.meta.attribution)$('attr').textContent='Data: '+scan.meta.attribution.join(' · ')+(scan.chAttr?' · '+scan.chAttr:'')+'. Non-commercial use only.';
  $('status').hidden=true;
  Object.assign(window.drr,{get stats(){return drr.stats;},get win(){return drr.win;},get cine(){return cine;}});
  requestAnimationFrame(loop);
}

// for automated checks: frame(at) renders one frame as if the clock read `at` ms (rAF stops in background tabs);
// runCine(at) starts a cine run at clock `at`; pause() stops the rAF loop drawing, so only frame() does
window.drr={state,tune:TUNE,
  set(o){Object.assign(state,o);tween=null;syncUI();if(drr)drr.invalidate();},
  frame(at){const t0=performance.now();step(at??t0);drr.finish();return performance.now()-t0;},
  runCine(at){cine={t0:at??performance.now()};},
  pause(on=true){paused=on;}};
window.drr.ready=start();
