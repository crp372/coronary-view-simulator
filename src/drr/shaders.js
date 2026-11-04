import {MU_W} from './tune.js';
import {HEART_CORE} from './heart.js';

export const DRR_VS=`#version 300 es
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

// Shared ray setup: each pixel's ray runs from the tube S to its point on the detector.
export const DRR_RAY=`#version 300 es
precision highp float;precision highp sampler3D;
in vec2 uv;out vec4 o;
uniform vec3 uS,uC,uR,uT;uniform float uH;
uniform sampler3D uVol;uniform vec3 uOrg,uSp,uDim,uLo,uHi;uniform float uStep;
vec3 rayDir(){vec3 P=uC+uR*((uv.x*2.0-1.0)*uH)+uT*((uv.y*2.0-1.0)*uH);
  vec3 rd=normalize(P-uS);return mix(rd,vec3(1e-6),vec3(lessThan(abs(rd),vec3(1e-6))));}
vec2 hitBox(vec3 ro,vec3 rd,vec3 lo,vec3 hi){vec3 inv=1.0/rd,a=(lo-ro)*inv,b=(hi-ro)*inv,mn=min(a,b),mx=max(a,b);
  return vec2(max(max(mn.x,mn.y),mn.z),min(min(mx.x,mx.y),mx.z));}
// cardiac motion (HEART_CORE): hw() maps a point of the moving heart back to the reference volumes, by two
// fixed-point steps of q = p − hdisp(q)
${HEART_CORE}
vec3 hw(vec3 p){if(uHm.x<=0.0)return p;vec3 q=p-hdisp(p);q=p-hdisp(q);return p-hdisp(q);}
vec3 tc(vec3 p){return ((hw(p)-uOrg)/uSp+0.5)/uDim;}
// guide catheter: a polyline of straight tube pieces (anatomy frame, cm); uCatN = 0 when there is none
uniform vec4 uCat[64];uniform int uCatN;
// length of the ray inside the tube of radius r, summed over its pieces (each an infinite cylinder clipped to the piece)
float catChord(vec3 ro,vec3 rd,float r){float L=0.0;
  for(int i=0;i<63;i++){if(i>=uCatN-1)break;
    vec3 a=uCat[i].xyz,ab=uCat[i+1].xyz-a;float len=length(ab);if(len<1e-5)continue;vec3 u=ab/len;
    vec3 w=ro-a;float du=dot(rd,u),wu=dot(w,u);vec3 dp=rd-du*u,wp=w-wu*u;
    float A=dot(dp,dp),B=dot(wp,dp),D=B*B-A*(dot(wp,wp)-r*r);if(D<=0.0||A<1e-10)continue;
    float s=sqrt(D),t0=(-B-s)/A,t1=(-B+s)/A,s0=-1e9,s1=1e9;
    if(abs(du)>1e-6){s0=-wu/du;s1=(len-wu)/du;if(s0>s1){float q=s0;s0=s1;s1=q;}}else if(wu<0.0||wu>len)continue;
    L+=max(0.0,min(t1,s1)-max(t0,s0));}
  return L;}
`;

// Pass A: CT line integral (cm × 1/cm). Past the CT faces the edge voxels are extended outward
// (clamped sampling) and fade into flat soft tissue inside an elliptical body outline, so the
// volume's edges don't show as seams.
export const DRR_FS_CT=DRR_RAY+`
uniform float uMuBg,uFin,uFout,uCatRo,uCatRi,uCatMu,uCatWall,uChFade;uniform vec4 uBody;
// synthetic chest around the CT (chest.u8.gz), if loaded: sampled outside the CT, blended over the CT's outer uChFade cm
uniform int uChest;uniform sampler3D uChVol;uniform vec3 uChOrg,uChSp,uChDim,uChLo,uChHi;
float muCT(vec3 p){return ${MU_W.toFixed(3)}*max(0.0,2.55*texture(uVol,tc(p)).r-0.024);}   // HU = 2550 v - 1024
float muCh(vec3 p){return ${MU_W.toFixed(3)}*max(0.0,2.55*texture(uChVol,((p-uChOrg)/uChSp+0.5)/uChDim).r-0.024);}
float chestSeg(vec3 ro,vec3 rd,float a,float b){float L=0.0;if(b<=a)return 0.0;
  float n=ceil((b-a)/0.15),ds=(b-a)/n;
  for(int i=0;i<512;i++){if(float(i)>=n)break;L+=muCh(ro+rd*(a+(float(i)+0.5)*ds))*ds;}return L;}
