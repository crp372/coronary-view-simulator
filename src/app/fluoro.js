// The fluoro monitor's Three.js canvas: the model-heart image (fallback), and the anatomy overlay in both modes.
import {app} from './state.js';
import {VESSELS,CHAMBERS,root,ao,paPts,built,ellMesh,worldEll} from './model.js';
import {addConst,taperTube} from './tubes.js';
import {HEART_U,HEART_GLSL} from '../drr/heart.js';
const V3=THREE.Vector3;
export const mon=document.getElementById('monitor'),drrCv=document.getElementById('drr');

/* Fluoro attenuation shader: each surface subtracts density ∝ local thickness, so overlaps darken like contrast does */
function densMat(dens,useFill){
  return new THREE.ShaderMaterial({
    uniforms:{dens:{value:dens},fill:{value:999},wash:{value:1},useFill:{value:useFill?1:0}},
    vertexShader:'attribute float rad;attribute float sdist;varying vec3 vN;varying vec3 vP;varying float vR;varying float vS;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vN=normalMatrix*normal;vP=mv.xyz;vR=rad;vS=sdist;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform float dens;uniform float fill;uniform float wash;uniform float useFill;varying vec3 vN;varying vec3 vP;varying float vR;varying float vS;void main(){float f=abs(dot(normalize(vN),normalize(-vP)));float d=dens*(0.025+vR)*f;if(useFill>0.5){d*=1.0-smoothstep(fill-0.8,fill,vS);d*=wash;}gl_FragColor=vec4(vec3(d),1.0);}',
    transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.CustomBlending,blendEquation:THREE.ReverseSubtractEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    // leave alpha alone: the canvas has an alpha channel so it can sit transparently over the DRR
    blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor
  });
}

/* ---------- Fluoro scene ---------- */
const fCanvas=document.getElementById('fluoro');
// alpha: in DRR mode this canvas is cleared to transparent and only carries the anatomy overlay
export const fr=new THREE.WebGLRenderer({canvas:fCanvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
fr.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
export const fluoroBg=new THREE.Color('#cdcdc7');fr.setClearColor(fluoroBg,1);
export const fScene=new THREE.Scene(), oScene=new THREE.Scene();
export const fcam=new THREE.PerspectiveCamera(10,1,1,300);
export const anat=new THREE.Group(); fScene.add(anat);
export const ovl=new THREE.Group(); oScene.add(ovl);

const matV=densMat(1.45,true), matCath=densMat(2.6,false), matBone=densMat(0.055,false), matRib=densMat(0.09,false), matSoft=densMat(0.045,false), matDia=densMat(0.03,false);
export const sysGroups={L:new THREE.Group(),R:new THREE.Group()}; anat.add(sysGroups.L,sysGroups.R);
Object.values(built).forEach(b=>sysGroups[b.v.sys].add(new THREE.Mesh(b.geo,matV)));

// guide catheters up the aorta into each ostium
function cathPts(ost){return [ao[7],ao[6],ao[5],ao[4],ao[3],ao[2],root.clone().add(new V3(-1.1,0.7,-4)),root.clone().add(new V3(-0.6,0.5,-1.4)),ost];}
['L','R'].forEach(s=>{const ost=s==='L'?VESSELS[0].pts[0]:VESSELS[9].pts[0];const t=taperTube(cathPts(ost),0.1,0.1,0);sysGroups[s].add(new THREE.Mesh(t.geo,matCath));});

// cardiac silhouette, diaphragm
CHAMBERS.forEach(c=>anat.add(ellMesh(matSoft,c.c,c.r.map(x=>x*1.25))));
anat.add(new THREE.Mesh(taperTube(ao.slice(0,5),1.5,1.4,0).geo,matSoft));
anat.add(worldEll(matDia,new V3(-5,-1,16.5),[12,11,11]));
anat.add(worldEll(matDia,new V3(7,-1,18),[10,10,10]));

// spine and ribs
export const bones=new THREE.Group(); anat.add(bones);
const vbGeo=addConst(new THREE.CylinderGeometry(2.2,2.2,2.4,28).rotateX(Math.PI/2),1);
const pedGeo=addConst(new THREE.SphereGeometry(0.7,16,12),1);
for(let z=-30;z<=22;z+=3.05){const m=new THREE.Mesh(vbGeo,matBone);m.position.set(0,-10,z);bones.add(m);
  [-1.7,1.7].forEach(x=>{const p=new THREE.Mesh(pedGeo,matBone);p.position.set(x,-12.3,z-0.3);p.scale.set(1,1,1.4);bones.add(p);});}
for(let i=0;i<10;i++){const z0=-24+i*3.1;[-1,1].forEach(side=>{const pts=[];
  for(let k=0;k<=12;k++){const s=k/12,ang=-Math.PI/2+s*Math.PI*0.86;pts.push(new V3(side*(2+13.5*Math.cos(ang)),-1+11.5*Math.sin(ang),z0+s*s*5.5));}
  bones.add(new THREE.Mesh(taperTube(pts,0.55,0.45,0).geo,matRib));});}

// overlay: chambers and great vessels of the model heart (modelOvl), or the CT's coronary tree (ctOvl)
export const modelOvl=new THREE.Group(),ctOvl=new THREE.Group();ovl.add(modelOvl,ctOvl);
const ovMats={};
CHAMBERS.forEach(c=>{const m=new THREE.MeshBasicMaterial({color:c.col,transparent:true,opacity:0.26,depthTest:false,depthWrite:false,side:THREE.DoubleSide});ovMats[c.id]=m;modelOvl.add(ellMesh(m,c.c,c.r));});
const aoMat=new THREE.MeshBasicMaterial({color:'#c97fb6',transparent:true,opacity:0.26,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
const paMat=new THREE.MeshBasicMaterial({color:'#9a8be0',transparent:true,opacity:0.26,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
modelOvl.add(new THREE.Mesh(taperTube(ao,1.45,1.2,0).geo,aoMat));
modelOvl.add(new THREE.Mesh(taperTube(paPts,1.35,1.2,0).geo,paMat));
export const ovDir={value:new V3(0,1,0)};
export function ctOvlMat(col){return new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,side:THREE.DoubleSide,
  uniforms:{uD:ovDir,uCol:{value:new THREE.Color(col)},uHi:{value:0},...HEART_U},
  vertexShader:`uniform vec3 uD;varying float vNear;${HEART_GLSL}
    void main(){vec4 w=modelMatrix*vec4(hfw(position),1.);vNear=clamp(.5+dot(w.xyz,uD)/9.,0.,1.);gl_Position=projectionMatrix*viewMatrix*w;}`,
  fragmentShader:`uniform vec3 uCol;uniform float uHi;varying float vNear;
    void main(){vec3 c=mix(uCol*.5,uCol,vNear);gl_FragColor=vec4(mix(c,vec3(1.),uHi*.5),max(mix(.22,.62,vNear),uHi*.95));}`});}

// model version of the cine run: contrast fills from the ostium, holds, washes out
export function cineStep(now){
  const cine=app.cine;
  if(!cine){matV.uniforms.fill.value=999;matV.uniforms.wash.value=1;return;}
  const e=(now-cine.t0)/1000;let fill=999,wash=1;
  if(e<1.6)fill=0.5+32*(1-Math.pow(1-e/1.6,2));
  else if(e<3.4)fill=999;
  else if(e<4.4)wash=1-(e-3.4);
  else if(e<4.9)wash=0;
  else if(e<5.3)wash=(e-4.9)/0.4;
  else app.cine=null;
  matV.uniforms.fill.value=fill;matV.uniforms.wash.value=wash;
}
