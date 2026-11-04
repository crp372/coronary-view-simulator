// The DRR engine, shared by index.html and drr.html: X-rays traced through a real CT at any C-arm angle.
// Pass A: CT line integral; pass B: iodine line integral in the injected tree (cine fill by distance
// from the ostium); pass C: combine with automatic brightness, unsharp mask, quantum noise and the flat-panel field.
import {MU_W,DRR_N,DRR_NA,DRR_STEP,TUNE} from './tune.js';
import {DRR_VS,DRR_FS_CT,DRR_FS_IOD,DRR_FS_OUT} from './shaders.js';
import {volGrid,shellMu,splitCoronary,addSynthetic} from './data.js';
import {HEART_U,heartForward,heartPhase} from './heart.js';
const V3=THREE.Vector3;

// Why this browser can't run the engine, or '' if it can
export function drrSupport(gl){
  if(!gl)return 'this browser has no WebGL2';
  if(!gl.getExtension('EXT_color_buffer_float'))return 'this browser can’t render to float textures (EXT_color_buffer_float)';
  if(typeof DecompressionStream==='undefined')return 'this browser has no DecompressionStream to unpack the CT';
  return '';
}

// Builds the GL resources for a scan from loadScan(); throws if a shader or float target fails.
// opts: fine (start with the illustrative fine branches), reduce (prefers reduced motion: brightness snaps at once).
export function createDRR(gl,cv,scan,opts={}){
  const {meta,ct,cor,syn,cath,chest}=scan,reduce=!!opts.reduce;
  function program(fs){
    const mk=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Shader: '+gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();gl.attachShader(p,mk(gl.VERTEX_SHADER,DRR_VS));gl.attachShader(p,mk(gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Link: '+gl.getProgramInfoLog(p));
    const loc={};
    return {p,u(name){if(!(name in loc))loc[name]=gl.getUniformLocation(p,name);return loc[name];}};
  }
  function target(n,internal,type,filter){
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,internal,n,n,0,gl.RED,type,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('This browser cannot render to float textures.');
    return {t,f,n};
  }
  function tex3D(data,dims,internal,format){
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage3D(gl.TEXTURE_3D,0,internal,dims[0],dims[1],dims[2],0,format,gl.UNSIGNED_BYTE,data);
    for(const [k,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_R,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_3D,k,v);
    return t;
  }
  const linear=!!gl.getExtension('OES_texture_float_linear');
  const fmt=linear?[gl.R32F,gl.FLOAT]:[gl.R16F,gl.HALF_FLOAT];
  const gCT=volGrid(meta.ct),gCor=volGrid(meta.coronary),gCh=chest?volGrid(chest.info):null;
  const corBase=splitCoronary(cor,gCor.dim,meta.coronary.right_segments);
  const corData=on=>on&&syn?addSynthetic(corBase,syn):corBase;
  // catheter polylines per side, packed for the uCat uniform array (vec4, w unused)
  const catPack={};
  if(cath)for(const s of ['L','R'])if(cath[s]){const p=cath[s].pts.slice(0,64),a=new Float32Array(64*4);p.forEach((q,i)=>a.set(q,4*i));catPack[s]={a,n:p.length};}
  const catMoved=new Float32Array(256),cp=new V3(),cq=new V3();
  const catPoints=c=>{if(HEART_U.uHm.value.x<=0)return c.a;   // moving heart: carry the tip along with the ostium
    for(let i=0;i<c.n;i++){cp.set(c.a[4*i],c.a[4*i+1],c.a[4*i+2]);heartForward(cp,cq);catMoved[4*i]=cq.x;catMoved[4*i+1]=cq.y;catMoved[4*i+2]=cq.z;}
    return catMoved;};
  const setCath=(pr,v,on)=>{const c=on&&catPack[v.inj];gl.uniform4fv(pr.u('uCat[0]'),c?catPoints(c):new Float32Array(256));gl.uniform1i(pr.u('uCatN'),c?c.n:0);
    if(cath){gl.uniform1f(pr.u('uCatRo'),cath.outer_radius_cm);gl.uniform1f(pr.u('uCatRi'),cath.inner_radius_cm);}};
  const R={pCT:program(DRR_FS_CT),pIod:program(DRR_FS_IOD),pOut:program(DRR_FS_OUT),
    ct:tex3D(ct,gCT.dim,gl.R8,gl.RED),
    chest:chest?tex3D(chest.data,chest.info.dims,gl.R8,gl.RED):null,
    cor:tex3D(corData(opts.fine),gCor.dim,gl.RGBA8,gl.RGBA),
    tA:target(DRR_N,fmt[0],fmt[1],gl.LINEAR),tB:target(DRR_N,fmt[0],fmt[1],gl.LINEAR),
    tS:target(DRR_NA,gl.R32F,gl.FLOAT,gl.NEAREST),small:new Float32Array(DRR_NA*DRR_NA*4),muBg:shellMu(ct,gCT)};
  gl.bindVertexArray(gl.createVertexArray());
  const stats={drrMs:0,iodMs:0},win={lo:2,hi:5,tlo:2,thi:5,ready:false},px=new Float32Array(4);
  function setRay(pr,v,grd){
    gl.uniform3fv(pr.u('uS'),v.S);gl.uniform3fv(pr.u('uC'),v.C);gl.uniform3fv(pr.u('uR'),v.r);gl.uniform3fv(pr.u('uT'),v.t);gl.uniform1f(pr.u('uH'),v.h);
    gl.uniform3fv(pr.u('uOrg'),grd.org);gl.uniform3fv(pr.u('uSp'),grd.sp);gl.uniform3fv(pr.u('uDim'),grd.dim);
    gl.uniform3fv(pr.u('uLo'),grd.lo);gl.uniform3fv(pr.u('uHi'),grd.hi);gl.uniform1f(pr.u('uStep'),DRR_STEP*Math.min(...grd.sp));
    gl.uniform1i(pr.u('uVol'),0);
  }
  const drawTo=t=>{gl.bindFramebuffer(gl.FRAMEBUFFER,t.f);gl.viewport(0,0,t.n,t.n);gl.drawArrays(gl.TRIANGLES,0,3);};
  function renderCT(v){
    const pr=R.pCT;gl.useProgram(pr.p);setRay(pr,v,gCT);
    gl.uniform1f(pr.u('uMuBg'),R.muBg);gl.uniform1f(pr.u('uFin'),TUNE.fadeIn);gl.uniform1f(pr.u('uFout'),TUNE.fadeOut);gl.uniform4fv(pr.u('uBody'),TUNE.body);
    setCath(pr,v,v.cath);setHeart(pr);gl.uniform1f(pr.u('uCatMu'),TUNE.cath.mu);gl.uniform1f(pr.u('uCatWall'),TUNE.cath.wall);
    gl.uniform1i(pr.u('uChest'),R.chest?1:0);
    if(R.chest){gl.uniform3fv(pr.u('uChOrg'),gCh.org);gl.uniform3fv(pr.u('uChSp'),gCh.sp);gl.uniform3fv(pr.u('uChDim'),gCh.dim);
      gl.uniform3fv(pr.u('uChLo'),gCh.lo);gl.uniform3fv(pr.u('uChHi'),gCh.hi);gl.uniform1f(pr.u('uChFade'),TUNE.chestFade);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,R.chest);gl.uniform1i(pr.u('uChVol'),1);}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,R.ct);
    const t0=performance.now();drawTo(R.tA);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,px);stats.drrMs=performance.now()-t0;
    // automatic brightness: window from percentiles of the central image, like a fluoro system's ABC
    drawTo(R.tS);gl.readPixels(0,0,DRR_NA,DRR_NA,gl.RGBA,gl.FLOAT,R.small);
    const a=[];for(let y=0;y<DRR_NA;y++)for(let x=0;x<DRR_NA;x++){const dx=(x+0.5)/DRR_NA-0.5,dy=(y+0.5)/DRR_NA-0.5;if(dx*dx+dy*dy<0.16)a.push(R.small[4*(y*DRR_NA+x)]);}
    a.sort((p,q)=>p-q);const q=f=>a[Math.min(a.length-1,Math.floor(f*a.length))];
    win.tlo=q(TUNE.win[0]);win.thi=Math.max(q(TUNE.win[1]),win.tlo+0.8);
    if(!win.ready||reduce){win.lo=win.tlo;win.hi=win.thi;win.ready=true;}
  }
  function setHeart(pr){const H=HEART_U;gl.uniform3fv(pr.u('uHc'),H.uHc.value.toArray());gl.uniform3fv(pr.u('uHax'),H.uHax.value.toArray());
    gl.uniform3fv(pr.u('uHk'),H.uHk.value.toArray());gl.uniform4fv(pr.u('uHm'),H.uHm.value.toArray());
    gl.uniform4fv(pr.u('uHt'),H.uHt.value.toArray());gl.uniform3fv(pr.u('uHtr'),H.uHtr.value.toArray());gl.uniform2fv(pr.u('uHb'),H.uHb.value.toArray());}
  function renderIodine(v,cs){
    const pr=R.pIod;gl.useProgram(pr.p);setRay(pr,v,gCor);
    gl.uniform1f(pr.u('uSide'),v.inj==='R'?1:0);gl.uniform1f(pr.u('uFill'),cs.fill);gl.uniform1f(pr.u('uWashF'),cs.washF);
    gl.uniform1f(pr.u('uMixMM'),TUNE.stream.mix);gl.uniform1f(pr.u('uTime'),cs.t);setCath(pr,v,v.cath);setHeart(pr);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,R.cor);
    const t0=performance.now();drawTo(R.tB);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,px);stats.iodMs=performance.now()-t0;
  }
  function renderOut(frame,wash){
    const pr=R.pOut;gl.useProgram(pr.p);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,cv.width,cv.height);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,R.tA.t);gl.uniform1i(pr.u('uA'),0);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,R.tB.t);gl.uniform1i(pr.u('uB'),1);
    gl.uniform1f(pr.u('uK'),MU_W*TUNE.iod/1000*wash);gl.uniform1f(pr.u('uFloor'),TUNE.floor);gl.uniform2fv(pr.u('uShut'),TUNE.shutter);
    gl.uniform1f(pr.u('uLo'),win.lo);gl.uniform1f(pr.u('uHi'),win.hi);
    gl.uniform1f(pr.u('uGam'),TUNE.gamma);gl.uniform1f(pr.u('uSharp'),TUNE.sharp);gl.uniform1f(pr.u('uNoise'),TUNE.noise);gl.uniform1f(pr.u('uFrame'),frame);
    gl.uniform2f(pr.u('uTex'),1/DRR_N,1/DRR_N);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  let lastG='',lastI='';
  return {stats,win,
    // view (drrView): tube S, detector centre C, screen right r and up t, half-FOV h (anatomy frame), injection side,
    // catheter on, cache key
    // cs: cine state {fill, washF (mm), wash (0..1), t (s), hm (contraction 0..1)}
    render(v,cs,frame){
      heartPhase(cs.ht,cs.hm>0);
      const gk=`${v.key}|${cs.hm>0?cs.ht.toFixed(3):'still'}`,moving=cs.fill<999||cs.washF>0;
      const ik=`${gk}|${cs.fill.toFixed(1)}|${cs.washF.toFixed(1)}|${moving?cs.t.toFixed(2):''}`;
      if(gk!==lastG){renderCT(v);lastG=gk;}
      if(ik!==lastI){renderIodine(v,cs);lastI=ik;}
      win.lo+=(win.tlo-win.lo)*0.3;win.hi+=(win.thi-win.hi)*0.3;   // ABC settles over a few frames
      renderOut(frame,cs.wash);},
    invalidate(){lastG=lastI='';},
    hasFine:!!syn,hasChest:!!chest,
    // swap the coronary texture with or without the illustrative fine branches
    setFine(on){gl.bindTexture(gl.TEXTURE_3D,R.cor);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      gl.texSubImage3D(gl.TEXTURE_3D,0,0,0,0,gCor.dim[0],gCor.dim[1],gCor.dim[2],gl.RGBA,gl.UNSIGNED_BYTE,corData(on));lastI='';},
    finish(){gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));}};
}