float sdBox(vec3 p){vec3 q=abs(p-0.5*(uLo+uHi))-0.5*(uHi-uLo);return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0);}
vec2 hitBody(vec3 ro,vec3 rd){vec2 q=(ro.xy-uBody.xy)/uBody.zw,k=rd.xy/uBody.zw;
  float A=dot(k,k),B=dot(q,k),C=dot(q,q)-1.0,D=B*B-A*C;
  if(D<=0.0||A<1e-8)return vec2(0.0);float s=sqrt(D);return vec2(-B-s,-B+s)/A;}
float inBody(vec3 p){vec2 q=(p.xy-uBody.xy)/uBody.zw;return 1.0-smoothstep(0.94,1.06,dot(q,q));}
void main(){
  vec3 rd=rayDir();
  if(uChest==1){
    // fine steps through the CT (blending into the chest near its faces), coarse steps through the chest elsewhere
    vec2 tcx=hitBox(uS,rd,uChLo,uChHi),tb=hitBox(uS,rd,uLo,uHi);float L=0.0;
    if(tcx.x<tcx.y){
      if(tb.x<tb.y){
        float a=max(tb.x,tcx.x),b=min(tb.y,tcx.y);
        L+=chestSeg(uS,rd,tcx.x,a)+chestSeg(uS,rd,b,tcx.y);
        float n=ceil((b-a)/uStep),ds=(b-a)/n;
        for(int i=0;i<4096;i++){if(float(i)>=n)break;
          vec3 p=uS+rd*(a+(float(i)+0.5)*ds);
          float w=smoothstep(0.0,uChFade,-sdBox(p));
          L+=(w>0.999?muCT(p):w*muCT(p)+(1.0-w)*muCh(p))*ds;}
      }else L+=chestSeg(uS,rd,tcx.x,tcx.y);
    }
    if(uCatN>1){float co=catChord(uS,rd,uCatRo),ci=catChord(uS,rd,uCatRi);L+=uCatMu*co+uCatWall*(co-ci);}
    o=vec4(L,0.0,0.0,1.0);return;
  }
  vec2 tb=hitBox(uS,rd,uLo-uFout,uHi+uFout),te=hitBody(uS,rd);
  bool hit=tb.x<tb.y;
  float ov=hit?max(0.0,min(te.y,tb.y)-max(te.x,tb.x)):0.0;
  float L=uMuBg*(te.y-te.x-ov);
  if(hit){
    float n=ceil((tb.y-tb.x)/uStep),ds=(tb.y-tb.x)/n;
    for(int i=0;i<4096;i++){if(float(i)>=n)break;
      vec3 p=uS+rd*(tb.x+(float(i)+0.5)*ds);
      float w=1.0-smoothstep(-uFin,uFout,sdBox(p)),mu=0.0;
      if(w>0.0)mu=muCT(p);
      L+=(w*mu+(1.0-w)*uMuBg*inBody(p))*ds;}
  }
  // catheter: a radiopaque tube, denser in its braided wall (so its edges read slightly darker)
  if(uCatN>1){float co=catChord(uS,rd,uCatRo),ci=catChord(uS,rd,uCatRi);L+=uCatMu*co+uCatWall*(co-ci);}
  o=vec4(L,0.0,0.0,1.0);
}`;

// Pass B: iodine path (cm of full-occupancy lumen) for one side, filled up to uFill mm from the ostium.
export const DRR_FS_IOD=DRR_RAY+`
uniform float uSide,uFill,uCatRi,uWashF,uMixMM,uTime;
// contrast streaming: concentration by distance from the ostium d (mm). The leading edge is diluted over uMixMM and
// mottled just behind it (contrast and blood stream unevenly); in washout, unopacified blood clears it from the
// ostium outward (uWashF mm), again with an uneven edge. uTime (s) moves the mottling down the vessel.
float h1(float x){return fract(sin(x*127.1)*43758.5453);}
float n1(float x){float i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(h1(i),h1(i+1.0),f);}
float conc(float d){
  float c=1.0-smoothstep(uFill-uMixMM,uFill,d);
  float m=1.0-smoothstep(uFill-3.0*uMixMM,uFill-0.3*uMixMM,d);
  c*=1.0-0.5*m*(1.0-n1(d*0.11-uTime*2.2));
  if(uWashF>0.0){float w=smoothstep(uWashF-18.0,uWashF+4.0,d);
    float mw=1.0-abs(2.0*w-1.0);c*=w*(1.0-0.45*mw*(1.0-n1(d*0.09+uTime*1.7+5.0)));}
  return c;}
