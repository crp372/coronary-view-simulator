// The room view: table, patient, C-arm and stand, with the heart (model or CT) on the table.
import {reduce,tok,app} from './state.js';
import {SOD,SID} from '../geometry.js';
import {CHAMBERS,ao,built,ellMesh} from './model.js';
import {taperTube} from './tubes.js';
const V3=THREE.Vector3;

/* ---------- Room scene ---------- */
export const rCanvas=document.getElementById('roomc');
export const rr=new THREE.WebGLRenderer({canvas:rCanvas,antialias:true});
rr.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
rr.setClearColor(new THREE.Color(tok('--panel2')));
export const rScene=new THREE.Scene();
export const rcam=new THREE.PerspectiveCamera(40,4/3,5,2000);
rcam.position.set(185,120,150);
export const orbit=new THREE.OrbitControls(rcam,rCanvas);orbit.target.set(0,-15,-5);orbit.enableDamping=!reduce;orbit.minDistance=90;orbit.maxDistance=520;orbit.update();
// camera: the whole room, or close on the heart (which sits at the isocentre plus the table offset, and is followed)
const ROOM_CAM={target:new V3(0,-15,-5),pos:new V3(185,120,150),min:90,max:520},HEART_CAM={dist:30,min:12,max:160};
let camTween=null;const lastOff=new V3();
export function setRoomView(v){
  app.roomView=v;document.querySelectorAll('#roomViewSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rv===v)));
  const heart=v==='heart',toT=heart?tableG.position.clone():ROOM_CAM.target.clone();
  // keep the current viewing direction when closing in, so the heart is seen from where you were looking
  const toP=heart?toT.clone().addScaledVector(rcam.position.clone().sub(orbit.target).normalize(),HEART_CAM.dist):ROOM_CAM.pos.clone();
  orbit.minDistance=1;orbit.maxDistance=2000;   // the real limits apply once the move ends
  skin.opacity=heart?0.05:0.16;                 // close up, the skin's layers would wash the heart out
  camTween={t0:performance.now(),dur:reduce?0:700,fromT:orbit.target.clone(),fromP:rcam.position.clone(),toT,toP,
    min:heart?HEART_CAM.min:ROOM_CAM.min,max:heart?HEART_CAM.max:ROOM_CAM.max};
}
export function roomCamStep(now){
  const off=tableG.position;
  if(camTween){const c=camTween,k=c.dur?Math.min(1,(now-c.t0)/c.dur):1,e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    if(app.roomView==='heart')c.toT.copy(off);    // the table may move during the transition
    orbit.target.lerpVectors(c.fromT,c.toT,e);rcam.position.lerpVectors(c.fromP,c.toP,e);
    if(k>=1){orbit.minDistance=c.min;orbit.maxDistance=c.max;camTween=null;}}
  else if(app.roomView==='heart'&&!off.equals(lastOff)){const dv=off.clone().sub(lastOff);orbit.target.add(dv);rcam.position.add(dv);}
  lastOff.copy(off);
}
rScene.add(new THREE.HemisphereLight(0xdfe8ee,0x2a2f33,0.9));
const dl=new THREE.DirectionalLight(0xffffff,0.7);dl.position.set(120,220,-80);rScene.add(dl);
const grid=new THREE.GridHelper(420,21,tok('--line'),tok('--line'));grid.position.y=-110;rScene.add(grid);

export const tableG=new THREE.Group();rScene.add(tableG);
const tableMat=new THREE.MeshStandardMaterial({color:0x3a444d,roughness:.8});
const top=new THREE.Mesh(new THREE.BoxGeometry(52,3,215),tableMat);top.position.set(0,-13.5,47);tableG.add(top);
const ped=new THREE.Mesh(new THREE.BoxGeometry(26,92,36),tableMat);ped.position.set(0,-61,115);tableG.add(ped);
const skin=new THREE.MeshStandardMaterial({color:0xa9bdc9,transparent:true,opacity:0.16,depthWrite:false,roughness:.9,side:THREE.DoubleSide});
// patient: torso turned from a profile (shoulders, chest, waist, hips), flattened front to back; head, neck, arms, legs
const torsoProfile=[[0,-26],[6,-26],[14,-24.5],[17,-21],[16.8,-10],[15.4,4],[14,16],[15.6,28],[16.2,36],[14,41],[0,42]].map(([r,z])=>new THREE.Vector2(r,z));
const torso=new THREE.Mesh(new THREE.LatheGeometry(torsoProfile,36).rotateX(Math.PI/2).scale(1,0.65,1),skin);torso.position.set(0,-1,0);tableG.add(torso);
const neck=new THREE.Mesh(new THREE.CylinderGeometry(5,5.5,7,18).rotateX(Math.PI/2),skin);neck.position.set(0,-2,-29);tableG.add(neck);
const head=new THREE.Mesh(new THREE.SphereGeometry(9,24,16).scale(0.85,1,1.08),skin);head.position.set(0,-1.5,-38);tableG.add(head);
[-1,1].forEach(s=>{const a=new THREE.Mesh(new THREE.CylinderGeometry(4.6,3.6,62,16).rotateX(Math.PI/2),skin);a.position.set(s*21.5,-4.5,8);tableG.add(a);});
[-8,8].forEach(x=>{const l=new THREE.Mesh(new THREE.CylinderGeometry(7,4.6,88,18).rotateX(Math.PI/2),skin);l.position.set(x,-5,85);tableG.add(l);});
const tableBase=new THREE.Mesh(new THREE.BoxGeometry(56,4,70),tableMat);tableBase.position.set(0,-108,115);tableG.add(tableBase);
// model chambers and aorta; hidden with the CT, which they don't match
export const roomModelAnat=new THREE.Group();tableG.add(roomModelAnat);
CHAMBERS.forEach(c=>roomModelAnat.add(ellMesh(new THREE.MeshBasicMaterial({color:c.col,transparent:true,opacity:0.45,depthWrite:false}),c.c,c.r)));
export const roomVesselMat={L:new THREE.MeshBasicMaterial({color:tok('--accent')}),R:new THREE.MeshBasicMaterial({color:tok('--cool')})};
// model tree; swapped for the CT's tree (roomCTTree) once the DRR is running
export const roomModelTree=new THREE.Group(),roomCTTree=new THREE.Group(),roomCTCh=new THREE.Group();roomCTTree.visible=roomCTCh.visible=false;tableG.add(roomModelTree,roomCTTree,roomCTCh);
Object.values(built).forEach(b=>{const g=b.geo.clone();roomModelTree.add(new THREE.Mesh(g,roomVesselMat[b.v.sys]));});
roomModelAnat.add(new THREE.Mesh(taperTube(ao,1.45,1.2,0).geo,new THREE.MeshBasicMaterial({color:'#c97fb6',transparent:true,opacity:.5,depthWrite:false})));
export const roomHiMat=new THREE.MeshBasicMaterial({color:0xffffff});
// CT mode's guide catheters (JL4, JR4) in the room, shown for the injected side
export const roomCathMat=new THREE.MeshStandardMaterial({color:0x9aa3aa,roughness:.5}),roomCath=[],catName={};
export const roomChHiMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.45,depthWrite:false,side:THREE.DoubleSide});
document.getElementById('roomLegend').innerHTML=`<span><i style="background:var(--accent)"></i>Left coronary</span><span><i style="background:var(--cool)"></i>Right coronary</span>`;

