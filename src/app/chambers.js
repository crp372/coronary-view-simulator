// CT chamber overlay in the image, drawn as silhouettes: each chamber's projected shape gets a translucent fill
// and one outer border. Per pixel, the chamber nearest the detector is the one filled; a border that lies behind
// another chamber is dashed and fainter. The focused chamber (hovered in either view, or its legend chip) stands out.
//
// Two passes each frame while the overlay is on:
//   1. masks: every chamber mesh is drawn into its own channel of two RGBA targets (up to 8 chambers), with MAX
//      blending of its nearness to the detector, so each pixel holds how near that chamber's front surface is
//      (0 = not covered);
//   2. composite: a full-screen quad in the overlay scene reads the masks, finds the borders, and draws fills and
//      borders under the coronary ribbons.
import {app,chOn,state} from './state.js';
import {fr,fcam,oScene,ctOvl,ovDir} from './fluoro.js';
import {HEART_U,HEART_GLSL} from '../drr/heart.js';

const MAX=8;
// left heart warm (red, orange, rose), right heart cool (blue, sky, violet)
export const CH_COL={LV:'#e8604f',LA:'#f0a04a',Ao:'#e27ca6',RV:'#4f86e0',RA:'#7cc8ea',PA:'#8f82f0',Myo:'#c9c2a0'};
export const CH_SIDE={LV:'L',LA:'L',Ao:'L',RV:'R',RA:'R',PA:'R'};

