// The room view: table, patient, C-arm and stand, with the heart (model or CT) on the table.
import {reduce,tok,app,state} from './state.js';
import {SOD,SID,deg,dirs} from '../geometry.js';
import {CHAMBERS,ao,built,ellMesh} from './model.js';
import {taperTube} from './tubes.js';
import {DEFAULT_BODY,buildPatient,buildSkeleton} from './patient.js';
import {HEART_U,HEART_GLSL} from '../drr/heart.js';
const V3=THREE.Vector3;

// Cardiac motion for a built-in material: the same displacement the image uses (hfw), so the room's heart beats
// with it during a cine run. The meshes are in the anatomy's frame, like the overlay's.
export function beat(mat){
  mat.onBeforeCompile=s=>{Object.assign(s.uniforms,HEART_U);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\n'+HEART_GLSL).replace('#include <begin_vertex>','vec3 transformed=hfw(position);');};
  return mat;}

/* ---------- Room scene ---------- */
export const rCanvas=document.getElementById('roomc');
export const rr=new THREE.WebGLRenderer({canvas:rCanvas,antialias:true});
rr.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
rr.setClearColor(new THREE.Color(tok('--panel2')));
export const rScene=new THREE.Scene();
export const rcam=new THREE.PerspectiveCamera(40,4/3,5,2000);
rcam.position.set(185,120,150);
export const orbit=new THREE.OrbitControls(rcam,rCanvas);orbit.target.set(0,-15,-5);orbit.enableDamping=!reduce;orbit.minDistance=90;orbit.maxDistance=520;orbit.update();
// Camera: the whole room, close on the heart (which sits at the isocentre plus the table offset, and is followed),
// or from the detector: looking back down the beam at the isocentre, with the image's "up", so the heart is seen
// the way the fluoro image shows it. That view follows the C-arm, so it can't be orbited. It uses a narrow lens
// from beyond the detector (which, with the rest of the C-arm, is hidden). A square frame marks the image's field at
// the isocentre; the view starts wider than that, so the whole heart shows.
const ROOM_CAM={target:new V3(0,-15,-5),pos:new V3(185,120,150),min:90,max:520},HEART_CAM={dist:30,min:12,max:160};
const DET={fov:9,clip:30,zoom:0.55},UP=new V3(0,1,0),FOV=40,NEAR=5;
const camT=ROOM_CAM.target.clone();   // what the camera looks at
let camTween=null;const lastOff=new V3();
function detPose(){const {d,t}=dirs(state.lao,state.cra),field=state.fov*SOD/SID/DET.zoom;
  return {pos:d.multiplyScalar(field/2/Math.tan(DET.fov*deg/2)/Math.min(1,rcam.aspect)),up:t};}
const HINTS={room:'Drag to orbit · scroll to zoom',heart:'Drag to orbit · scroll to zoom',det:'As in the image (square) · follows the C-arm'};
export function setRoomView(v){
  app.roomView=v;document.querySelectorAll('#roomViewSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rv===v)));
  document.querySelector('#room .hint').textContent=HINTS[v];
  const heart=v==='heart',det=v==='det';let toT,toP,toUp=UP,toFov=FOV;
  if(det){const p=detPose();toT=new V3();toP=p.pos;toUp=p.up;toFov=DET.fov;}
  else if(heart){toT=tableG.position.clone();
    // keep the current viewing direction when closing in, so the heart is seen from where you were looking
    const dir=rcam.position.clone().sub(camT).normalize();if(Math.abs(dir.y)>0.97)dir.add(new V3(0,0,0.3)).normalize();   // not straight down: the orbit needs an "up"
    toP=toT.clone().addScaledVector(dir,HEART_CAM.dist);}
  else{toT=ROOM_CAM.target.clone();toP=ROOM_CAM.pos.clone();}
  orbit.enabled=false;   // back on, with its limits, once the move ends (not from the detector)
  styleRoom();
  camTween={t0:performance.now(),dur:reduce?0:700,fromT:camT.clone(),fromP:rcam.position.clone(),fromUp:rcam.up.clone(),fromFov:rcam.fov,toT,toP,toUp:toUp.clone(),toFov,
    min:heart?HEART_CAM.min:ROOM_CAM.min,max:heart?HEART_CAM.max:ROOM_CAM.max};
}
export function roomCamStep(now){
  const off=tableG.position,det=app.roomView==='det';
  if(camTween){const c=camTween,k=c.dur?Math.min(1,(now-c.t0)/c.dur):1,e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    if(app.roomView==='heart')c.toT.copy(off);    // the table may move during the transition
    if(det){const p=detPose();c.toP.copy(p.pos);c.toUp.copy(p.up);}   // and so may the C-arm
    camT.lerpVectors(c.fromT,c.toT,e);rcam.position.lerpVectors(c.fromP,c.toP,e);
    rcam.up.lerpVectors(c.fromUp,c.toUp,e).normalize();rcam.fov=c.fromFov+(c.toFov-c.fromFov)*e;
    if(k>=1){camTween=null;if(!det){rcam.up.copy(UP);orbit.target.copy(camT);orbit.minDistance=c.min;orbit.maxDistance=c.max;orbit.enabled=true;}}}
  else if(det){const p=detPose();camT.set(0,0,0);rcam.position.copy(p.pos);rcam.up.copy(p.up);}
  else if(app.roomView==='heart'&&!off.equals(lastOff)){const dv=off.clone().sub(lastOff);orbit.target.add(dv);rcam.position.add(dv);}
  lastOff.copy(off);
  if(camTween||det)rcam.lookAt(camT);else{orbit.update();camT.copy(orbit.target);}
  // from the detector, cut away what lies between the camera and the patient
  rcam.near=det?Math.max(NEAR,rcam.position.distanceTo(camT)-DET.clip):NEAR;rcam.updateProjectionMatrix();
  carm.visible=beam.visible=cone.visible=!det;field.visible=det;
}
rCanvas.addEventListener('wheel',e=>{if(app.roomView!=='det')return;e.preventDefault();DET.zoom=Math.max(0.5,Math.min(4,DET.zoom*(e.deltaY>0?1/1.1:1.1)));},{passive:false});
rScene.add(new THREE.HemisphereLight(0xdfe8ee,0x2a2f33,0.85));
const dl=new THREE.DirectionalLight(0xffffff,0.6);dl.position.set(120,220,-80);rScene.add(dl);
// a light from the camera, so the side of the heart you're looking at is never in shadow
const headlight=new THREE.DirectionalLight(0xffffff,0.35);rcam.add(headlight);rScene.add(rcam);
const grid=new THREE.GridHelper(420,21,tok('--line'),tok('--line'));grid.position.y=-110;rScene.add(grid);

/* ---------- Table and patient ---------- */
// tableG carries everything that moves with the table. The patient lies with the heart at the isocentre, so the
// body's midline, and the table under it, sit to one side by the heart's offset; the table top is at the back.
export const tableG=new THREE.Group();rScene.add(tableG);
const tableMat=new THREE.MeshStandardMaterial({color:0x3a444d,roughness:.8}),padMat=new THREE.MeshStandardMaterial({color:0x232a30,roughness:.95});
const railMat=new THREE.MeshStandardMaterial({color:0xaab2b8,roughness:.4,metalness:.3});
const skin=new THREE.MeshStandardMaterial({color:0xa9bdc9,transparent:true,opacity:0.24,depthWrite:false,roughness:.9,side:THREE.DoubleSide});
const boneMat=new THREE.MeshStandardMaterial({color:0xddd6c1,roughness:.7,transparent:true}),cartMat=new THREE.MeshStandardMaterial({color:0x9fb1bb,roughness:.7,transparent:true});
const textMat=[];
// a word that always faces the camera
function word(txt,h){const c=document.createElement('canvas'),x=c.getContext('2d'),tex=new THREE.CanvasTexture(c);
  const draw=()=>{const f='600 56px "Archivo Narrow","Arial Narrow",sans-serif';x.font=f;c.width=Math.ceil(x.measureText(txt).width)+20;c.height=72;
    x.font=f;x.textAlign='center';x.textBaseline='middle';x.fillStyle=tok('--silver');x.fillText(txt,c.width/2,38);tex.needsUpdate=true;sp.scale.set(h*c.width/c.height,h,1);};
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,opacity:.9}));
  draw();if(document.fonts)document.fonts.ready.then(draw);   // again once the display font has loaded
  return sp;}
