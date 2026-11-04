// The CT's own anatomy (coronary tree from ImageCAS-X, chambers from TotalSegmentator) in the overlay and the room.
import {app} from './state.js';
import {taperTube} from './tubes.js';
import {ctOvl,ctOvlMat,chamberOvlMat} from './fluoro.js';
import {roomCTTree,roomCTCh,roomVesselMat,roomCathMat,roomCath,catName} from './room.js';
import {labelsEl,LABELS} from './labels.js';
import {heartFrame} from '../drr/heart.js';
const V3=THREE.Vector3;

// CT coronary overlay: one colour per ImageCAS-X segment (left warm, right cool); brighter = nearer the detector
export const SEG={LM:['#ffd54a','Left main'],LAD:['#ffb000','Left anterior descending'],LCx:['#ff7a1a','Left circumflex'],
  D1:['#ffe08a','First diagonal'],D2:['#e8c56a','Second diagonal'],OM1:['#ff5a5a','First obtuse marginal'],OM2:['#d94a8c','Second obtuse marginal'],
  IM:['#c58cff','Ramus intermedius'],RCA:['#3ee0ff','Right coronary artery'],'R-PDA':['#2f9bff','Posterior descending (from the RCA)'],
  'R-PLA':['#5effc0','Posterolateral branch (from the RCA)'],'L-PDA':['#ff9ad0','Posterior descending (from the LCx)'],
  'L-PLA':['#b07cff','Posterolateral branch (from the LCx)'],Other:['#bbbbbb','Other branch']};
// SCCT 18-segment model, mapped onto the CT's vessel paths by distance from the ostium (sdist, cm)
export const SCCT={1:'Proximal RCA',2:'Mid RCA',3:'Distal RCA',4:'R-PDA',5:'Left main',6:'Proximal LAD',7:'Mid LAD',8:'Distal LAD',
  9:'First diagonal',10:'Second diagonal',11:'Proximal LCx',12:'First obtuse marginal',13:'Mid/distal LCx',14:'Second obtuse marginal',
  15:'L-PDA',16:'R-PLB',17:'Ramus intermedius',18:'L-PLB'};
const SCCT_WHOLE={LM:5,D1:9,D2:10,OM1:12,OM2:14,IM:17,'R-PDA':4,'R-PLA':16,'L-PDA':15,'L-PLA':18};
export const SEGN=[];       // {n, vessel index, from, to (sdist)} once the CT tree is loaded
export const VES=[];        // CT vessels once loaded: {v, pts, room mesh, overlay mesh, overlay material}
export const CH=[];         // CT chambers and great vessels (TotalSegmentator): {s, overlay mesh, material, room mesh, room material}
function buildScct(){
  const byLab=l=>VES.findIndex(e=>e.v.lab===l),origin=l=>{const i=byLab(l);return i<0?null:VES[i].v.sdist[0];};
  const span=i=>{const s=VES[i].v.sdist;return [s[0],s[s.length-1]];};
  const add=(n,i,a,b)=>SEGN.push({n,i,from:a,to:b});
  VES.forEach((e,i)=>{const n=SCCT_WHOLE[e.v.lab];if(n){const [a,b]=span(i);add(n,i,a,b);}});
  // LAD: proximal to the D1 origin, then mid and distal halves of the rest (to the apex)
  let i=byLab('LAD');if(i>=0){const [a,b]=span(i),d1=origin('D1'),c=d1!==null&&d1>a&&d1<b?d1:a+(b-a)/3,m=(c+b)/2;add(6,i,a,c);add(7,i,c,m);add(8,i,m,b);}
  // LCx: proximal to the OM1 origin, then mid/distal
  i=byLab('LCx');if(i>=0){const [a,b]=span(i),o=origin('OM1'),c=o!==null&&o>a&&o<b?o:(a+b)/2;add(11,i,a,c);add(13,i,c,b);}
  // RCA: thirds up to the crux (the acute marginal, the usual mid/distal landmark, isn't labelled here)
  i=byLab('RCA');if(i>=0){const [a,b]=span(i),t=(b-a)/3;add(1,i,a,a+t);add(2,i,a+t,a+2*t);add(3,i,a+2*t,b);}
  // a number badge a quarter of the way along each segment (vessel name labels sit near the middle)
  SEGN.forEach(g=>{const v=VES[g.i].v,mid=g.from+(g.to-g.from)*0.25;let k=0;while(k<v.sdist.length-1&&v.sdist[k]<mid)k++;
    const el=document.createElement('span');el.className='lbl segn'+(v.sys==='R'?' r':'');el.textContent=g.n;el.title=SCCT[g.n];el.hidden=true;labelsEl.appendChild(el);
    LABELS.push({el,p:new V3(...v.pts[k]),kind:'sn',sys:v.sys});});
}
export const scctAt=(vi,j)=>{const s=VES[vi].v.sdist[Math.min(j,VES[vi].v.sdist.length-1)];return SEGN.find(g=>g.i===vi&&s>=g.from-1e-6&&s<=g.to+1e-6);};

