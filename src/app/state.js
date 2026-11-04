// index.html's shared state, imported by every app module.
export const reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
const css=getComputedStyle(document.documentElement);
export const tok=n=>css.getPropertyValue(n).trim()||'#888';
export const $=id=>document.getElementById(id);
export const esc=t=>String(t).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// ovV: CT coronary overlay; ovC: chamber overlay (the model's chambers in model mode); segN: SCCT segment numbers
// fine: illustrative fine branches (below CT resolution) in the CT image; cath: guide catheter in the CT image;
// motion: the heart beats during a cine run
export const state={lao:-30,cra:-25,tx:0,ty:0,tz:0,fov:20,inj:'L',ovV:false,ovC:false,segN:false,labels:true,bones:true,fine:true,cath:true,motion:true};
export const chOn={LV:true,RV:true,LA:true,RA:true,Ao:true,PA:true,Myo:false};   // per-chamber switches (legend chips)

// What the modules change for each other:
//   mode: 'loading' (model shown meanwhile), 'drr' or 'model'; why: the reason for 'model' ('file', 'chosen' or a sentence)
//   drr: the DRR engine once running; attr: its data attribution; ctLegend: the CT segment colours (HTML)
//   hover / hoverCh: index into VES / CH of the highlighted vessel / chamber
//   tween: a preset move in progress; cine: the cine run in progress; roomView: 'room' or 'heart'
//   heart: the chosen heart (hearts.json entry); scanCm: its CT's size, e.g. '23 × 23 × 14'
export const app={mode:'loading',why:'',drr:null,attr:'',ctLegend:'',hover:null,hoverCh:null,tween:null,cine:null,roomView:'room',heart:null,scanCm:''};