let patientG=null,skelG=null,tableTop=null;
// p: the chest landmarks (chest.json's params) of a CT heart, or the default body; bones only with a CT's landmarks
export function fitPatient(p,bones){
  [patientG,skelG,tableTop].forEach(o=>{if(o){tableG.remove(o);o.traverse(m=>m.geometry&&m.geometry.dispose());}});
  const pt=buildPatient(p,skin);patientG=pt.group;tableG.add(patientG);
  skelG=bones?buildSkeleton(p,boneMat,cartMat):null;if(skelG)tableG.add(skelG);
  const y=pt.back,x=pt.x0,add=(geo,mat,px,py,pz)=>{const m=new THREE.Mesh(geo,mat);m.position.set(px,py,pz);tableTop.add(m);return m;};
  tableTop=new THREE.Group();tableG.add(tableTop);
  add(new THREE.BoxGeometry(58,2.4,218),tableMat,x,y-2.6,47);                       // carbon-fibre top
  add(new THREE.BoxGeometry(54,1.4,206),padMat,x,y-0.7,45);                         // mattress
  [-1,1].forEach(s=>add(new THREE.CylinderGeometry(0.9,0.9,120,10).rotateX(Math.PI/2),railMat,x+s*30.2,y-3,92));   // side rails
  const floor=-106,top=y-3.8;
  add(new THREE.BoxGeometry(30,top-floor,40),tableMat,x,(top+floor)/2,116);         // pedestal, at the foot end
  add(new THREE.BoxGeometry(60,4,76),tableMat,x,-108,116);
  // which way the patient lies: words by the head and feet, and at the patient's right and left
  [['Head',x,y+26,-40],['Feet',x,y+20,138],['Patient’s right',x-p.body_a-18,y+9,6],['Patient’s left',x+p.body_a+18,y+9,6]]
    .forEach(([t,px,py,pz])=>{const s=word(t,5.5);s.position.set(px,py,pz);s.userData.word=true;tableTop.add(s);});
  styleRoom();
}
// skin and bones fade in the close views, so they don't wash the heart out; the Skeleton switch hides the bones
export function styleRoom(){
  const close=app.roomView!=='room';
  skin.opacity=close?0.05:0.24;
  boneMat.opacity=cartMat.opacity=close?0.07:1;boneMat.depthWrite=cartMat.depthWrite=!close;
  if(skelG)skelG.visible=state.skel;
  if(tableTop)tableTop.children.forEach(o=>{if(o.userData.word)o.visible=!close;});   // the words are for the whole room; close up, the corner figure does it
}
export const hasSkeleton=()=>!!skelG;
// model chambers and aorta; hidden with the CT, which they don't match
export const roomModelAnat=new THREE.Group();tableG.add(roomModelAnat);
CHAMBERS.forEach(c=>roomModelAnat.add(ellMesh(new THREE.MeshStandardMaterial({color:c.col,transparent:true,opacity:0.6,depthWrite:false,roughness:.7}),c.c,c.r)));
// lit, with some glow of their own so the two trees keep their colours in shadow
const vesselMat=n=>{const c=new THREE.Color(tok(n));return beat(new THREE.MeshStandardMaterial({color:c,emissive:c.clone().multiplyScalar(0.45),roughness:.45}));};
export const roomVesselMat={L:vesselMat('--accent'),R:vesselMat('--cool')};
// the same vessels again, faintly, wherever something is in front of them: a solid heart doesn't hide the far side's
// arteries, which the image shows too
const ghostMat=n=>beat(new THREE.MeshBasicMaterial({color:tok(n),transparent:true,opacity:.5,depthFunc:THREE.GreaterDepth,depthWrite:false}));
export const roomGhostMat={L:ghostMat('--accent'),R:ghostMat('--cool')};
// model tree; swapped for the CT's tree (roomCTTree) once the DRR is running
export const roomModelTree=new THREE.Group(),roomCTTree=new THREE.Group(),roomCTCh=new THREE.Group();roomCTTree.visible=roomCTCh.visible=false;tableG.add(roomModelTree,roomCTTree,roomCTCh);
Object.values(built).forEach(b=>{const g=b.geo.clone();roomModelTree.add(new THREE.Mesh(g,roomVesselMat[b.v.sys]));});
roomModelAnat.add(new THREE.Mesh(taperTube(ao,1.45,1.2,0).geo,new THREE.MeshStandardMaterial({color:'#c97fb6',transparent:true,opacity:.6,depthWrite:false,roughness:.7})));
export const roomHiMat=beat(new THREE.MeshBasicMaterial({color:0xffffff}));
// CT mode's guide catheters (JL4, JR4) in the room, shown for the injected side
export const roomCathMat=beat(new THREE.MeshStandardMaterial({color:0x9aa3aa,roughness:.5})),roomCath=[],catName={};
export const roomChHiMat=beat(new THREE.MeshStandardMaterial({color:0xffffff,emissive:0x555555,roughness:.6,side:THREE.DoubleSide}));
document.getElementById('roomLegend').innerHTML=`<span><i style="background:var(--accent)"></i>Left coronary</span><span><i style="background:var(--cool)"></i>Right coronary</span>`;

