// The patient on the table in the room view, and the chest's bones.
// Both are built in code from the same landmarks as the synthetic chest the fluoro image uses beyond the CT
// (chest.json's params, from tools/export_chest.py): midline, body centre and half-widths, spine, ribs, sternum,
// clavicles. So the room's skeleton sits where the image shows the bones, with no extra download. Keep the
// formulas in step with export_chest.py. Illustrative, like that chest: not this patient's own bones.
import {taperTube} from './tubes.js';
const V3=THREE.Vector3;
const c01=x=>Math.max(0,Math.min(1,x));
const interp=(x,xs,ys)=>{if(x<=xs[0])return ys[0];for(let i=1;i<xs.length;i++)if(x<=xs[i])return ys[i-1]+(ys[i]-ys[i-1])*(x-xs[i-1])/(xs[i]-xs[i-1]);return ys[ys.length-1];};
// without a CT (the model heart): a body centred on the isocentre
export const DEFAULT_BODY={midline_x:0,body_y:-1,body_a:17,body_b:12};
// body half-widths by level, as in export_chest.py: narrower at the thoracic inlet and over the abdomen
const bodyAB=(p,z)=>[p.body_a-2.5*c01((-z-12)/10)-1.0*c01((z-10)/10),p.body_b-1.5*c01((-z-12)/10)-0.8*c01((z-10)/10)];

// A surface through cross-sections along z: each [z, cx, cy, a, b] is an ellipse (pow > 2 squares it off).
// Sections are joined smoothly (Catmull-Rom), with `sub` rings between each pair, and the ends are closed.
function loft(secs,pow=2,sub=5,n=28){
  const cr=(a,b,c,d,t)=>0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
  const rings=[],m=secs.length;
  for(let i=0;i<m-1;i++)for(let k=0;k<(i===m-2?sub+1:sub);k++){const t=k/sub,s=j=>secs[Math.max(0,Math.min(m-1,j))];
    rings.push([0,1,2,3,4].map(q=>cr(s(i-1)[q],s(i)[q],s(i+1)[q],s(i+2)[q],t)));}
  const pos=[],idx=[],e=2/pow;
  rings.forEach(([z,cx,cy,a,b])=>{a=Math.max(a,0.01);b=Math.max(b,0.01);
    for(let i=0;i<n;i++){const th=i/n*2*Math.PI,c=Math.cos(th),s=Math.sin(th);
      pos.push(cx+a*Math.sign(c)*Math.pow(Math.abs(c),e),cy+b*Math.sign(s)*Math.pow(Math.abs(s),e),z);}});
  for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n,c=a+n,d=b+n;idx.push(a,c,b,b,c,d);}
  // end caps
  [0,rings.length-1].forEach(j=>{const r=rings[j],k=pos.length/3;pos.push(r[1],r[2],r[0]);
    for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n;if(j)idx.push(a,b,k);else idx.push(b,a,k);}});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
const ellipsoid=(cx,cy,cz,rx,ry,rz)=>{const s=[];for(let i=0;i<=8;i++){const u=-1+i/4,k=Math.sqrt(Math.max(0,1-u*u));s.push([cz+rz*u,cx,cy,rx*k,ry*k]);}return loft(s,2,3);};

// The patient, lying supine with the back on the table: torso and neck in one surface, head, arms at the sides, legs.
// Returns {group, back: the level of the back (the table top), x0: the midline}.
export function buildPatient(p,skin){
  const x0=p.midline_x,A=p.body_a,B=p.body_b,back=p.body_y-B,g=new THREE.Group();
  const add=geo=>g.add(new THREE.Mesh(geo,skin));
  // [z, half-width, half-depth]; the back stays on the table, so the centre rises and falls with the depth
  const torso=[[-28,5.2,5.4],[-24.5,5.6,5.8],[-21.5,0.74*A,0.62*B],[-18.5,A-1.6,B-1.2],[-12,A,B],[0,A,B],[10,A,B],[20,A-1.2,B-1],
    [30,A-1.8,B-2.2],[40,A-0.6,B-2.6],[49,A-2,B-3.2],[55,0.62*A,0.55*B]];
  add(loft(torso.map(([z,a,b])=>[z,x0,back+b+(z<-20?2.2*c01((-z-20)/5):0),a,b]),2.5));
  add(ellipsoid(x0,back+10.5,-37.5,7.6,9.4,10.4));
  [-1,1].forEach(s=>{
    // arm: shoulder to hand, lying beside the chest
    add(loft([[-19,A-2.5,5.2],[-10,A+1.6,5],[8,A+2.6,4.4],[24,A+3,3.7],[40,A+3.2,3.2],[47,A+3.2,2.6]].map(([z,x,r],i,a)=>[z,x0+s*x,back+Math.max(r,4.6)+(i?0:3),i===a.length-1?r*1.25:r,r]),2,4,18));
    // leg and foot
    add(loft([[48,9.2,8.6],[70,8.6,7.4],[92,8.2,5.6],[112,8,5],[132,7.8,3.9],[138,7.8,3.6]].map(([z,x,r])=>[z,x0+s*x,back+Math.max(r,5.2),r,r]),2,4,20));
    add(ellipsoid(x0+s*8,back+10,140.5,4.2,9.5,3.6));
  });
  return {group:g,back,x0};
}