void main(){
  vec3 rd=rayDir();vec2 tb=hitBox(uS,rd,uLo,uHi);float L=0.0;
  // the catheter's lumen is full of contrast while the tree is
  if(uCatN>1&&uFill>0.0)L+=catChord(uS,rd,uCatRi);
  if(tb.x<tb.y){
    float n=ceil((tb.y-tb.x)/uStep),ds=(tb.y-tb.x)/n;
    for(int i=0;i<2048;i++){if(float(i)>=n)break;
      vec4 c=texture(uVol,tc(uS+rd*(tb.x+(float(i)+0.5)*ds)));
      float occ=mix(c.r,c.g,uSide);
      if(occ>0.0)L+=occ*conc(c.b*255.0)*ds;}
  }
  o=vec4(L,0.0,0.0,1.0);
}`;

// Pass C: combine, unsharp mask, quantum noise, log/gamma display with a black level, flat-panel shutter.
export const DRR_FS_OUT=`#version 300 es
precision highp float;
in vec2 uv;out vec4 o;
uniform sampler2D uA,uB;uniform float uK,uLo,uHi,uGam,uSharp,uNoise,uFrame,uFloor;uniform vec2 uTex,uShut;
// iodine gets a slight blur (focal spot, motion) so the voxelised lumen doesn't stair-step
float iod(vec2 q){vec2 e=uTex*1.3;return 0.36*texture(uB,q).r+0.16*(texture(uB,q+vec2(e.x,e.y)).r+texture(uB,q+vec2(-e.x,e.y)).r+texture(uB,q+vec2(e.x,-e.y)).r+texture(uB,q-e).r);}
float tot(vec2 q){return texture(uA,q).r+uK*iod(q);}
float hash(vec3 p){p=fract(p*vec3(.1031,.1030,.0973));p+=dot(p,p.yxz+33.33);return fract((p.x+p.y)*p.z);}
float vnoise(vec2 g,float f){vec2 i=floor(g),u=fract(g);u=u*u*(3.0-2.0*u);
  float a=hash(vec3(i,f)),b=hash(vec3(i+vec2(1,0),f)),c=hash(vec3(i+vec2(0,1),f)),d=hash(vec3(i+vec2(1,1),f));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)-0.5;}
void main(){
  float L=tot(uv),bl=0.0;
  for(int i=0;i<8;i++){float a=float(i)*0.7853982+0.3927;vec2 dir=vec2(cos(a),sin(a))*uTex;
    bl+=0.55*tot(uv+dir*1.6)+0.45*tot(uv+dir*3.6);}
  bl/=8.0;
  float Ls=L+uSharp*(L-bl);
  // Poisson noise in the log domain grows as fewer photons get through (σ ∝ 1/√I)
  vec2 g=uv/uTex*0.9;
  float n=(vnoise(g,uFrame)+vnoise(g+17.3,uFrame+0.5))*1.7;
  Ls+=uNoise*exp(0.5*clamp(L-uLo,-1.0,4.0))*n;
  float x=(Ls-uLo)/max(uHi-uLo,0.3);
  // log window, exponential toward black, with a soft shoulder above the bright end (C1 at x = 0)
  float sh=0.8-uFloor;
  float y=x>=0.0?uFloor+sh*exp(-uGam*x):0.8+0.17*(1.0-exp(sh*uGam/0.17*x));
  // flat-panel field: a square with rounded corners and dark shutters outside it, a mild fall-off toward the corners
  vec2 q=abs(uv-0.5)*2.0;vec2 dq=max(q-(uShut.x-uShut.y),0.0);float sd=length(dq)-uShut.y;
  y*=mix(1.0,0.82,smoothstep(0.6,1.3,length(q)));
  y=mix(y,0.03,smoothstep(-0.006,0.006,sd));
  o=vec4(vec3(clamp(y,0.0,1.0)),1.0);
}`;
