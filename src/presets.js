// Standard views, shared by index.html and drr.html
export const PRESETS=[
 {name:'RAO caudal',lao:-30,cra:-25,inj:'L',best:'LM, proximal LAD and LCx, OM branches'},
 {name:'AP caudal',lao:0,cra:-30,inj:'L',best:'LM body and bifurcation, proximal LCx'},
 {name:'LAO caudal (spider)',lao:45,cra:-30,inj:'L',best:'LM bifurcation and the LAD and LCx ostia'},
 {name:'RAO cranial',lao:-30,cra:30,inj:'L',best:'Mid and distal LAD, diagonal origins'},
 {name:'AP cranial',lao:0,cra:35,inj:'L',best:'Mid LAD, diagonals pulled away from the LAD'},
 {name:'LAO cranial',lao:40,cra:30,inj:'L',best:'LAD with diagonals and septals separated'},
 {name:'Left lateral',lao:90,cra:0,inj:'L',best:'Mid LAD and LCx, LIMA graft course'},
 {name:'LAO',lao:40,cra:0,inj:'R',best:'RCA as a "C": ostium, proximal and mid RCA'},
 {name:'RAO',lao:-30,cra:0,inj:'R',best:'RCA as an "L": mid RCA and PDA length'},
 {name:'LAO cranial',lao:30,cra:25,inj:'R',best:'Crux: distal RCA splitting into PDA and PLV'},
];
export const angTxt=(lao,cra)=>{const a=Math.round(lao),c=Math.round(cra);
  return (a===0?'AP 0°':(a>0?'LAO ':'RAO ')+Math.abs(a)+'°')+'  '+(c===0?'0°':(c>0?'CRA ':'CAU ')+Math.abs(c)+'°');};
