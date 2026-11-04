// Labels on the fluoro image: HTML spans placed at projected anatomy points each frame.
import {state,chOn,app} from './state.js';
import {built,CHAMBERS,P,ao,paPts} from './model.js';
import {mon,anat,fcam} from './fluoro.js';
import {heartForward} from '../drr/heart.js';
const V3=THREE.Vector3;

/* ---------- Labels ---------- */
export const labelsEl=document.getElementById('labels');
export const LABELS=[];
Object.values(built).forEach(b=>{if(!b.v.lab)return;const el=document.createElement('span');el.className='lbl'+(b.v.sys==='R'?' r':'');el.textContent=b.v.lab;labelsEl.appendChild(el);
  LABELS.push({el,p:b.curve.getPointAt(b.v.at),kind:'v',sys:b.v.sys});});
const chamberAnchors=CHAMBERS.map(c=>({id:c.id,p:P(...c.c)})).concat([{id:'Ao',p:ao[2]},{id:'PA',p:paPts[2]}]);
chamberAnchors.forEach(c=>{const el=document.createElement('span');el.className='lbl ch';el.textContent=c.id;labelsEl.appendChild(el);LABELS.push({el,p:c.p,kind:'c'});});

/* ---------- Labels projection ---------- */
const tmp=new V3();
export function placeLabels(){
  const W=mon.clientWidth,H=mon.clientHeight;
  LABELS.forEach(l=>{
    // vessel labels: the model's ('v') or, in DRR mode, the CT centrelines' ('d'), for both trees with the coronary
    // overlay; SCCT numbers ('sn') likewise; chamber labels with the chamber overlay: the model's ('c') or the CT's ('cc')
    const drrOn=app.mode==='drr',tree=l.sys===state.inj||(state.ovV&&drrOn);
    const show=(l.kind===(drrOn?'d':'v')&&state.labels&&tree)||(l.kind==='sn'&&drrOn&&state.segN&&tree)||
      (l.kind===(drrOn?'cc':'c')&&state.ovC&&(!l.ch||chOn[l.ch]!==false));
    if(!show){l.el.hidden=true;return;}
    for(const p of l.cands||[l.p]){
      heartForward(p,tmp).add(anat.position).project(fcam);   // labels ride with the beating heart
      const x=(tmp.x+1)/2*W,y=(1-tmp.y)/2*H;
      if(x<14||x>W-14||y<14||y>H-14)continue;
      l.el.hidden=false;l.el.style.left=x+'px';l.el.style.top=y+'px';return;}
    l.el.hidden=true;
  });
}
