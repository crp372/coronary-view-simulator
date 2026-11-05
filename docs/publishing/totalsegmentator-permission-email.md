# Permission request to the TotalSegmentator author (as sent)

Status: **sent; permission granted** (2026-11-05): see [totalsegmentator-permission.md](totalsegmentator-permission.md). This is the request as sent, kept for the record; it covers both the website and a public source repository. Background: [LICENSING.md](LICENSING.md).

**To:** jakob.wasserthal@usb.ch
**Subject:** Permission request: publishing TotalSegmentator-derived meshes in a free educational angiography simulator

---

Dear Dr Wasserthal,

I'm a fourth-year medical student at Humanitas University in Milan, and I'm building a free, browser-based teaching tool for coronary angiography projections, the Coronary View Simulator. Students move a virtual C-arm and see a simulated fluoroscopy image, computed from a real coronary CT (ImageCAS), with the cardiac anatomy overlaid.

I requested a non-commercial licence for TotalSegmentator, and I ran heartchambers_highres locally on two ImageCAS scans (814 and 905). Before putting the simulator online, I'd like to make sure that what I plan to publish is within the licence. If it isn't, I'm asking for your written permission under clause 3.4.

**What I would publish:**
- Surface meshes of the chambers, myocardium, aorta and pulmonary artery, made from the segmentations (smoothed, about 1.4 mm), shown as an overlay and in a 3D view.
- Data derived from the masks: a guide-catheter path along the aorta, coronary side branches kept out of the blood pool using the masks, and the heart's axis for a modelled cardiac motion.

The site would be completely free, with no ads, payments or sponsorship, and purely educational. It isn't a medical device and isn't meant for clinical use.

**Hosting:** a free static website (for example GitHub Pages), with its source in a public repository. The repository would contain only the derived meshes and data above, not the TotalSegmentator software, the model weights or the raw masks.

**Attribution:** the website would cite your Radiology: AI paper (doi.org/10.1148/ryai.230024) and credit you, the Department of Radiology and Universitätsspital Basel as the source of the segmentations. I'm happy to use any wording you prefer, and to send you the link once it's live.

Would this be acceptable? If any part of it isn't, I'd be grateful to know which, so I can change it or leave it out.

Thank you to you and your team for making TotalSegmentator available!

Kind regards,
Chiran Raj Pandey
Fourth-year medical student
Humanitas University, Milan