// Spine, ribs with their costal cartilages, sternum and clavicles, from the chest landmarks.
// One change from the chest volume: there the ribs follow the body's outline all the way round, which leaves them
// well behind the spine at the back. Here their posterior ends are drawn in to the vertebrae, as real ribs are.
export function buildSkeleton(p,bone,cart){
  const g=new THREE.Group(),x0=p.midline_x,yc=p.body_y,sy=p.spine_y,pitch=p.vb_pitch,disc=p.disc_cm;
  const mesh=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);g.add(m);return m;};
  // vertebrae: bodies with discs between them and the posterior elements behind; drawn from the neck to the pelvis
  const h=pitch-disc,vb=new THREE.CylinderGeometry(p.vb_r,p.vb_r*0.94,h,22).rotateX(Math.PI/2),
    dk=new THREE.CylinderGeometry(p.vb_r*0.9,p.vb_r*0.9,disc,18).rotateX(Math.PI/2),
    arch=new THREE.BoxGeometry(3.2,1.5,h-0.3),spin=new THREE.CylinderGeometry(0.45,0.7,3.4,8).rotateX(-0.5),
    trans=new THREE.CylinderGeometry(0.5,0.6,5.6,8).rotateZ(Math.PI/2);
  for(let k=-4;k<=18;k++){const z0=p.t1_z+k*pitch,zc=z0+disc+h/2,sc=k<0?0.8:1;
    mesh(vb,bone,x0,sy,zc).scale.set(sc,sc,1);mesh(dk,cart,x0,sy,z0+disc/2).scale.set(sc,sc,1);
    mesh(arch,bone,x0,sy-2.9,zc+0.15);mesh(spin,bone,x0,sy-4.6,zc+0.9);mesh(trans,bone,x0,sy-2.6,zc);}
  // ribs: from beside the vertebra round the chest wall, descending toward the front
  const st=p.sternum;
  for(let k=0;k<p.ribs;k++){
    const zk=p.t1_z+pitch*(k+0.4),drop=interp(k,[0,5,11],[p.rib_drop[0],p.rib_drop[1],4]),reach=interp(k,[0,6,9,11],[2.55,2.75,2.3,1.6]);
    const [ak,bk]=bodyAB(p,zk),ar=ak-p.wall_cm+0.6,br=bk-p.wall_cm+0.6;
    [-1,1].forEach(side=>{const pts=[];
      for(let i=0;i<28;i++){const phi=0.18+(reach-0.18)*i/27,w=c01((phi-0.18)/0.95),s=w*w*(3-2*w);
        pts.push(new V3(x0+side*(ar*Math.sin(phi)*(0.55+0.45*s)+2*(1-s)),(sy-1.6)*(1-s)+(yc-br*Math.cos(phi))*s,zk+drop*Math.pow(phi/Math.PI,1.3)));}
      g.add(new THREE.Mesh(taperTube(pts,p.rib_r*0.9,p.rib_r*0.8,0).geo,bone));
      if(reach>2.4&&k<10){const e=pts[pts.length-1],to=new V3(x0+side*1.6,yc+bk-st.y_off,Math.min(zk+drop+1,st.z[1]));
        g.add(new THREE.Mesh(taperTube([e,e.clone().lerp(to,0.5).add(new V3(0,0.4,0.6)),to],p.rib_r*0.75,p.rib_r*0.7,0).geo,cart));}
    });
  }
  // sternum: manubrium and body
  const zs=st.z,len=zs[1]-zs[0],ys=yc+p.body_b-st.y_off;
  mesh(new THREE.BoxGeometry(st.w*1.5,st.t,len*0.24),bone,x0,ys-0.5,zs[0]+len*0.12);
  mesh(new THREE.BoxGeometry(st.w,st.t,len*0.76),bone,x0,ys,zs[0]+len*0.62);
  // clavicles
  [-1,1].forEach(s=>g.add(new THREE.Mesh(taperTube([[2,10,-15.5],[9,9,-17],[15,5,-18.5]].map(([x,y,z])=>new V3(x0+s*x,yc+y,z)),0.7,0.65,0).geo,bone)));
  return g;
}
