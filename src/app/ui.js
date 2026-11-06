// Controls, presets, readouts and the overlay legend; setMode() applies the fluoro source (DRR or model).
import {state,chOn,app,reduce,$,esc} from './state.js';
import {PRESETS,angTxt} from '../presets.js';
import {SID} from '../geometry.js';
import {CHAMBERS} from './model.js';
import {mon,fr,fluoroBg,modelOvl,ctOvl} from './fluoro.js';
import {roomModelTree,roomCTTree,roomModelAnat,roomCTCh,roomCath,catName,setRoomView} from './room.js';
import {CH} from './ct.js';
import {MODEL,heartHref} from '../hearts.js';

const modelLegend=CHAMBERS.map(c=>`<span><i style="background:${c.col}"></i>${c.id}</span>`).join('')+'<span><i style="background:#c97fb6"></i>Aorta</span><span><i style="background:#9a8be0"></i>Pulmonary artery</span>';
const presetBtns=[];
PRESETS.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='pre';b.setAttribute('aria-pressed','false');
  b.title=`Best for: ${p.best}`;b.innerHTML=`<span class="pn">${p.name}</span><span class="pa">${angTxt(p.lao,p.cra)}</span><span class="pb">${p.best}</span>`;
  b.addEventListener('click',()=>goTo(p));document.getElementById(p.inj==='L'?'presetsL':'presetsR').appendChild(b);presetBtns.push({b,p});});

export function goTo(p){setInj(p.inj);if(reduce){state.lao=p.lao;state.cra=p.cra;syncUI();return;}
  app.tween={t0:performance.now(),dur:850,from:{lao:state.lao,cra:state.cra},to:{lao:p.lao,cra:p.cra}};}