// C-arm, built in a local frame: Y = detector direction, Z = toward the head along the arc
export const carm=new THREE.Group();carm.matrixAutoUpdate=false;rScene.add(carm);
const metal=new THREE.MeshStandardMaterial({color:0xd6dadd,roughness:.45,metalness:.25});
const dark=new THREE.MeshStandardMaterial({color:0x22282d,roughness:.6});
const housing=new THREE.MeshStandardMaterial({color:0x3b444c,roughness:.55});
const rubber=new THREE.MeshStandardMaterial({color:0x6a7680,roughness:.9});
function roundRect(w,h,r){const s=new THREE.Shape(),x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
// arc: a rounded section, deep radially and narrow across, swept along a half circle of radius 88 from detector to tube
const arcPts=[];for(let i=0;i<=48;i++){const f=i/48*Math.PI;arcPts.push(new V3(0,88*Math.cos(f),88*Math.sin(f)));}
carm.add(new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(12,7,2.2),{steps:96,bevelEnabled:false,extrudePath:new THREE.CatmullRomCurve3(arcPts)}),metal));
// flat-panel detector: housing behind the image plane (y = SID − SOD), active area on the patient side
const armD=new THREE.Mesh(new THREE.CylinderGeometry(6.5,4.6,34,24),metal);armD.position.y=68;carm.add(armD);
const yoke=new THREE.Mesh(new THREE.CylinderGeometry(15,17,3,32),metal);yoke.position.y=SID-SOD+10.5;carm.add(yoke);
const detB=new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(42,42,4),{depth:8,bevelEnabled:true,bevelSize:1,bevelThickness:1,bevelSegments:2}).rotateX(-Math.PI/2),housing);
detB.position.y=SID-SOD+1;carm.add(detB);
const detFace=new THREE.Mesh(new THREE.BoxGeometry(31,0.5,31),dark);detFace.position.y=SID-SOD-0.2;carm.add(detFace);
// the bumper round the detector's face, which stops it touching the patient
const bumper=new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(44.5,44.5,5),{depth:1.6,bevelEnabled:false}).rotateX(-Math.PI/2),rubber);bumper.position.y=SID-SOD+0.2;carm.add(bumper);
// X-ray tube under the table: housing round the focal spot (y = −SOD), collimator toward the patient
const armS=new THREE.Mesh(new THREE.BoxGeometry(7,6,9),metal);armS.position.y=-86;carm.add(armS);
const srcB=new THREE.Mesh(new THREE.CylinderGeometry(9,9,30,28).rotateZ(Math.PI/2),metal);srcB.position.y=-SOD-6;carm.add(srcB);
[-1,1].forEach(s=>{const cap=new THREE.Mesh(new THREE.CylinderGeometry(9.4,9.4,3,28).rotateZ(Math.PI/2),housing);cap.position.set(s*14.5,-SOD-6,0);carm.add(cap);});
const collBox=new THREE.Mesh(new THREE.BoxGeometry(17,7,17),housing);collBox.position.y=-SOD+5.5;carm.add(collBox);
const coll=new THREE.Mesh(new THREE.CylinderGeometry(7,10.5,5,4,1).rotateY(Math.PI/4),dark);coll.position.y=-SOD+11.5;carm.add(coll);
// floor stand at the head end: column, horizontal arm on the patient's long axis (the LAO/RAO axis), and the
// holder the arc slides through for cranial/caudal. The arc always passes through (0, 0, −88), so the holder sits there
const standMat=new THREE.MeshStandardMaterial({color:0xbcc2c6,roughness:.5,metalness:.15});
const column=new THREE.Mesh(new THREE.ExtrudeGeometry(roundRect(28,26,6),{depth:112,bevelEnabled:false}).rotateX(-Math.PI/2),standMat);column.position.set(0,-110,-152);rScene.add(column);
const standBase=new THREE.Mesh(new THREE.BoxGeometry(60,4,60),housing);standBase.position.set(0,-108,-152);rScene.add(standBase);
const hArm=new THREE.Mesh(new THREE.BoxGeometry(16,16,52),standMat);hArm.position.set(0,0,-127);rScene.add(hArm);
const bearing=new THREE.Mesh(new THREE.CylinderGeometry(10,10,5,28).rotateX(Math.PI/2),housing);bearing.position.set(0,0,-100.5);rScene.add(bearing);
export const holder=new THREE.Mesh(new THREE.BoxGeometry(14,26,12),standMat);holder.position.set(0,0,-92);rScene.add(holder);
// beam: a faint cone from the focal spot to the detector's field, its edges, the field's outline and the central ray
const beamGeo=new THREE.BufferGeometry();beamGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(18*3),3));
const beam=new THREE.LineSegments(beamGeo,new THREE.LineBasicMaterial({color:tok('--accent'),transparent:true,opacity:.7}));rScene.add(beam);
const coneGeo=new THREE.BufferGeometry();coneGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(5*3),3));coneGeo.setIndex([0,1,2,0,2,3,0,3,4,0,4,1]);
const cone=new THREE.Mesh(coneGeo,new THREE.MeshBasicMaterial({color:tok('--accent'),transparent:true,opacity:.07,depthWrite:false,side:THREE.DoubleSide}));cone.renderOrder=5;rScene.add(cone);
// from the detector: the image's field, as a square at the isocentre
const fieldGeo=new THREE.BufferGeometry();fieldGeo.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(4*3),3));
const field=new THREE.LineLoop(fieldGeo,new THREE.LineBasicMaterial({color:tok('--scr'),transparent:true,opacity:.8,depthTest:false}));field.renderOrder=6;field.visible=false;rScene.add(field);
// s: focal spot, c: detector centre, cn: the field's four corners
export function setBeam(s,c,cn){
  const a=beamGeo.attributes.position.array;let k=0;const put=v=>{a[k++]=v.x;a[k++]=v.y;a[k++]=v.z;};
  cn.forEach(p=>{put(s);put(p);});for(let i=0;i<4;i++){put(cn[i]);put(cn[(i+1)%4]);}put(s);put(c);
  beamGeo.attributes.position.needsUpdate=true;beamGeo.computeBoundingSphere();
  const b=coneGeo.attributes.position.array;k=0;[s,...cn].forEach(v=>{b[k++]=v.x;b[k++]=v.y;b[k++]=v.z;});
  coneGeo.attributes.position.needsUpdate=true;coneGeo.computeBoundingSphere();
  // the same field where it crosses the isocentre
  const f=fieldGeo.attributes.position.array;k=0;cn.forEach(p=>{f[k++]=s.x+(p.x-s.x)*SOD/SID;f[k++]=s.y+(p.y-s.y)*SOD/SID;f[k++]=s.z+(p.z-s.z)*SOD/SID;});
  fieldGeo.attributes.position.needsUpdate=true;fieldGeo.computeBoundingSphere();
}
const iso=new THREE.Mesh(new THREE.SphereGeometry(0.7,10,8),new THREE.MeshBasicMaterial({color:tok('--accent')}));rScene.add(iso);

