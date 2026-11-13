// First-run tour: four short steps that point at what a new user might miss. It shows once per browser (localStorage
// cvs.tour), after the CT image is up; "Show the tour" in the How to use dialog runs it again. It doesn't block the
// page: the card and the ring round its target ignore nothing but themselves, so the user can try each step.
//   1. the standard views keypad
//   2. hover naming, shown on a real artery: the tooltip is put up for it, as if the pointer were there
//   3. the Display group (opened), with the overlay switches
//   4. the ? (How to use) and About this image buttons
import {state,app,$} from './state.js';
import {mon,fcam,anat} from './fluoro.js';
import {VES} from './ct.js';
import {setHover} from './pointer.js';
import {setTab} from './ui.js';
import {heartForward} from '../drr/heart.js';
const V3=THREE.Vector3;
const KEY='cvs.tour';
const card=$('tour'),ring=$('tourRing'),title=$('tourTitle'),text=$('tourText'),count=$('tourCount'),next=$('tourNext');

// a point on an injected artery that's well inside the image, the LAD's (or the RCA's) if possible: client x, y
function vesselPoint(){
  const rc=mon.getBoundingClientRect(),p=new V3();let best=null;
  VES.forEach((e,i)=>{if(e.v.sys!==state.inj)return;const pref=['LAD','RCA'].includes(e.v.lab)?0:1;
    const n=e.pts.length;for(let j=Math.floor(n*0.3);j<Math.floor(n*0.6);j++){
      heartForward(e.pts[j],p).add(anat.position).project(fcam);const x=(p.x+1)/2,y=(1-p.y)/2;
      if(x<0.2||x>0.8||y<0.2||y>0.8)continue;
      const score=pref*10+Math.hypot(x-0.5,y-0.5);
      if(!best||score<best.score)best={score,i,j,x:rc.left+x*rc.width,y:rc.top+y*rc.height};}});
  return best;
}
// What each card points at. Their words are in index.html (<template id="tourSteps">), one <div> per card in this order.
const STEPS=[
  {enter(){setTab('views');},target:()=>document.querySelector('.presets')},   // the tab matters in the phone layout only
  {enter(){const v=vesselPoint();this.pt=v;if(v)setHover({v:v.i,pt:v.j},$('monTip'),v.x,v.y);},
    leave(){setHover(null);},
    target(){const v=this.pt;return v?{getBoundingClientRect:()=>{const r=14;return {left:v.x-r,top:v.y-r,right:v.x+r,bottom:v.y+r,width:2*r,height:2*r};}}:mon;}},
  {side:'left',   // beside the group, over the image, rather than over the other groups
    enter(){setTab('disp');const d=document.querySelector('details[data-grp=disp]');d.open=true;},
    target:()=>$('tOvV').parentElement},
  // the two buttons together: one rect round both
  {target:()=>({getBoundingClientRect:()=>{const a=$('helpBtn').getBoundingClientRect(),b=$('aboutBtn').getBoundingClientRect(),
    l=Math.min(a.left,b.left),t=Math.min(a.top,b.top),r=Math.max(a.right,b.right),bm=Math.max(a.bottom,b.bottom);return {left:l,top:t,right:r,bottom:bm,width:r-l,height:bm-t};},
    scrollIntoView:o=>$('helpBtn').scrollIntoView(o)})},
];
[...$('tourSteps').content.children].forEach((d,i)=>{if(STEPS[i])Object.assign(STEPS[i],{title:d.querySelector('h3').textContent,html:d.querySelector('p').innerHTML});});
let k=-1,raf=0;
function place(){
  if(k<0)return;
  const s=STEPS[k],t=s.target(),r=t.getBoundingClientRect(),pad=6,W=innerWidth,H=innerHeight;
  Object.assign(ring.style,{left:r.left-pad+'px',top:r.top-pad+'px',width:r.width+2*pad+'px',height:r.height+2*pad+'px'});
  ring.classList.toggle('dot',k===1&&!!s.pt);
  // the card goes beside the target: below, above, then right or left, whichever has room (a step may prefer the
  // left, where it's kept level with the target as far as the window allows); kept on screen
  const cw=card.offsetWidth,ch=card.offsetHeight,g=14,yl=Math.min(r.top,H-ch-8);
  const xa=Math.max(8,Math.min(W-cw-8,r.left));   // below or above: lined up with the target's left edge, slid in to fit
  const opts=[[xa,r.bottom+g],[xa,r.top-g-ch],[r.right+g,r.top],[r.left-g-cw,r.top]];
  if(s.side==='left')opts.unshift([r.left-g-cw,yl]);
  let [x,y]=opts.find(([x,y])=>y>=8&&y+ch<=H-8&&x>=8&&x+cw<=W-8)||[W/2-cw/2,H-ch-12];
  x=Math.max(8,Math.min(W-cw-8,x));y=Math.max(8,Math.min(H-ch-8,y));
  card.style.left=x+'px';card.style.top=y+'px';
  raf=requestAnimationFrame(place);   // follows scrolling, resizing and the rail opening
}
function show(i){
  if(k>=0&&STEPS[k].leave)STEPS[k].leave();
  k=i;const s=STEPS[k];
  title.textContent=s.title;text.innerHTML=s.html;count.textContent=`${k+1} of ${STEPS.length}`;
  next.textContent=k===STEPS.length-1?'Done':'Next';
  if(s.enter)s.enter();
  const t=s.target();if(t.scrollIntoView)t.scrollIntoView({block:'nearest'});
  const top=t.getBoundingClientRect().top;if(top<14)scrollBy(0,top-14);   // room above for the ring
  card.hidden=ring.hidden=false;next.focus({preventScroll:true});
  cancelAnimationFrame(raf);place();
}
export function endTour(){
  if(k<0)return;if(STEPS[k].leave)STEPS[k].leave();
  k=-1;cancelAnimationFrame(raf);card.hidden=ring.hidden=true;
  try{localStorage.setItem(KEY,'1');}catch(e){}
}
// force: run it even if it has been seen (the How to use dialog's button)
export function startTour(force){
  if(app.mode!=='drr'||!VES.length)return;   // the steps point at the CT's arteries
  if(!force){try{if(localStorage.getItem(KEY))return;}catch(e){return;}}
  show(0);
}
next.addEventListener('click',()=>k<STEPS.length-1?show(k+1):endTour());
$('tourSkip').addEventListener('click',endTour);
document.addEventListener('keydown',e=>{if(k>=0&&e.key==='Escape'&&!document.querySelector('dialog[open]'))endTour();});
$('tourBtn').addEventListener('click',()=>{$('help').close();startTour(true);});