// Adds a loaded scan's anatomy (loadScan()) to both views: the guide catheters in the room, the CT's coronary tree
// (room tubes, overlay ribbons, labels, SCCT segments) and, if present, its chambers and great vessels.
export function addCT(scan){
  const {meta,vessels,cath,chambers}=scan;
  if(cath)for(const s of ['L','R'])if(cath[s]){const pts=cath[s].pts.map(p=>new V3(...p));
    const m=new THREE.Mesh(taperTube(pts,0.12,0.12,0).geo,roomCathMat);m.userData.side=s;roomCTTree.add(m);roomCath.push(m);catName[s]=cath[s].name;}
  // labels near the same spot along each centreline as drr.html; other points along it, nearest first, are
  // fallbacks for when that spot is off-screen
  vessels.forEach(v=>{const el=document.createElement('span');el.className='lbl'+(v.sys==='R'?' r':'');el.textContent=v.lab;el.hidden=true;labelsEl.appendChild(el);
    const n=v.pts.length,k=Math.floor(n*(n<20?0.5:0.45)),every=Math.max(1,Math.round(n/20));
    const idx=[...Array(n).keys()].filter(i=>i===k||i%every===0).sort((a,b)=>Math.abs(a-k)-Math.abs(b-k));
    LABELS.push({el,cands:idx.map(i=>new V3(...v.pts[i])),kind:'d',sys:v.sys});});
  // the CT's own coronary tree: room view tubes, and thin overlay ribbons along the centrelines so the
  // contrast-filled lumen stays visible on either side
  vessels.forEach(v=>{const pts=v.pts.map(p=>new V3(...p));if(pts.length<2)return;
    const r0=v.r[0],r1=v.r[v.r.length-1],col=(SEG[v.lab]||SEG.Other)[0];
    const room=new THREE.Mesh(taperTube(pts,Math.max(0.08,r0),Math.max(0.05,r1),0).geo,roomVesselMat[v.sys]);roomCTTree.add(room);
    const mat=ctOvlMat(col),ov=new THREE.Mesh(taperTube(pts,r0*0.35+0.025,r1*0.35+0.025,0).geo,mat);ov.visible=false;ctOvl.add(ov);
    VES.push({v,pts,room,ov,mat});});
  buildScct();
  const segs=[...new Set(vessels.map(v=>v.lab))];
  app.ctLegend=segs.map(s=>`<span><i style="background:${(SEG[s]||SEG.Other)[0]}"></i>${s}</span>`).join('');
  app.attr=meta.attribution?meta.attribution.join(' · '):'ImageCAS (CC BY-NC 4.0) · ImageCAS-X (CC BY 4.0)';
  // chambers and great vessels from the same CT (TotalSegmentator); optional, so a missing file only drops them
  if(!chambers)return;
  chambers.forEach(({s,geometry:g})=>{
    const myo=s.id==='Myo',mat=chamberOvlMat(s.colour,myo?0.45:1),ov=new THREE.Mesh(g,mat);
    ov.renderOrder=-1;ov.visible=false;ctOvl.add(ov);   // under the coronary ribbons
    const roomMat=new THREE.MeshStandardMaterial({color:s.colour,transparent:true,opacity:myo?0.08:0.3,depthWrite:false,side:THREE.DoubleSide,roughness:.8});
    const room=new THREE.Mesh(g,roomMat);roomCTCh.add(room);
    CH.push({s,ov,mat,room,roomMat});
    if(!myo){const el=document.createElement('span');el.className='lbl ch';el.textContent=s.id;el.hidden=true;labelsEl.appendChild(el);
      LABELS.push({el,p:new V3(...s.centroid_cm),kind:'cc',ch:s.id});}});
  if(scan.chAttr)app.attr+=' · '+scan.chAttr;
  heartFrame(chambers);
}
