// Pointer input on the fluoro monitor and the room view: dragging the image pans the table; hovering (or tapping)
// a structure names it in both views.
import {state,chOn,app,$,esc} from './state.js';
import {SOD,SID,dirs} from '../geometry.js';
import {mon,fcam,ovl} from './fluoro.js';
import {rCanvas,rcam,tableG,roomVesselMat,roomHiMat,roomChHiMat} from './room.js';
import {VES,CH,SEG,SCCT,scctAt} from './ct.js';
import {syncUI} from './ui.js';
import {heartForward} from '../drr/heart.js';
const V3=THREE.Vector3;

// drag the image to pan the table (the anatomy follows the pointer)
let drag=null;
mon.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};mon.setPointerCapture(e.pointerId);mon.classList.add('drag');});
mon.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};
  const {d,t}=dirs(state.lao,state.cra),right=new V3().crossVectors(t,d);
  const cpp=state.fov/(SID/SOD)/mon.clientWidth;
  const mv=right.multiplyScalar(dx*cpp).addScaledVector(t,-dy*cpp);
  const cl=(v,a)=>Math.max(-a,Math.min(a,Math.round(v*2)/2));
  state.tx=cl(state.tx+mv.x,12);state.ty=cl(state.ty+mv.y,10);state.tz=cl(state.tz+mv.z,15);
  syncUI();});
const endDrag=()=>{drag=null;mon.classList.remove('drag');};
mon.addEventListener('pointerup',endDrag);mon.addEventListener('pointercancel',endDrag);

// picking (CT only), in either view: the nearest centreline on screen within a few pixels, else the chambers
// under the pointer (in the image only with the overlay on, since they're invisible otherwise)
const pv=new V3(),ray=new THREE.Raycaster(),ndc=new THREE.Vector2();
function pickVessel(cam,el,cx,cy,only,tol=12){
  const rc=el.getBoundingClientRect(),px=cx-rc.left,py=cy-rc.top,W=rc.width,H=rc.height,off=tableG.position;
  let best=null,bd=tol*tol;   // best: {i: vessel index, j: centreline point nearest the pointer}
  VES.forEach((e,i)=>{if(only&&!only(e))return;let ax=0,ay=0,ok=false;
    e.pts.forEach((p,j)=>{heartForward(p,pv).add(off).project(cam);   // where the beating heart has it now
const ins=pv.z<1;const x=(pv.x+1)/2*W,y=(1-pv.y)/2*H;
      if(ok&&ins){const dx=x-ax,dy=y-ay,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)):0;
        const qx=ax+t*dx-px,qy=ay+t*dy-py,d2=qx*qx+qy*qy;if(d2<bd){bd=d2;best={i,j:t<0.5?j-1:j};}}
      ax=x;ay=y;ok=ins;});});
  return best;
}
// chambers along the ray through the pointer, in order from the detector (image) or the eye (room)
function pickChambers(cam,el,cx,cy,key,fromDetector){
  if(!CH.length)return [];
  const rc=el.getBoundingClientRect();ndc.set((cx-rc.left)/rc.width*2-1,1-(cy-rc.top)/rc.height*2);
  ray.setFromCamera(ndc,cam);ovl.updateMatrixWorld();tableG.updateMatrixWorld();
  const hits=ray.intersectObjects(CH.filter(c=>chOn[c.s.id]!==false).map(c=>c[key]),false);if(fromDetector)hits.reverse();
  const order=[];hits.forEach(h=>{const i=CH.findIndex(c=>c[key]===h.object);if(!order.includes(i))order.push(i);});
  const solid=order.filter(i=>CH[i].s.id!=='Myo');   // the myocardium wraps the LV, so name it only on its own
  return solid.length?solid:order;
}
// target: null, {v: vessel index}, or {c: chamber indices, first = highlighted}
export function setHover(target,tipEl,cx,cy){
  const vi=target&&target.v!=null?target.v:null,ci=target&&target.c?target.c[0]:null;
  if(vi!==app.hover){
    if(app.hover!==null){const o=VES[app.hover];o.mat.uniforms.uHi.value=0;o.room.material=roomVesselMat[o.v.sys];}
    app.hover=vi;
    if(vi!==null){const o=VES[vi];o.mat.uniforms.uHi.value=1;o.room.material=roomHiMat;}
  }
  if(ci!==app.hoverCh){
    if(app.hoverCh!==null){const o=CH[app.hoverCh];o.mat.uniforms.uHi.value=0;o.room.material=o.roomMat;}
    app.hoverCh=ci;
    if(ci!==null){const o=CH[ci];o.mat.uniforms.uHi.value=1;o.room.material=roomChHiMat;}
  }
  ['monTip','roomTip'].forEach(id=>{const t=$(id);if(t!==tipEl||!target){t.hidden=true;return;}
    const rc=t.parentElement.getBoundingClientRect(),flip=cx-rc.left>rc.width*0.55?' flip':'';
    if(vi!==null){const v=VES[vi].v,g=target.pt!=null?scctAt(vi,target.pt):null;t.className='tip'+(v.sys==='R'?' r':'')+flip;
      t.innerHTML=`<b>${esc(v.lab)}</b>${esc((SEG[v.lab]||SEG.Other)[1])}`+(g?`<span class="stk">SCCT segment ${g.n}: ${esc(SCCT[g.n])}</span>`:'');}
    else{const s=CH[ci].s,stack=target.c.map(i=>CH[i].s.id);t.className='tip ch'+flip;
      t.innerHTML=`<b>${esc(s.id)}</b>${esc(s.name)}`+(stack.length>1?`<span class="stk">Detector side first: ${esc(stack.join(' › '))}</span>`:'');}
    t.style.left=(cx-rc.left)+'px';t.style.top=(cy-rc.top)+'px';t.hidden=false;});
}
// in the image: only what's visible there (the injected tree, or both trees and the chambers with the overlay on)
function monPick(cx,cy){const p=pickVessel(fcam,mon,cx,cy,e=>state.ovV||e.v.sys===state.inj);if(p)return {v:p.i,pt:p.j};
  if(!state.ovC)return null;const c=pickChambers(fcam,mon,cx,cy,'ov',true);return c.length?{c}:null;}
