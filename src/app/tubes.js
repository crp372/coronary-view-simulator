// Tube geometry with the per-vertex attributes the fluoro shaders use: rad (radius) and sdist (distance from
// the ostium). Non-tube geometry gets them from addConst().
const V3=THREE.Vector3;

export function addConst(g,rad){const n=g.attributes.position.count;g.setAttribute('rad',new THREE.Float32BufferAttribute(new Float32Array(n).fill(rad),1));g.setAttribute('sdist',new THREE.Float32BufferAttribute(new Float32Array(n),1));return g;}
export function taperTube(pts,r0,r1,s0){
  const curve=new THREE.CatmullRomCurve3(pts,false,'centripetal');
  const len=curve.getLength(),N=Math.max(16,Math.ceil(len*5)),RS=10;
  const fr=curve.computeFrenetFrames(N,false);
  const pos=[],nor=[],rad=[],sd=[],idx=[],p=new V3(),n=new V3();
  for(let i=0;i<=N;i++){const t=i/N;curve.getPointAt(t,p);const r=r0+(r1-r0)*t;
    for(let j=0;j<=RS;j++){const a=j/RS*Math.PI*2;n.copy(fr.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(fr.binormals[i],Math.sin(a));
      pos.push(p.x+n.x*r,p.y+n.y*r,p.z+n.z*r);nor.push(n.x,n.y,n.z);rad.push(r);sd.push(s0+t*len);}}
  for(let i=0;i<N;i++)for(let j=0;j<RS;j++){const a=i*(RS+1)+j,b=a+RS+1;idx.push(a,b,a+1,b,b+1,a+1);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('rad',new THREE.Float32BufferAttribute(rad,1));g.setAttribute('sdist',new THREE.Float32BufferAttribute(sd,1));g.setIndex(idx);
  return {geo:g,curve,len,s0};
}
export const sphereGeo=addConst(new THREE.SphereGeometry(1,36,24),1);
