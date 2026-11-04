import {MU_W} from './tune.js';

export async function fetchBytes(url){
  const r=await fetch(url);if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
  let b=new Uint8Array(await r.arrayBuffer());
  // some servers already decode .gz (Content-Encoding); only gunzip if the magic bytes are still there
  if(b[0]===0x1f&&b[1]===0x8b)b=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return b;
}
export async function fetchJSON(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json();}
export const prod=a=>a[0]*a[1]*a[2];
// bounds (voxel edges), centre-of-voxel-0 origin, spacing and dims for one grid
export function volGrid(m){const o=m.origin_cm,s=m.spacing_cm,n=m.dims;
  return {org:o,sp:s,dim:n,lo:o.map((v,i)=>v-s[i]/2),hi:o.map((v,i)=>v+s[i]*(n[i]-0.5))};}
// Mean μ of body voxels in the outer 1.5 cm of the CT: the flat tissue the volume fades into.
export function shellMu(ct,g){const [nx,ny,nz]=g.dim,k=g.sp.map(s=>Math.round(1.5/s));let sum=0,cnt=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){const edgeYZ=z<k[2]||z>=nz-k[2]||y<k[1]||y>=ny-k[1];const row=(z*ny+y)*nx;
    for(let x=0;x<nx;x++){if(!edgeYZ&&x>=k[0]&&x<nx-k[0])continue;const v=ct[row+x];if(v*10-1024>-950){sum+=Math.max(0,2.55*v/255-0.024);cnt++;}}}
  return MU_W*sum/Math.max(1,cnt);}
// Coronary RGB → RGBA: R = left-tree occupancy, G = right-tree occupancy, B = ostium distance (mm).
// Labels can't be interpolated, so the side split happens here. B is dilated by one voxel so
// trilinear sampling at the lumen edge doesn't drag the distance toward 0.
export function splitCoronary(c,dims,right){const [nx,ny,nz]=dims,n=prod(dims),out=new Uint8Array(n*4);
  for(let i=0;i<n;i++){const occ=c[3*i],seg=c[3*i+1];
    if(occ&&seg)out[4*i+(right.includes(seg&15)?1:0)]=occ;out[4*i+2]=c[3*i+2];}   // seg & 15: grown branches carry parent + 16
  const sx=1,sy=nx,sz=nx*ny;
  for(let z=1;z<nz-1;z++)for(let y=1;y<ny-1;y++)for(let x=1;x<nx-1;x++){const i=(z*ny+y)*nx+x;if(c[3*i])continue;
    let m=0;for(const o of [sx,-sx,sy,-sy,sz,-sz]){const j=i+o;if(c[3*j]&&c[3*j+2]>m)m=c[3*j+2];}if(m)out[4*i+2]=m;}
  return out;}
// Illustrative fine branches (synthetic.u8.gz): 1–127 left occupancy, 129–255 right, added onto a copy
// of the split coronary volume
export function addSynthetic(base,syn){const out=base.slice();
  for(let i=0;i<syn.length;i++){const v=syn[i];if(!v)continue;const r=v>128,k=4*i+(r?1:0);
    out[k]=Math.min(255,out[k]+Math.round((r?v-128:v)*255/127));}
  return out;}

// Loads one scan's web export (data/web/<id>/). The CT, coronary volume and vessels.json are required, so a
// failure there throws. The fine branches, catheter, chest and chambers are optional: each is null when missing.
// chambers: [{s: the chambers.json entry, geometry: its mesh}]
export async function loadScan(dir){
  const meta=await fetchJSON(dir+'meta.json');
  const [vessels,ct,cor]=await Promise.all([fetchJSON(dir+meta.vessels),fetchBytes(dir+meta.ct.file),fetchBytes(dir+meta.coronary.file)]);
  if(ct.length!==prod(meta.ct.dims)||cor.length!==3*prod(meta.coronary.dims))throw new Error('CT data has an unexpected size');
  // illustrative fine branches are optional: without the file, only the CT's own vessels are drawn
  let syn=null;const sm=meta.coronary.synthetic;
  if(sm)try{syn=await fetchBytes(dir+sm.file);if(syn.length!==prod(meta.coronary.dims))syn=null;}catch(e){console.info('No synthetic fine branches:',e.message||e);}
  // guide catheter, optional like the fine branches
  let cath=null;try{cath=await fetchJSON(dir+'catheter.json');}catch(e){console.info('No guide catheter:',e.message||e);}
  // synthetic chest beyond the CT, optional: without it the CT fades into flat soft tissue
  let chest=null;try{const info=await fetchJSON(dir+'chest.json'),data=await fetchBytes(dir+info.file);
    if(data.length===prod(info.dims))chest={info,data};}catch(e){console.info('No synthetic chest:',e.message||e);}
  // chambers and great vessels from the same CT (TotalSegmentator), optional
  let chambers=null,chAttr='';
  try{
    const ci=await fetchJSON(dir+'chambers.json'),bin=await fetchBytes(dir+ci.file),buf=bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength);
    chambers=ci.structures.map(s=>{
      const q=new Int16Array(buf,s.vertices.offset,s.vertices.count*3),g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(Float32Array.from(q,x=>x/100),3));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf,s.indices.offset,s.indices.count),1));g.computeVertexNormals();
      return {s,geometry:g};});
    chAttr=ci.attribution||'';
  }catch(e){console.info('CT chambers unavailable; showing the coronary tree only:',e.message||e);}
  return {meta,vessels,ct,cor,syn,cath,chest,chambers,chAttr};
}