// the room shows the heart small, so vessels need a tighter radius or they'd hide the chambers
function roomPick(cx,cy){const p=pickVessel(rcam,rCanvas,cx,cy,null,app.roomView==='heart'?9:4);if(p)return {v:p.i,pt:p.j};
  const c=pickChambers(rcam,rCanvas,cx,cy,'room',false);return c.length?{c:c.slice(0,1)}:null;}
// raycasting the chambers is too slow for every pointer event, so picks run once per frame in step()
let pendingPick=null,tapAt=null;
const queuePick=(fn,tip,e)=>{pendingPick={fn,tip,x:e.clientX,y:e.clientY};};
export function runPick(){if(!pendingPick)return;const p=pendingPick;pendingPick=null;setHover(p.fn(p.x,p.y),p.tip,p.x,p.y);}
mon.addEventListener('pointermove',e=>{if(drag||app.mode!=='drr'||e.pointerType!=='mouse')return;queuePick(monPick,$('monTip'),e);});
mon.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){pendingPick=null;setHover(null);}});
// touch: a tap (no drag) names what's under the finger
mon.addEventListener('pointerdown',e=>{tapAt={x:e.clientX,y:e.clientY};if(e.pointerType==='mouse'){pendingPick=null;setHover(null);}},true);
mon.addEventListener('pointerup',e=>{if(e.pointerType==='mouse'||app.mode!=='drr'||!tapAt)return;
  if(Math.hypot(e.clientX-tapAt.x,e.clientY-tapAt.y)<6)queuePick(monPick,$('monTip'),e);tapAt=null;});
rCanvas.addEventListener('pointermove',e=>{if(e.buttons||app.mode!=='drr'||e.pointerType!=='mouse')return;queuePick(roomPick,$('roomTip'),e);});
rCanvas.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){pendingPick=null;setHover(null);}});
