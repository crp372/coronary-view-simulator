// Cardiac motion, shared by the DRR engine and index.html's overlay.
const V3=THREE.Vector3;
// Cardiac motion, shared by the DRR (raw WebGL uniforms), the overlay materials and the CPU (catheter, labels, picking).
// The volumes are the reference heart (end-diastole). Each frame, hdisp(q) gives the displacement of a reference point:
//   - long-axis shortening: the AV plane descends toward the apex, which barely moves; tapering off up into the atria
//     and aortic root
//   - radial squeeze toward the long axis, and twist (base and apex turn opposite ways)
//   - a pendulum-like swing of the whole heart, and a smooth uneven field so parts of the tree move differently
// Each has its own time course over the beat (heartPhase), out of step with the others, so points trace loops rather
// than lines. Everything fades out between the heart's radius and 1.5 × it, so bone and chest wall stay still.
// uHc: centre; uHax: long axis, base → apex; uHm = (on, apex level, AV level, radius) along the axis;
// uHk = (radial squeeze fraction, AV descent cm, twist rad); uHt = this frame's (shortening, squeeze, twist, uneven
// field cm) phases; uHtr = this frame's swing (cm); uHb = (buckling amplitude this frame, wavelength), cm: as the
// heart shortens, vessels tethered to its surface buckle, so they turn wavy in systole and straighten in diastole.
// Frame from the CT chambers once loaded (heartFrame). Amplitudes tuned against a real RAO caudal cine (CC BY).
export const HEART_U={uHc:{value:new V3()},uHax:{value:new V3(0.69,0.40,0.60).normalize()},uHk:{value:new V3(0.10,1.7,0.18)},uHm:{value:new THREE.Vector4(0,6,-3,7)},
  uHt:{value:new THREE.Vector4()},uHtr:{value:new V3()},uHb:{value:new THREE.Vector2(0,3.2)}};
export const HEART_CORE=`uniform vec3 uHc,uHax,uHk,uHtr;uniform vec4 uHm,uHt;uniform vec2 uHb;
  vec3 hfield(vec3 q){return vec3(sin(dot(q,vec3(.31,.17,-.22))+1.3),sin(dot(q,vec3(-.19,.28,.13))+4.1),sin(dot(q,vec3(.11,-.24,.29))+2.2))
    +.5*vec3(sin(dot(q,vec3(.47,-.29,.21))+.7),sin(dot(q,vec3(.23,.41,-.37))+2.9),sin(dot(q,vec3(-.39,.18,.44))+5.3));}
  vec3 hdisp(vec3 q){vec3 d=q-uHc;float len=length(d),wg=1.-smoothstep(uHm.w,1.5*uHm.w,len);if(wg<=0.)return vec3(0.);
    float h=dot(d,uHax);vec3 r=d-h*uHax;float base=clamp((uHm.y-h)/max(uHm.y-uHm.z,1.),0.,1.);
    float lw=base*(1.-.6*clamp((uHm.z-h)/3.,0.,1.));
    float th=uHt.z*uHk.z*(1.-2.*base);vec3 rr=(r*cos(th)+cross(uHax,r)*sin(th))*(1.-uHt.y*uHk.x);
    float rl=max(length(r),.5);vec3 cir=cross(uHax,r)/rl;float k=6.2832/uHb.y;
    float ang=atan(cir.y,r.x/rl);vec3 bk=uHb.x*(cir*sin(k*h+1.7*q.x)+uHax*sin(k*rl*ang*.5));
    return wg*((rr-r)+uHax*(uHt.x*uHk.y*lw)+uHtr+uHt.w*hfield(q)+bk);}`;
export const HEART_GLSL=HEART_CORE+`
  vec3 hfw(vec3 p){return uHm.x>0.?p+hdisp(p):p;}`;
// the same on the CPU
const _hd=new V3(),_hr=new V3(),_hx=new V3();
export function heartDisp(q,out){const H=HEART_U,c=H.uHc.value,ax=H.uHax.value,k=H.uHk.value,m=H.uHm.value,t=H.uHt.value;
  const d=_hd.copy(q).sub(c),len=d.length(),f=Math.min(1,Math.max(0,(len-m.w)/(0.5*m.w))),wg=1-f*f*(3-2*f);
  if(wg<=0)return out.set(0,0,0);
  const h=d.dot(ax),r=_hr.copy(d).addScaledVector(ax,-h),base=Math.min(1,Math.max(0,(m.y-h)/Math.max(m.y-m.z,1)));
  const lw=base*(1-0.6*Math.min(1,Math.max(0,(m.z-h)/3))),th=t.z*k.z*(1-2*base);
  const rr=_hx.crossVectors(ax,r).multiplyScalar(Math.sin(th)).addScaledVector(r,Math.cos(th)).multiplyScalar(1-t.y*k.x);
  const rl=Math.max(r.length(),0.5),cir=new V3().crossVectors(ax,r).divideScalar(rl),kk=2*Math.PI/H.uHb.value.y;
  const ang=Math.atan2(cir.y,r.x/rl),bk=cir.clone().multiplyScalar(Math.sin(kk*h+1.7*q.x)).addScaledVector(ax,Math.sin(kk*rl*ang*0.5)).multiplyScalar(H.uHb.value.x);
  const F=(a,b,c2,ph)=>Math.sin(a*q.x+b*q.y+c2*q.z+ph);
  const fx=F(.31,.17,-.22,1.3)+.5*F(.47,-.29,.21,.7),fy=F(-.19,.28,.13,4.1)+.5*F(.23,.41,-.37,2.9),fz=F(.11,-.24,.29,2.2)+.5*F(-.39,.18,.44,5.3);
  return out.copy(rr).sub(r).addScaledVector(ax,t.x*k.y*lw).add(H.uHtr.value).add(_hx.set(fx,fy,fz).multiplyScalar(t.w)).add(bk).multiplyScalar(wg);}
