# Plan: acting on the finish review

Working state for the interface rebuild. Written to survive a new session, since the task list
does not. Read this and `PRODUCT.md` first; `docs/DESIGN_NOTES.md` holds the physics and the
23-entry assumptions register, which this work does not touch.

Last updated 2026-08-24.

## Where things stand

The interface was rebuilt into the **Run Plan** world: NCR carbon-copy stock, a white top sheet
over a canary duplicate, a printed process-blue grid, ballpoint ink, red and blue pencil
annotation. Five of the six tasks that built it are done: the token layer, the chrome as ruled
sheet, the landing, the printed 3D scene, and the verification pass.

The finish reviewer then returned **disposition: rebuild**, scoped to the landing. The rebuild is
committed as of 2026-08-21, in three commits on `main` starting at 454ec08, so `git log` carries
it. **Seven of the eight items below are now closed.** Only item 8 is open, and it is waiting on
a fresh finish review rather than on any code.

What the reviewer said to keep, unchanged: the phase palette and its reasoning, the zero-radius
square cut, and the rail's column-head-and-rule structure, as "the only places the run plan is
genuinely the world rather than a label on it".

## Open items

1. ~~Rebuild the landing's first viewport as a ruled run sheet.~~ **Done.** The sheet carries a
   masthead, a deck, the lap time monumental with its provenance under it, a bounded diagram
   plate, live corner rows and a right margin. Two decisions worth knowing: the 3D is a *figure*
   printed into the sheet rather than a backdrop (ViewOffset now takes four-sided insets and the
   camera composes for the plate), and a corner row is the way in, so the cover is the first
   instance of what the tool does. The margin column is a second live solve at μ0.95.
2. ~~Self-host Archivo or drop it.~~ **Done.** Self-hosted via `@fontsource-variable/archivo`,
   weight axis only, imported in `main.tsx`. One 35 kB latin woff2 is fetched; the other two
   subsets are gated by unicode-range and never requested for a latin page. Note `--font-display`
   is set on html, body and #root, so this is the whole interface, not a headline treatment, and
   every screenshot taken before this shows the wrong face. Greek mu falls outside the latin
   subset, so U+03BC alone still renders in the fallback.
3. ~~Bind `panelRaised` or strike it.~~ **Done.** Bound, via a `RaisedSheet` primitive. The
   ghost's readout and the ghost's own control both sit on the canary duplicate and nothing else
   does, so the colour is a role. It rebinds `--text-dim` to the muted tone on that surface,
   because the canary is darker than the top sheet and dim lands at 4.28:1 there, which fails AA.
4. ~~Replace the 16 unicode glyph icon sites with drawn SVG.~~ **Done.** `src/ui/Icon.tsx`, 15
   marks on a 16-unit grid. The two arrows left in HelpOverlay are key caps naming the arrow keys,
   which is text about a key rather than an icon.
5. ~~Theme the native selects, restate the error card as a ruled block.~~ **Done.** Both were
   platform controls leaking into the world; so was the `<details>` marker, which is now drawn and
   rotates on open. The error surface is a sheet on the binder with the cover's own masthead and
   double rule. Behaviour untouched, and `verify-p0.mjs` still passes the error path.
6. ~~Derive the dark rendition as stock under a lamp, not leather grain.~~ **Done, and it is a
   derivation rather than a palette.** The dark block is now the light block's own values run
   through one transform, stated in `theme.ts` and re-run against the shipped values by
   `src/ui/theme.test.ts` so it cannot quietly drift back into two hand-tuned themes:

       linear_rgb * t * [1.10, 1.00, 0.74]

   The vector is the lamp's chromaticity, normalised to luminance 1 so it tints without dimming.
   `t` is the illumination: 0.57 on the sheet, which lands paper at L* 79 instead of 98, and
   0.022 for `bg`, the binder out on the desk where the lamp does not reach.

   Three consequences that are the actual work, not side effects:

   - **The sheet stays paper and the ink stays dark.** This is not an inverted interface and not
     a low-luminance mode. That was a real choice with a real cost, taken because the toggle has
     always said "read under the work lamp" and every other call in this rebuild took the
     literal reading over the UI convention.
   - **The night scene is gone.** It was the leather. The sun no longer drops to a low raking
     angle, the terrain field no longer blends additively as a star field with its own
     `ADDITIVE_FOG` path, the sky has no disc and no stars, and ACES no longer switches on. The
     plate is a printed figure in both renditions, so `Scene.tsx` and `TerrainMesh.tsx` lost
     every `theme === "dark"` branch they had.
   - **The key light needed its own token.** `lightKeyTint` is white in daylight, which looks
     redundant until you dim every reflectance in the scene and leave three.js's default white
     key behind it: the road then renders brighter than the sheet it is printed on. That is what
     the first lamp capture showed, and it is why the token exists.

   Contrast was the one place physics had to be overruled. WCAG's flare term is a fixed +0.05, so
   dimming costs contrast that correctness cannot give back. Every pair lands within 0.2 of its
   daylight counterpart except `textDim` (4.13:1) and `phaseCoast` (2.88:1), which are darkened
   by hand and marked at their token. Both directions are pinned by the test.