// C-arm, built in a local frame: Y = detector direction, Z = toward the head along the arc
export const carm=new THREE.Group();carm.matrixAutoUpdate=false;rScene.add(carm);
const metal=new THREE.MeshStandardMaterial({color:0xd6dadd,roughness:.45,metalness:.25});
const dark=new THREE.MeshStandardMaterial({color:0x22282d,roughness:.6});
const housing=new THREE.MeshStandardMaterial({color:0x3b444c,roughness:.55});
function roundRect(w,h,r){const s=new THREE.Shape(),x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
// arc: a rounded section, deep radially and narrow across, swept along a half circle of radius 88 from detector to tube
const arcPts=[];for(let i=0;i<=48;i++){const f=i/48*Math.PI;arcPts.push(new V3(0,88*Math.cos(f),88*Math.sin(f)));}
carm.add(new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(12,7,2.2),{steps:96,bevelEnabled:false,extrudePath:new THREE.CatmullRomCurve3(arcPts)}),metal));
// flat-panel detector: housing behind the image plane (y = SID − SOD), active area on the patient side
const armD=new THREE.Mesh(new THREE.BoxGeometry(7,40,9),metal);armD.position.y=68;carm.add(armD);
const detB=new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(42,42,4),{depth:8,bevelEnabled:true,bevelSize:1,bevelThickness:1,bevelSegments:2}).rotateX(-Math.PI/2),housing);
detB.position.y=SID-SOD+1;carm.add(detB);
const detFace=new THREE.Mesh(new THREE.BoxGeometry(31,0.5,31),dark);detFace.position.y=SID-SOD-0.2;carm.add(detFace);
// X-ray tube under the table: housing round the focal spot (y = −SOD), collimator toward the patient
const armS=new THREE.Mesh(new THREE.BoxGeometry(7,6,9),metal);armS.position.y=-86;carm.add(armS);
const srcB=new THREE.Mesh(new THREE.CylinderGeometry(9,9,30,28).rotateZ(Math.PI/2),metal);srcB.position.y=-SOD-6;carm.add(srcB);
const coll=new THREE.Mesh(new THREE.CylinderGeometry(6,9,8,4,1).rotateY(Math.PI/4),housing);coll.position.y=-SOD+2;carm.add(coll);
// floor stand at the head end: column, horizontal arm on the patient's long axis (the LAO/RAO axis), and the
// holder the arc slides through for cranial/caudal. The arc always passes through (0, 0, −88), so the holder sits there
const standMat=new THREE.MeshStandardMaterial({color:0xbcc2c6,roughness:.5,metalness:.15});
const column=new THREE.Mesh(new THREE.BoxGeometry(26,112,26),standMat);column.position.set(0,-54,-152);rScene.add(column);
const standBase=new THREE.Mesh(new THREE.BoxGeometry(60,4,60),housing);standBase.position.set(0,-108,-152);rScene.add(standBase);
const hArm=new THREE.Mesh(new THREE.BoxGeometry(16,16,52),standMat);hArm.position.set(0,0,-127);rScene.add(hArm);
const bearing=new THREE.Mesh(new THREE.CylinderGeometry(10,10,5,28).rotateX(Math.PI/2),housing);bearing.position.set(0,0,-100.5);rScene.add(bearing);
export const holder=new THREE.Mesh(new THREE.BoxGeometry(14,26,12),standMat);holder.position.set(0,0,-92);rScene.add(holder);
export const beamGeo=new THREE.BufferGeometry();beamGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(16*3),3));
const beam=new THREE.LineSegments(beamGeo,new THREE.LineBasicMaterial({color:tok('--accent'),transparent:true,opacity:.75}));rScene.add(beam);
const iso=new THREE.Mesh(new THREE.SphereGeometry(0.9,10,8),new THREE.MeshBasicMaterial({color:tok('--accent')}));rScene.add(iso);
