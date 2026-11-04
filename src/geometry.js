// Projection geometry shared by index.html and drr.html.
// Patient coordinates: x = patient's left, y = anterior (up, supine), z = feet. Isocentre at origin, cm.
const V3=THREE.Vector3;
export const deg=Math.PI/180;
export const SOD=70, SID=110; // source–isocentre and source–image distances, cm

// d = detector direction, t = image up (head direction orthogonalised to d)
export function dirs(lao,cra){const a=lao*deg,b=cra*deg;
  const d=new V3(Math.sin(a)*Math.cos(b),Math.cos(a)*Math.cos(b),-Math.sin(b)).normalize();
  const hd=new V3(0,0,-1),t=hd.clone().addScaledVector(d,-hd.dot(d)).normalize();return {d,t};}
// tube and detector in the anatomy's frame: the table offset moves the anatomy, so it's subtracted
export function drrView(state){const {d,t}=dirs(state.lao,state.cra),r=new V3().crossVectors(t,d),off=new V3(state.tx,state.ty,state.tz);
  return {S:d.clone().multiplyScalar(-SOD).sub(off).toArray(),C:d.clone().multiplyScalar(SID-SOD).sub(off).toArray(),r:r.toArray(),t:t.toArray(),h:state.fov/2,inj:state.inj,cath:state.cath,
    key:`${state.lao}|${state.cra}|${state.fov}|${state.tx}|${state.ty}|${state.tz}|${state.inj}|${state.cath}`};}   // inj, cath: the CT pass draws the catheter