// pass 1: one-hot channel, value = nearness to the detector (0.1–1), MAX-blended
export function chamberMaskMat(k){
  const ch=new THREE.Vector4(0,0,0,0);ch.setComponent(k%4,1);
  return new THREE.ShaderMaterial({depthTest:false,depthWrite:false,side:THREE.DoubleSide,transparent:true,
    uniforms:{uD:ovDir,uCh:{value:ch},uHi:{value:0},...HEART_U},
    vertexShader:`uniform vec3 uD;varying float vNear;${HEART_GLSL}
      void main(){vec4 w=modelMatrix*vec4(hfw(position),1.);vNear=.1+.9*clamp(.5+dot(w.xyz,uD)/24.,0.,1.);gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader:`uniform vec4 uCh;varying float vNear;void main(){gl_FragColor=uCh*vNear;}`,
    blending:THREE.CustomBlending,blendEquation:THREE.MaxEquation,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,
    blendEquationAlpha:THREE.MaxEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor});
}
// the overlay pass draws nothing for the chamber meshes themselves; the composite quad does
export const chamberNil=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,depthTest:false});

const rt=[0,1].map(()=>new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter}));
const cols=[...Array(MAX)].map(()=>new THREE.Color());
const U={tA:{value:rt[0].texture},tB:{value:rt[1].texture},uPx:{value:new THREE.Vector2(1,1)},uDpr:{value:1},
  uCol:{value:cols},uOn:{value:new Array(MAX).fill(0)},uHi:{value:-1},uN:{value:0}};
const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({uniforms:U,transparent:true,depthTest:false,depthWrite:false,
  vertexShader:`void main(){gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`uniform sampler2D tA,tB;uniform vec2 uPx;uniform float uDpr;uniform vec3 uCol[${MAX}];uniform float uOn[${MAX}];uniform int uHi,uN;
    float val(int i,vec2 uv){vec4 a=i<4?texture2D(tA,uv):texture2D(tB,uv);int k=i-(i/4)*4;return k==0?a.r:k==1?a.g:k==2?a.b:a.a;}
    void main(){
      vec2 uv=gl_FragCoord.xy*uPx;
      float v[${MAX}];int front=-1;float best=0.;
      for(int i=0;i<${MAX};i++){v[i]=i<uN?val(i,uv)*uOn[i]:0.;if(v[i]>best){best=v[i];front=i;}}
      vec3 P=vec3(0.);float A=0.;
      // fill: the frontmost chamber at this pixel
      // focus: the focused chamber fills its whole shape, even where another chamber is in front of it
      int f=front;if(uHi>=0&&uHi<${MAX}){for(int i=0;i<${MAX};i++)if(i==uHi&&v[i]>0.)f=i;}
      if(f>=0){float fa=uHi<0?.13:f==uHi?.28:.05;P=uCol[f]*fa;A=fa;}
      // borders: occupancy around a small circle; the gradient gives the border's direction, for dashes
      float r=1.25*uDpr;
      for(int i=0;i<${MAX};i++){
        if(i>=uN||uOn[i]<.5)continue;
        float occ=0.,vmax=v[i];vec2 g=vec2(0.);
        for(int s=0;s<12;s++){float an=float(s)*.5236;vec2 o=vec2(cos(an),sin(an));float x=val(i,uv+o*r*uPx);
          occ+=step(.001,x);vmax=max(vmax,x);g+=o*step(.001,x);}
        occ/=12.;float e=clamp(min(occ,1.-occ)*5.,0.,1.);if(e<=0.)continue;
        // behind: another chamber here is nearer the detector than this one's surface at its edge
        float other=0.;for(int j=0;j<${MAX};j++)if(j!=i)other=max(other,v[j]);
        bool behind=other>vmax+.012;
        vec2 t=normalize(vec2(-g.y,g.x)+1e-5);float dash=step(.45,fract(dot(gl_FragCoord.xy,t)/(8.*uDpr)));
        float ea=behind?.5*dash:.92;
        if(uHi>=0)ea*=i==uHi?1.15:.3;
        ea=min(e*ea,1.);vec3 c=mix(uCol[i],vec3(1.),i==uHi?.35:.18);
        P=c*ea+P*(1.-ea);A=ea+A*(1.-ea);
      }
      if(A<=.001)discard;
      gl_FragColor=vec4(P/A,A);
    }`}));
quad.frustumCulled=false;quad.renderOrder=-2;quad.visible=false;ctOvl.add(quad);

const sz=new THREE.Vector2();
// Label anchors: chAnchor[id] = {x, y} (fractions of the image, y down) or null when the chamber isn't on screen.
// Each label goes at the point deepest inside the part of its chamber that's in front (or, if it's behind others
// everywhere, its whole shadow), found on a small copy of the masks. Recomputed when the view changes, and a few
// times a second while the heart moves.
export const chAnchor={};
const LW=128,rtS=[0,1].map(()=>new THREE.WebGLRenderTarget(LW,LW,{depthBuffer:false,stencilBuffer:false}));
const buf=[0,1].map(()=>new Uint8Array(LW*LW*4));
let lastKey='',lastT=0;
function anchors(CH,w,h){
  const n=w*h,val=new Float32Array(n*MAX),mx=new Float32Array(n),d=new Float32Array(n);
  for(let i=0;i<Math.min(CH.length,MAX);i++){const b=buf[i>>2],k=i&3;
    for(let q=0;q<n;q++){const x=b[q*4+k]/255;val[q*MAX+i]=x;if(x>mx[q])mx[q]=x;}}
  const M=3;   // keep labels off the image's edge
  CH.forEach((c,i)=>{
    if(i>=MAX||c.part||chOn[c.sw]===false){chAnchor[c.s.id]=null;return;}
    const inR=front=>{let cnt=0;for(let q=0;q<n;q++){const x=val[q*MAX+i],y=q/w|0,xx=q%w;
      const ok=x>0&&(!front||x>=mx[q]-.004)&&xx>=M&&xx<w-M&&y>=M&&y<h-M;d[q]=ok?1e9:0;if(ok)cnt++;}return cnt;};
    if(inR(true)<30&&inR(false)<5){chAnchor[c.s.id]=null;return;}
    // chamfer distance to the region's edge, then its deepest point
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const q=y*w+x;if(!d[q])continue;let v=d[q];
      if(x>0)v=Math.min(v,d[q-1]+1);if(y>0){v=Math.min(v,d[q-w]+1);if(x>0)v=Math.min(v,d[q-w-1]+1.414);if(x<w-1)v=Math.min(v,d[q-w+1]+1.414);}d[q]=v;}
    let best=-1,bq=0;
    for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const q=y*w+x;if(!d[q])continue;let v=d[q];
      if(x<w-1)v=Math.min(v,d[q+1]+1);if(y<h-1){v=Math.min(v,d[q+w]+1);if(x<w-1)v=Math.min(v,d[q+w+1]+1.414);if(x>0)v=Math.min(v,d[q+w-1]+1.414);}d[q]=v;
      if(v>best){best=v;bq=q;}}
    chAnchor[c.s.id]={x:((bq%w)+.5)/w,y:1-((bq/w|0)+.5)/h};   // render targets are bottom-up
  });
}
function drawMasks(CH,targets){
  for(let p=0;p<2;p++){
    CH.forEach(c=>{const mine=c.chan<MAX&&(c.chan>>2)===p&&U.uOn.value[c.chan]>0;c.ov.visible=mine;c.ov.material=c.mask;});
    fr.setRenderTarget(targets[p]);fr.clear();fr.render(oScene,fcam);
  }
}
// focus: a chamber index from hover in either view or a legend chip, or null
export function renderChambers(CH,on,focus){
  quad.visible=on&&CH.length>0;if(!quad.visible)return;
  fr.getDrawingBufferSize(sz);
  rt.forEach(t=>{if(t.width!==sz.x||t.height!==sz.y)t.setSize(sz.x,sz.y);});
  U.uPx.value.set(1/sz.x,1/sz.y);U.uDpr.value=fr.getPixelRatio();U.uN.value=Math.min(CH.length,MAX);
  CH.forEach((c,i)=>{if(i<MAX){cols[i].set(c.s.colour);U.uOn.value[i]=!c.part&&chOn[c.sw]!==false?1:0;}});   // a part (the LV wall) has no channel of its own
  U.uHi.value=focus!=null&&focus<MAX&&U.uOn.value[focus]>0?focus:-1;
  // mask passes: only the chamber meshes, each with its channel material
  const vis=ctOvl.children.map(o=>o.visible);
  ctOvl.children.forEach(o=>o.visible=false);
  const prevClear=fr.getClearColor(new THREE.Color()),prevA=fr.getClearAlpha();
  fr.setClearColor(0x000000,0);
  drawMasks(CH,rt);
  const key=[state.lao,state.cra,state.tx,state.ty,state.tz,state.fov,sz.x,sz.y,CH.map(c=>chOn[c.sw]!==false?1:0).join('')].join(),now=performance.now();
  if(key!==lastKey||(app.cine&&state.motion&&now-lastT>200)){
    const lh=Math.max(8,Math.round(LW*sz.y/sz.x));rtS.forEach(t=>{if(t.height!==lh)t.setSize(LW,lh);});
    drawMasks(CH,rtS);rtS.forEach((t,p)=>fr.readRenderTargetPixels(t,0,0,LW,lh,buf[p]));
    anchors(CH,LW,lh);lastKey=key;lastT=now;
  }
  fr.setRenderTarget(null);fr.setClearColor(prevClear,prevA);
  CH.forEach(c=>c.ov.material=chamberNil);
  ctOvl.children.forEach((o,k)=>o.visible=vis[k]);
  CH.forEach(c=>c.ov.visible=false);   // nothing to draw in the overlay pass; picking doesn't need them visible
}
