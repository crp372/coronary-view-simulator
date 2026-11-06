# Licensing for hosting online

Can the simulator be hosted online for free, non-commercially, for teaching? This is a reading of each licence's text (checked 2026-11-05), not legal advice. Status: **TotalSegmentator permission granted** (2026-11-05) for this project's website and public repository: see [totalsegmentator-permission.md](totalsegmentator-permission.md). The request is in [totalsegmentator-permission-email.md](totalsegmentator-permission-email.md).

## Summary

| Source | Licence | Free public hosting? | Conditions |
|---|---|---|---|
| ImageCAS (the CT volumes) | CC BY-NC 4.0 (Kaggle's licence field; the GitHub page adds no further terms) | Yes | Attribution, a link to the licence, a note of the changes, and non-commercial use only |
| ImageCAS-X (labels, centrelines) | CC BY 4.0 | Yes | Attribution and a note of the changes |
| TotalSegmentator `heartchambers_highres` | Universitätsspital Basel non-commercial licence (PDF dated 23/08/23) | **Yes, by written permission** (2026-11-05) | Credit as promised; send the link once live; publish derived data only |
| TotalSegmentator open tasks (e.g. `total`) | Apache-2.0 | Yes | Keep the licence notice |
| Three.js r128 | MIT | Yes | |
| Google Fonts (Archivo Narrow, Inter, JetBrains Mono) | SIL Open Font License | Yes | |
| Wikimedia CC-BY cine runs | CC BY | Not redistributed (used only to tune the image) | |

## ImageCAS: CC BY-NC 4.0

Sharing and adapting are allowed, including the de-contrasted, resampled and cropped CT in `data/web/<id>/ct.u8.gz`, provided:
- **Attribution:** cite Zeng, Xu et al., *ImageCAS*, Comput Med Imaging Graph 2023. The citation is already in each `meta.json`.
- **A link to the licence:** https://creativecommons.org/licenses/by-nc/4.0/
- **A note of the changes:** e.g. "de-contrasted (blood pool clamped to 50 HU), resampled to 0.9 × 0.9 × 1 mm and cropped; coronary lumen resampled from ImageCAS-X labels".
- **Non-commercial:** no ads, paid tiers, sponsorship or paid courses built on it. Avoid free hosts that insert their own ads. A donation button is a grey area; leave it out.

## TotalSegmentator `heartchambers_highres`

Read from the full agreement linked from https://backend.totalsegmentator.com/license-academic/ (the "Open License Agreement" button):
- **2.1, 3.1:** the software may be used only for internal research, testing and evaluation.
- **3.2:** the only rule about outputs ("results", explicitly including segmentations): they may not be used to train a similar algorithm.
- **3.3, 3.4:** no distributing the software, and no using it in a service made available to third parties, without prior written permission from the principal investigator, Dr Jakob Wasserthal. Clause 3.4 says to ask by email.
- **3.6:** academic publications cite https://doi.org/10.1148/ryai.230024 and acknowledge Dr Wasserthal, the Department of Radiology and the USB; copies of public releases go to him.
- **4:** not cleared for diagnostic or therapeutic use.
- **9:** Swiss law, courts of Basel-City.

**Reading:** publishing the outputs isn't explicitly forbidden, but a public teaching website is hard to fit under "internal research, testing and evaluation". So get written permission before publishing anything derived from these masks.

**What in the app comes from it** (both hearts, 814 and 905):
- `chambers.bin.gz` and `chambers.json`: meshes of the chambers, myocardium, aorta and PA (the overlay and the room view).
- `catheter.json`: shaped along the `aorta` mask.
- The branches grown from the CT in `coronary.rgb8.gz`: kept out of the blood pool with the masks.
- `synthetic.u8.gz`: the illustrative fine branches, grown over the heart surface from the masks.
- The cardiac motion's frame: computed in the app from the chamber meshes.

**If permission is refused:**
- Re-export with the open `total` task (Apache-2.0). It gives `heart`, `aorta`, `pulmonary_vein` and `atrial_appendage_left` (checked in TotalSegmentator 2.18.0), but no separate chambers and no pulmonary artery.
- That still covers the catheter, the blood-pool mask and the fine branches.
- The chamber overlay would be lost, and the motion frame would need another source.
- The app already runs without the chamber files.

## Before publishing

- [x] Written permission from Dr Wasserthal: granted 2026-11-05 ([totalsegmentator-permission.md](totalsegmentator-permission.md)). Covers the described use for the project as a whole, including further hearts prepared the same way.
- [x] A credits and licences section on the site: ImageCAS, ImageCAS-X and TotalSegmentator, each with its licence link and a note of the changes (About dialog, "Credits and licences").
- [x] A notice that it's a teaching tool, not a medical device, and not for clinical use (same section).
- [x] Hosting chosen: Cloudflare Workers static assets, free and without ads, at https://coronary.chiranpandey.com/ (2026-11-06). No bundling needed; `tools/build_site.sh` copies only the site's files.
- [x] Source repository public: https://github.com/crp372/coronary-view-simulator. It contains the derived data files, which the permission covers; raw data stays in the git-ignored `data/raw/`.
- [ ] After release, a link sent to Dr Wasserthal (clause 3.6).
