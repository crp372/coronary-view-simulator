// DRR image constants, shared by index.html and drr.html (window.sim.tune / window.drr.tune for experiments).
export const MU_W=0.2;                  // water attenuation, 1/cm
export const DRR_N=512, DRR_NA=64;      // DRR resolution; low-res copy for automatic brightness
export const DRR_STEP=0.5;              // ray-march step in voxels
// Body outline beyond the CT (elliptical cylinder along z): centre x, y and semi-axes, cm.
// Estimated from scan 814's anterior skin and the midline of its sternum and spine.
//   fadeIn/fadeOut: cm inside/outside the CT faces over which it fades into flat soft tissue
//   win: display window percentiles of the central image; gamma: LUT steepness toward black
//   sharp: unsharp-mask gain; noise: quantum noise in attenuation units at the bright end
//   iod: iodine, HU equivalent at full lumen (undiluted contrast is ~28 000 at fluoro energies; mixing with
//     blood during the injection roughly halves it); floor: display black level, so dense vessels read
//     dark grey rather than black, as on real runs; shutter: flat-panel field, half-width of the visible
//     square (1 = edge) and its corner radius
// Tuned by eye against CC-BY cine angiograms on Wikimedia Commons (RAO caudal LAD, LAO RCA). iod was then raised
// from 15 000 to 21 000 on the owner's review, so mid-sized and small vessels read darker.
//   cath: guide catheter attenuation, 1/cm: mu over the whole tube, wall extra in the braided wall
//   chestFade: cm inside the CT's faces over which it blends into the synthetic chest (when chest.u8.gz is loaded)
//   stream: cine contrast, mix = length of the diluted leading edge (mm), speed = front speed at full flow (mm/s)
export const TUNE={body:[-3,-1.7,17,12],fadeIn:1,fadeOut:3,win:[0.05,0.95],gamma:1.2,sharp:0.95,noise:0.028,
  iod:21000,floor:0.08,shutter:[0.97,0.12],cath:{mu:0.9,wall:4},chestFade:1.5,stream:{mix:10,speed:520}};