7. ~~Fix the ghost delta sign inversion.~~ **Done.** One exported `deltaToGhost(car, ghost)`
   in `solver/lapTime.ts`, used by all four sites, pinned by a test. Note that the critique
   prescribed `ghost - car` *and* "negative = quicker", which cannot both hold; the convention
   kept is **car minus ghost, negative is quicker**, because that is what a delta bar shows a
   driver and what a time variance channel shows an engineer. DeltaTrace's 46px gutter now
   carries ticks, a zero and the key; the rail's lap time carries its provenance.
8. **Write DESIGN.md from the rebuilt world.** The only open item. 1 to 7 are done, so what is
   left is a fresh finish review returning something other than rebuild. DESIGN.md is recorded
   from the built artifact rather than from intentions, so it cannot be written while a rebuild
   disposition stands.

## Closed, and why it matters

**The diagram block dropping the circuit's upper half is not a defect.** It was the review's most
alarming item and it was an artifact of the screenshot harness, not the product.

Playwright's default headless is the old headless shell, and it composites this canvas missing the
top `insets.bottom` rows: with the dock open, the upper half of the circuit vanishes and the
corner labels hang over blank sheet. Evidence that the app is correct:

- `readPixels` on the same frame returns the road at those rows, and a dump of the whole drawing
  buffer shows the complete circuit correctly framed.
- The projection matches `ViewOffset`'s intent exactly, checked against three.js's own frustum
  arithmetic: `setViewOffset(1372, 522, -68, 0, 1440, 840)` at 1440x900 with the dock open.
- A headed browser screenshots it intact at every sampled row.

Ruled out along the way, so nobody re-tests them: scissor rect, GL viewport, clipping planes,
multiple renders per frame, fog (density 6.3e-5, about 1.6% at 2 km, far too weak to cut
anything), and camera pose, which does not depend on the insets at all.

The fix is `channel: "chromium"` in `scripts/shots.mjs` and `scripts/verify-p0.mjs`, with the
reasoning in place at both call sites. `deviceScaleFactor: 2` does not help.

**One loose thread.** The dropped strip is 319 rows and the dock is 319px, matching to the pixel,
and there is no mechanism on offer for why a compositor artifact would align to a DOM panel's
height. Measured cleanly once, at 1440x900. It does not threaten the conclusion, which rests on
the buffer and the headed capture rather than on the strip's geometry. The cheapest way to close
it is a human looking at `npm run dev` in a real browser at roughly 1440x900, light theme, both
panels pinned.

**Consequence for the review.** Every frame this harness produced before the fix was unreliable in
the 3D region whenever a panel was open, which is most of them. Judgements made about the
circuit's composition from those frames deserve a second look against fresh captures. The
reviewer's other findings do not depend on the 3D region and stand.

## Verifying

    npm run build      # tsc --noEmit && vite build
    npm test           # 122 tests
    node scripts/verify-p0.mjs
    npm run shots

All green as of the last run: 192 tests, 70 of them the theme derivation. `verify-p0.mjs` captures
9 frames at 1600x900, 1440x900, 1024x700 and 390x844, plus the error card, and its shots now
reflect what a person sees. Both harnesses photograph the work-lamp rendition:
`lamp-both-pinned` in `shots-p0`, `spa-overview-lamp` and `spa-chase-lamp` in `shots`. The old
`spa-overview-light` was removed because it stopped photographing anything the moment light
became the default.

**One harness noise to ignore.** The first case of every run logs two 404s. It is a race against
`vite preview` starting up, not the page: a fully warmed load with a `response` listener attached
reports nothing above 400. It appears on whichever case runs first, in either theme.
