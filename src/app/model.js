// The model heart: used for the fallback image, and for the room view until the CT loads.
import {deg} from '../geometry.js';
import {taperTube,sphereGeo} from './tubes.js';
const V3=THREE.Vector3;

/* ---------- Patient coordinates: x = patient's left, y = anterior (up, supine), z = feet. Isocentre at origin. ---------- */
export const u=new V3(0.69,0.40,0.60).normalize();               // heart long axis, base → apex
const dL=new V3(Math.SQRT1_2,Math.SQRT1_2,0);              // LAO 45 looks down the septum
export const ns=new V3().crossVectors(u,dL).normalize(); if(ns.y>0) ns.negate();   // septal normal, toward LV
export const w=new V3().crossVectors(ns,u).normalize(); if(w.y<0) w.negate();      // toward anterior IV groove
const O=u.clone().multiplyScalar(-3.5).add(new V3(0,0.3,0));               // base-plane centre
export const P=(a,b,c)=>O.clone().addScaledVector(u,a).addScaledVector(w,b).addScaledVector(ns,c);
const Rr=a=>{const k=(a+1)/10;return 4.2*Math.sqrt(Math.max(0,1-k*k));};
// a: distance along long axis from AV groove; th: angle around axis (0 ant IV groove, 90 obtuse margin, 180 post IV groove, 270 acute margin)
export const L=(a,th,rs=1)=>{const t=th*deg,r=Rr(a)*rs;return P(a,r*Math.cos(t),r*Math.sin(t));};

export const VESSELS=[
 {id:'LM',sys:'L',r:[0.22,0.2],lab:'LM',at:.45,pts:[P(-0.9,1.2,1.2),P(-0.4,2.4,1.9),L(0.1,30,0.98)]},
 {id:'LAD',sys:'L',parent:'LM',r:[0.18,0.05],lab:'LAD',at:.42,pts:[L(0.1,30,0.98),L(0.5,22),L(1.4,10),L(2.6,4),L(4,1),L(5.5,0),L(7,0),L(8.1,0),P(8.9,0.6,0.3),P(9.05,-0.2,0.2),L(8.6,180)]},
 {id:'D1',sys:'L',parent:'LAD',r:[0.12,0.04],lab:'D1',at:.6,pts:[L(1.9,7),L(3.2,30),L(4.8,52),L(6.4,64)]},
 {id:'D2',sys:'L',parent:'LAD',r:[0.09,0.035],lab:'D2',at:.65,pts:[L(4.2,1),L(5.4,25),L(6.9,42)]},
 {id:'S1',sys:'L',parent:'LAD',r:[0.07,0.03],lab:'Septal',at:.8,pts:[L(1.7,8),L(2.9,4,0.72),L(4.1,2,0.5)]},
 {id:'S2',sys:'L',parent:'LAD',r:[0.06,0.03],pts:[L(3.2,3),L(4.3,1,0.7),L(5.3,0,0.5)]},
 {id:'LCx',sys:'L',parent:'LM',r:[0.17,0.06],lab:'LCx',at:.55,pts:[L(0.1,30,0.98),L(0.0,52),L(0.0,78),L(0.1,104),L(0.2,128),L(0.35,148)]},
 {id:'OM1',sys:'L',parent:'LCx',r:[0.11,0.04],lab:'OM1',at:.7,pts:[L(0.0,80),L(1.8,86),L(3.8,91),L(5.6,95)]},
 {id:'OM2',sys:'L',parent:'LCx',r:[0.09,0.035],lab:'OM2',at:.75,pts:[L(0.15,114),L(2.0,117),L(3.9,121)]},
 {id:'RCA',sys:'R',r:[0.19,0.09],lab:'RCA',at:.5,pts:[P(-1.0,1.6,-1.3),P(-0.6,2.5,-2.5),L(-0.2,302),L(-0.1,280),L(0.0,258),L(0.1,234),L(0.2,206),L(0.3,182)]},
 {id:'Conus',sys:'R',parent:'RCA',r:[0.06,0.03],lab:'Conus',at:.9,pts:[P(-0.6,2.5,-2.5),L(0.7,322),L(1.5,342)]},
 {id:'SAN',sys:'R',parent:'RCA',r:[0.05,0.025],lab:'SA node',at:.95,pts:[P(-0.6,2.5,-2.5),P(-1.9,1.5,-3.2),P(-3.3,0.4,-2.8)]},
 {id:'AM',sys:'R',parent:'RCA',r:[0.08,0.03],lab:'AM',at:.75,pts:[L(0.0,264),L(1.9,262),L(3.8,258),L(5.3,255)]},
 {id:'PDA',sys:'R',parent:'RCA',r:[0.09,0.035],lab:'PDA',at:.7,pts:[L(0.3,182),L(1.6,180),L(3.4,180),L(5.4,180)]},
 {id:'PLV',sys:'R',parent:'RCA',r:[0.09,0.035],lab:'PLV',at:.8,pts:[L(0.3,182),L(0.35,166),L(0.6,152),L(2.1,146),L(3.6,141)]},
];
export const CHAMBERS=[
 {id:'LV',c:[4.0,-0.4,1.5],r:[4.4,2.6,2.5],col:'#e0645a'},
 {id:'RV',c:[3.0,0.9,-1.9],r:[3.7,2.2,2.0],col:'#5b8fd9'},
 {id:'LA',c:[-2.3,-2.0,1.5],r:[1.9,1.9,2.3],col:'#e39a4b'},
 {id:'RA',c:[-1.8,0.2,-3.2],r:[2.0,2.3,2.0],col:'#6fc2b8'},
];
export const root=P(-1.2,1.0,-0.3);
export const ao=[[0,0,0],[-1.2,0.8,-4],[-0.5,0.5,-8],[1.5,-1.0,-10.5],[4,-4,-10],[6,-6,-7],[6,-6.2,0],[5.8,-6.4,16]].map(p=>root.clone().add(new V3(...p)));
const pa0=P(-0.2,2.6,0.2);
export const paPts=[[0,0,0],[0.6,0.2,-2.8],[1.8,-1.2,-5.2],[3.8,-3.0,-6.2]].map(p=>pa0.clone().add(new V3(...p)));
export function ellMatrix(c,r){const m=new THREE.Matrix4().makeBasis(u,w,ns);m.scale(new V3(...r));m.setPosition(P(...c));return m;}
export function ellMesh(mat,c,r){const m=new THREE.Mesh(sphereGeo,mat);m.matrixAutoUpdate=false;m.matrix.copy(c.isMatrix4?c:ellMatrix(c,r));return m;}
export function worldEll(mat,center,radii){const m=new THREE.Mesh(sphereGeo,mat);m.position.copy(center);m.scale.set(...radii);return m;}

/* ---------- Build vessels ---------- */
export const built={};
VESSELS.forEach(v=>{
  let s0=0;
  if(v.parent){const pb=built[v.parent];let best=1e9,bt=0;const q=new V3();
    for(let i=0;i<=200;i++){pb.curve.getPointAt(i/200,q);const dd=q.distanceTo(v.pts[0]);if(dd<best){best=dd;bt=i/200;}}
    s0=pb.s0+bt*pb.len;}
  built[v.id]=Object.assign(taperTube(v.pts,v.r[0],v.r[1],s0),{v});
});