const _hf=new V3();
export function heartForward(p,out){out.copy(p);if(HEART_U.uHm.value.x<=0)return out;return out.add(heartDisp(p,_hf));}
// Time courses over one beat (t in s), from the LV volume curve: isovolumic contraction, ejection to end-systole at about
// 35% of the cycle, isovolumic relaxation, rapid filling (most of the recovery), slow diastasis, then the atrial kick.
// Twist peaks at end-systole and unwinds early in diastole, ahead of the volume; the swing and the uneven field run on
// their own phases, so trajectories are loops.
export const HR=72,CYCLE=60/HR;
const ease=x=>x<=0?0:x>=1?1:0.5-0.5*Math.cos(Math.PI*x);
export function lvCurve(f){   // 0 at end-diastole, 1 at end-systole
  if(f<0.06)return 0.03*ease(f/0.06);
  if(f<0.36)return 0.03+0.97*ease((f-0.06)/0.30);
  if(f<0.43)return 1;
  if(f<0.62)return 1-0.72*ease((f-0.43)/0.19);
  if(f<0.84)return 0.28-0.10*ease((f-0.62)/0.22);
  if(f<0.95)return 0.18-0.18*ease((f-0.84)/0.11);
  return 0;}
export function heartPhase(t,on){
  const H=HEART_U;H.uHm.value.x=on?1:0;if(!on){H.uHt.value.set(0,0,0,0);H.uHtr.value.set(0,0,0);H.uHb.value.x=0;return;}
  const f=(t%CYCLE)/CYCLE,w=2*Math.PI*f;
  const twist=f<0.34?ease((f-0.04)/0.30):f<0.52?1-ease((f-0.36)/0.16):0;
  // every component is zero at the start of the beat (end-diastole, the CT's own shape), so runs start and end cleanly
  H.uHt.value.set(lvCurve(f),lvCurve((f+0.985)%1),twist,0.25*(0.55*lvCurve(f)+0.45*(Math.sin(w+1.1)-Math.sin(1.1))));
  H.uHb.value.x=0.32*lvCurve(f);
  // swing: mostly toward the apex and forward in systole, with a sideways component a quarter-beat out of step
  const ax=H.uHax.value,sw=lvCurve((f+0.96)%1),side=Math.sin(w-0.6)-Math.sin(-0.6);
  H.uHtr.value.copy(ax).multiplyScalar(0.4*sw).add(new V3(0,0.3*sw,0)).add(new V3(-ax.y,ax.x,0).normalize().multiplyScalar(0.25*side));}
// the CT heart's frame for cardiac motion: long axis from the LA's centre to the LV apex (the LV vertex farthest
// from it), centre between the ventricles, AV plane 40% of the way from the LA's centre to the LV's, radius = the
// farthest ventricular vertex
// chambers: loadScan()'s list
export function heartFrame(chambers){
  const by=id=>chambers.find(c=>c.s.id===id),lv=by('LV'),rv=by('RV'),la=by('LA');if(!lv||!rv||!la)return;
  const cLV=new V3(...lv.s.centroid_cm),cRV=new V3(...rv.s.centroid_cm),cLA=new V3(...la.s.centroid_cm);
  const pos=lv.geometry.attributes.position,q=new V3();let apex=null,best=-1;
  for(let i=0;i<pos.count;i++){q.fromBufferAttribute(pos,i);const d=q.distanceTo(cLA);if(d>best){best=d;apex=q.clone();}}
  const c=cLV.clone().add(cRV).multiplyScalar(0.5),ax=apex.clone().sub(cLA).normalize();
  let R=0;for(const m of [lv,rv]){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)R=Math.max(R,q.fromBufferAttribute(p,i).distanceTo(c));}
  const av=cLA.clone().lerp(cLV,0.4);
  HEART_U.uHc.value.copy(c);HEART_U.uHax.value.copy(ax);
  HEART_U.uHm.value.set(HEART_U.uHm.value.x,apex.clone().sub(c).dot(ax),av.sub(c).dot(ax),R);
}