/* ---------- UI wiring ---------- */
const sliders={lao:$('sLao'),cra:$('sCra'),tx:$('sTx'),tz:$('sTz'),ty:$('sTy')};
Object.entries(sliders).forEach(([k,el])=>el.addEventListener('input',()=>{state[k]=parseFloat(el.value);if(k==='lao'||k==='cra')app.tween=null;syncUI(true);}));
const fmtCm=(v,neg,pos)=>v===0?'centred':`${Math.abs(v).toFixed(1)} cm ${v<0?neg:pos}`;
export function syncUI(fromSlider){
  if(!fromSlider){for(const k in sliders)sliders[k].value=state[k];}
  $('oLao').textContent=Math.round(state.lao)===0?'AP':(state.lao>0?'LAO ':'RAO ')+Math.abs(Math.round(state.lao))+'°';
  $('oCra').textContent=Math.round(state.cra)===0?'0°':(state.cra>0?'Cranial ':'Caudal ')+Math.abs(Math.round(state.cra))+'°';
  $('oTx').textContent=fmtCm(state.tx,'right','left');$('oTz').textContent=fmtCm(state.tz,'headward','footward');$('oTy').textContent=state.ty===0?'isocentre':`${Math.abs(state.ty).toFixed(1)} cm ${state.ty<0?'lower':'higher'}`;
  document.querySelectorAll('#fovSeg button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.fov===state.fov)));
  document.querySelectorAll('#injSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.inj===state.inj)));
  const a=angTxt(state.lao,state.cra);
  $('roAng').innerHTML=`<b>${a.replace('  ','<br>')}</b>`;
  $('roFov').innerHTML=`FOV ${state.fov} cm<br>SID ${SID} cm`;
  const cn=app.mode==='drr'?(state.cath&&catName[state.inj]):app.mode==='model'?(state.inj==='L'?'JL4':'JR4'):'';
  $('roInj').textContent=(state.inj==='L'?'LCA injection':'RCA injection')+(cn?' · '+cn:'');
  $('roTbl').innerHTML=`TBL ${state.tx>=0?'+':''}${state.tx.toFixed(1)} / ${state.tz>=0?'+':''}${state.tz.toFixed(1)} / ${state.ty>=0?'+':''}${state.ty.toFixed(1)}<br>${app.mode==='drr'?'DRR · '+esc(app.heart.short):app.mode==='loading'?'Loading CT…':'Model heart'}`;
  $('nowAng').textContent=a;
  let hit=null;presetBtns.forEach(({b,p})=>{const on=p.inj===state.inj&&Math.abs(p.lao-state.lao)<=5&&Math.abs(p.cra-state.cra)<=5;b.setAttribute('aria-pressed',String(on));if(on)hit=p;});
  $('nowName').textContent=hit?hit.name:'Custom view';
  $('nowBest').innerHTML=hit?`<strong>Best for:</strong> ${hit.best}`:'Not a standard view. Pick a preset below, or keep adjusting and watch which segments separate or overlap.';
}
export function setInj(s){state.inj=s;syncUI();}
document.querySelectorAll('#injSeg button').forEach(b=>b.addEventListener('click',()=>setInj(b.dataset.inj)));
document.querySelectorAll('#fovSeg button').forEach(b=>b.addEventListener('click',()=>{state.fov=+b.dataset.fov;syncUI();}));
document.querySelectorAll('#roomViewSeg button').forEach(b=>b.addEventListener('click',()=>setRoomView(b.dataset.rv)));
function toggle(id,key,after){const b=$(id);b.addEventListener('click',()=>{state[key]=!state[key];b.setAttribute('aria-pressed',String(state[key]));after&&after();});}
toggle('tOvV','ovV',refreshOverlayUI);toggle('tOvC','ovC',refreshOverlayUI);toggle('tSegN','segN');
toggle('tLabels','labels');toggle('tBones','bones');toggle('tFine','fine',()=>{if(app.drr&&app.drr.hasFine)app.drr.setFine(state.fine);setMode();});toggle('tCath','cath',()=>syncUI());toggle('tMotion','motion');
// legend: segment colours with the coronary overlay; with the chamber overlay, one chip per chamber to show or hide it
export function refreshOverlayUI(){
  const drrOn=app.mode==='drr',lg=$('ovLegend');
  let h='';
  if(drrOn&&state.ovV)h+=app.ctLegend;
  if(state.ovC)h+=drrOn?CH.map(c=>`<button type="button" class="chip" data-ch="${c.s.id}" aria-pressed="${chOn[c.s.id]!==false}" title="${esc(c.s.name)}"><i style="background:${c.s.colour}"></i>${esc(c.s.id==='Myo'?'Myocardium':c.s.id)}</button>`).join(''):modelLegend;
  if(drrOn&&(state.ovV||state.ovC))h+='<span>Brighter = nearer the detector</span>';
  lg.innerHTML=h;lg.hidden=!h;
}
$('ovLegend').addEventListener('click',e=>{const b=e.target.closest('[data-ch]');if(!b)return;const id=b.dataset.ch;chOn[id]=chOn[id]===false;b.setAttribute('aria-pressed',String(chOn[id]));});
$('tblReset').addEventListener('click',()=>{state.tx=state.ty=state.tz=0;syncUI();});
/* ---------- Fluoro source: DRR when it starts, model otherwise ---------- */
export function setMode(){
  const on=app.mode==='drr';
  mon.classList.toggle('drr',on);mon.classList.toggle('loading',app.mode==='loading');
  $('monStatTxt').textContent=app.heart?`Loading ${app.heart.source}…`:'Loading the CT…';
  $('tBones').hidden=app.mode!=='model';          // only the model draws spine and ribs; the CT has its own
  // the model heart only when it's the image (chosen, or the CT failed); nothing on the table while loading
  const model=app.mode==='model';
  roomModelTree.visible=modelOvl.visible=model;roomCTTree.visible=ctOvl.visible=on;
  roomModelAnat.visible=model||(on&&!CH.length);roomCTCh.visible=on;   // model chambers stay only if the CT has none
  fr.setClearColor(fluoroBg,on?0:1);
  $('tOvV').hidden=$('tSegN').hidden=!on;           // the model heart has no separate coronary overlay or segments
  $('tFine').hidden=!(on&&app.drr&&app.drr.hasFine);
  $('tCath').hidden=!(on&&roomCath.length);
  $('tMotion').hidden=!on;
  refreshOverlayUI();
  // In the CT image: what is this patient's, then what is modelled or illustrative
  const fine=app.drr&&app.drr.hasFine&&state.fine,li=t=>`<li>${t}</li>`;
  $('srcNote').innerHTML=on
    ?`<h4>Taken from this patient's CT (${esc(app.heart.source)})</h4><ul>`+
        li(`The heart, the aortic root and everything else inside the ${app.scanCm} cm scan.`)+
        li(`The labelled coronary arteries, and the few small branches that could be traced in the CT.`)+
        (roomCath.length?li(`The path of the guide catheter (JL4 or JR4, femoral approach), which is shaped along this CT's aorta.`):'')+
      `</ul><h4>Modelled or illustrative</h4><ul>`+
        (app.drr&&app.drr.hasFine?li(`<strong>Branches finer than about 1 mm are illustrative.</strong> They are generated along the heart's surface to look realistic, but they are not this patient's anatomy.`+(fine?` You can switch them off with “Fine branches”.`:` They are switched off at the moment.`)):'')+
        (roomCath.length?li(`The catheter's arch above the scan is extrapolated.`):'')+
        (app.drr&&app.drr.hasChest?li(`Beyond the scan, the lungs, ribs, spine and diaphragm come from a synthetic chest fitted to this scan's landmarks.`):'')+
        li(`During a cine run the heart beats at 72/min, then holds still when the run ends. The motion (long-axis shortening, squeeze, twist, swing and buckling, each on its own time course) is modelled, not measured from this heart.`)+
      `</ul><p>If the CT can't load, a simplified, right-dominant model heart is shown instead.</p>`
    :app.mode==='loading'?'<p>Loading a real coronary CT for the fluoro image.</p>'
    :app.why==='file'?'<p><strong>You are seeing a simplified model heart.</strong> For the image computed from a real coronary CT, serve this folder (<code>python3 tools/serve.py</code>) and open it from localhost.</p>'
    :app.why==='chosen'?'<p><strong>You are seeing a simplified, right-dominant model heart</strong>, chosen in the heart list. Its contrast-filled vessels darken in proportion to their thickness.</p>'
    :`<p><strong>You are seeing a simplified model heart</strong>, because ${esc(app.why)}.</p>`;
  // the author and licence stay on the page; the rest is in About
  const ss=$('srcShort');ss.hidden=false;
  ss.innerHTML='Made by <a href="https://chiranpandey.com/">Chiran Pandey</a><br>Non-commercial use only&nbsp;·&nbsp;<button type="button" class="link" data-about="credits">More</button>';
  syncUI();
}

/* ---------- Heart list, About dialog, full screen, remembered groups ---------- */
// hearts: loadHearts()'s result. Choosing one reloads the page for it.
// A styled list box rather than a <select>, whose open list the browser draws in the system's own style. Keyboard:
// Enter, Space or the arrows open it; arrows, Home/End and typing move; Enter or Space chooses; Escape or Tab closes.
export function fillHearts({list,heart,model}){
  const btn=$('heartBtn'),lb=$('heartList'),cur=model?MODEL:heart.id;
  const items=[...list.map(h=>({id:h.id,name:h.name})),{id:MODEL,name:'Simplified model heart'}];
  lb.innerHTML=items.map((h,i)=>`<li role="option" id="heartOpt${i}" data-id="${esc(h.id)}" aria-selected="${h.id===cur}">${esc(h.name)}</li>`).join('');
  $('heartCur').textContent=(items.find(h=>h.id===cur)||items[0]).name;
  const opts=[...lb.children];let act=-1;
  const activate=i=>{act=Math.max(0,Math.min(opts.length-1,i));opts.forEach((o,j)=>o.classList.toggle('act',j===act));
    lb.setAttribute('aria-activedescendant',opts[act].id);opts[act].scrollIntoView({block:'nearest'});};
  const open=()=>{if(!lb.hidden)return;lb.hidden=false;btn.setAttribute('aria-expanded','true');activate(Math.max(0,opts.findIndex(o=>o.dataset.id===cur)));lb.focus();};
  const close=(refocus=true)=>{if(lb.hidden)return;lb.hidden=true;btn.setAttribute('aria-expanded','false');if(refocus)btn.focus();};
  const choose=i=>{const id=opts[i].dataset.id;close();if(id!==cur)location.href=heartHref(id);};
  btn.addEventListener('click',()=>lb.hidden?open():close());
  btn.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open();}});
  lb.addEventListener('keydown',e=>{
    const k=e.key;
    if(k==='ArrowDown')activate(act+1);else if(k==='ArrowUp')activate(act-1);
    else if(k==='Home')activate(0);else if(k==='End')activate(opts.length-1);
    else if(k==='Enter'||k===' ')choose(act);
    else if(k==='Escape')close();
    else if(k==='Tab'){close(false);return;}
    else if(k.length===1){const j=opts.findIndex((o,j)=>j>act&&o.textContent.toLowerCase().startsWith(k.toLowerCase()));
      const f=j>=0?j:opts.findIndex(o=>o.textContent.toLowerCase().startsWith(k.toLowerCase()));if(f>=0)activate(f);}
    else return;
    e.preventDefault();});
  lb.addEventListener('pointermove',e=>{const o=e.target.closest('[role=option]');if(o)activate(opts.indexOf(o));});
  lb.addEventListener('click',e=>{const o=e.target.closest('[role=option]');if(o)choose(opts.indexOf(o));});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#heartSel'))close(false);});
  lb.addEventListener('focusout',e=>{if(!$('heartSel').contains(e.relatedTarget))close(false);});
}
const about=$('about'),help=$('help');
document.addEventListener('click',e=>{const b=e.target.closest('[data-about]');if(!b)return;
  if(help.open)help.close();about.showModal();const at=b.dataset.about&&$('about-'+b.dataset.about);if(at)at.scrollIntoView({block:'start'});});