/* ---------- Which way up: a small figure in the corner that turns with the camera ---------- */
const gScene=new THREE.Scene(),gcam=new THREE.PerspectiveCamera(28,1,1,100),gDir=new V3();
gScene.add(new THREE.HemisphereLight(0xffffff,0x39424a,1.05));
{const m=new THREE.MeshStandardMaterial({color:0xb9c6cf,roughness:.8}),fig=buildPatient({midline_x:0,body_y:0,body_a:17,body_b:11},m).group;
  fig.position.set(0,0,-45);const g=new THREE.Group();g.add(fig);g.scale.setScalar(0.1);gScene.add(g);
  [['R',-4.6,0,-1.5],['L',4.6,0,-1.5]].forEach(([t,x,y,z])=>{const w=word(t,4.2);w.position.set(x,y,z);gScene.add(w);});}
// draws the room, then the figure in the bottom right corner, seen from the same direction
export function drawRoom(){
  rr.setViewport(0,0,rCanvas.clientWidth,rCanvas.clientHeight);rr.autoClear=true;rr.render(rScene,rcam);
  const W=rCanvas.clientWidth,n=Math.round(Math.max(56,Math.min(92,W*0.24)));
  rcam.getWorldDirection(gDir);gcam.position.copy(gDir).multiplyScalar(-46);gcam.up.copy(rcam.up);gcam.lookAt(0,0,0);
  rr.autoClear=false;rr.clearDepth();rr.setViewport(W-n-4,4,n,n);rr.render(gScene,gcam);rr.autoClear=true;
}
fitPatient(DEFAULT_BODY,false);
