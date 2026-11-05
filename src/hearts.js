// The hearts on offer (data/web/hearts.json), and which one the address asks for: ?heart=<id>, ?model for the
// simplified model heart, or the manifest's default. Shared by index.html and drr.html.
// Each heart: id, name (for the dropdown), short (for the monitor readout), source (scan named in the notes),
// dominance, dir (its web export, from tools/export_scan.py), and optionally finding (disease, named in the notes).
import {fetchJSON} from './drr/data.js';
export const MODEL='model';
// used when the manifest can't be read (file://, or an older checkout)
const BUILT_IN={default:'814',hearts:[{id:'814',name:'CT 814 · right-dominant',short:'CT 814',source:'ImageCAS scan 814',dominance:'right',dir:'data/web/814/'}]};

// {list, heart: the chosen CT heart (null for the model), model: the model heart was asked for}
export async function loadHearts(){
  let m=BUILT_IN;
  try{m=await fetchJSON('data/web/hearts.json');if(!m.hearts||!m.hearts.length)throw new Error('no hearts listed');}
  catch(e){console.info('Using the built-in heart list:',e.message||e);m=BUILT_IN;}
  const q=new URLSearchParams(location.search),want=q.get('heart');
  if(q.has('model'))return {list:m.hearts,heart:null,model:true};
  let heart=m.hearts.find(h=>h.id===want);
  if(want&&!heart)console.info(`No heart "${want}"; showing the default`);
  heart??=m.hearts.find(h=>h.id===m.default)||m.hearts[0];
  return {list:m.hearts,heart,model:false};
}
// the address for another heart (or MODEL), keeping any other parameters
export function heartHref(id){
  const q=new URLSearchParams(location.search);q.delete('heart');q.delete('model');
  if(id===MODEL)q.set('model','');else q.set('heart',id);
  const s=q.toString().replace(/=(?=&|$)/g,'');return location.pathname+(s?'?'+s:'');
}