$('aboutBtn').addEventListener('click',()=>about.showModal());
$('helpBtn').addEventListener('click',()=>help.showModal());
// full screen for the whole app (F toggles it); hidden where the browser can't (e.g. iPhone Safari)
const fsBtn=$('fsBtn'),fsOn=()=>!!document.fullscreenElement;
const toggleFs=()=>{if(fsOn())document.exitFullscreen();else document.documentElement.requestFullscreen().catch(e=>console.info('No full screen:',e.message||e));};
if(document.fullscreenEnabled){fsBtn.hidden=false;fsBtn.addEventListener('click',toggleFs);}
document.addEventListener('fullscreenchange',()=>{fsBtn.setAttribute('aria-pressed',String(fsOn()));fsBtn.textContent=fsOn()?'Exit full screen':'Full screen';});
document.addEventListener('keydown',e=>{if((e.key==='f'||e.key==='F')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&document.fullscreenEnabled&&
  !e.target.closest('input[type=text],input[type=search],textarea,select,[contenteditable],#heartSel')&&!about.open&&!help.open){e.preventDefault();toggleFs();}});
// which control groups are open, per browser (storage may be unavailable, e.g. in a private window)
const GRP_KEY='cvs.groups';
let open={};try{open=JSON.parse(localStorage.getItem(GRP_KEY))||{};}catch(e){}
document.querySelectorAll('details.grp').forEach(d=>{const k=d.dataset.grp;if(k in open)d.open=!!open[k];
  d.addEventListener('toggle',()=>{open[k]=d.open;try{localStorage.setItem(GRP_KEY,JSON.stringify(open));}catch(e){}});});
