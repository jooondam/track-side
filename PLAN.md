# Plan: acting on the finish review

Working state for the interface rebuild. Written to survive a new session, since the task list
does not. Read this and `PRODUCT.md` first; `docs/DESIGN_NOTES.md` holds the physics and the
23-entry assumptions register, which this work does not touch.

Last updated 2026-08-25.

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
   daylight counterpart. Two fell under their floor when derived and were darkened by hand until
   they cleared it, so **the shipped values pass**: `textDim` is 4.59:1 on panel, corrected up
   from the 4.13:1 the raw transform gave, and `phaseCoast` is 3.05:1, corrected up from 2.88:1.
   The floors are asserted for both renditions in `src/ui/theme.test.ts`, which also pins the
   corrections as darkenings only. An earlier draft of this paragraph quoted the pre-correction
   numbers in a way that read as the shipped ones, and a finish reviewer duly filed it as an
   accessibility defect; the numbers above are the ones in the build.
7. ~~Fix the ghost delta sign inversion.~~ **Done.** One exported `deltaToGhost(car, ghost)`
   in `solver/lapTime.ts`, used by all four sites, pinned by a test. Note that the critique
   prescribed `ghost - car` *and* "negative = quicker", which cannot both hold; the convention
   kept is **car minus ghost, negative is quicker**, because that is what a delta bar shows a
   driver and what a time variance channel shows an engineer. DeltaTrace's 46px gutter now
   carries ticks, a zero and the key; the rail's lap time carries its provenance.
8. ~~Write DESIGN.md from the rebuilt world.~~ **Unblocked, not yet written.** The finish review
   ran on 2026-08-24 and returned **disposition: fix**, not rebuild, which is the condition this
   item was waiting on. Its eight material fixes are the list below; all eight are addressed and
   committed. What is left is a second review pass on the fixed artifact, then the write-up.

   **Note for that pass:** two further rounds landed on 2026-08-25, after the eight fixes and
   before any review saw them. See "Work since the review" below. The artifact has moved
   substantially, so DESIGN.md must be written from the current build rather than from the state
   the 2026-08-24 review described.

## The finish review of 2026-08-24, and what it cost

Disposition **fix**. It passed persistence and truth outright, and named what to keep: the red
pencil box on the primary action, the provenance line and the SOLVED, NOT DRIVEN strap, the corner
rows as the way in, the mono/proportional split that marks machine-printed values, the zero-radius
square cut, and the process-blue grid on the white sheet.

**Before any of it could be judged, the cover had to be photographed.** Every one of the 27 frames
in both harnesses carried `enter=1`, and `App.tsx` sets `showLanding = !initial.enter`, so the
shipped first view had never been captured by anything. Fixed in 46815c4; `shots-p0` now carries
nine cover frames including `-full` companions and one past the cover's own button.

All eight fixes are in, across 590f8c7, c008a55, 1607ac0, a347c08 and 85c6b45:

1. **The plate's field is printed on the cover** and still recedes in the viewer. Scoped that way
   on purpose: in the viewer the radial fade is load-bearing, and `terrainGrid.ts` records the
   rectangular plateau edge it hides as a measured defect.
2. **The plate is ruled to the sheet's measure**, within 1.5px at five widths. Padding could not
   do it, because padding on a transparent element is still transparent, so the margins are real
   paper and the plate is the window between them.
3. **The camera fits the circuit to whatever rectangle is live.** There was no fitting logic to
   repair: the poses were a fixed multiple of the circuit's extent with one scalar that was 1.7 in
   portrait and 1 everywhere else.
4. **Declined, on measurement.** The review read PLAN.md's pre-correction numbers as the shipped
   ones. See item 6 above: the build is 4.59:1 and 3.05:1, asserted for both renditions.
5. **The cover's orbit fits its plate too.** It was the one camera path that never went through the
   viewpoints, standing at a hand-tuned distance fitted by eye to the desktop plate.
6. **The strap breaks between fields.** The collision it reported is not real: measured 8px of rule
   clearance at 390, 360 and 320. The bad wrap was real and is fixed.
7. **One mu.** U+00B5, which Archivo's latin subset covers, against U+03BC which no subset covers.
   Measured at 565 differing pixels against a control of 0.
8. **The cover's second solve sits on the canary**, which is what the duplicate already means
   everywhere else in the product.

**Two findings the review did not make, both turned up by working on the ones it did.** The
viewpoint pill was never counted as an inset, so corner labels could be pushed under it exactly as
the circuit was pushed under the dock. And `--neg` on the canary is 4.27:1 under the lamp, which
the rail's ghost delta readout has been shipping since the canary was bound. Both fixed, both
pinned.

**One finding was declined with reasons, and should be expected back.** The review read the plate's
field being cooler than the paper as a defect. The sheet is printed in process blue: `line` against
`panel` is a b-r gap of +27, and the same pass praised that grid as correct. The field now sits at
+15 against the paper's -4, between bare stock and the printed grid. Matching the paper's
temperature would make it graphite on a sheet that is not printed in graphite.

~~**Known, unfiled, not fixed.** `mobile-dock.png` has a header collision in the telemetry strip at
390px.~~ **Closed on 2026-08-25** by the density pass below. The panel's own name now gives way on
a phone, dropped rather than clipped, because it names the container it is inside while the numbers
beside it are the information.

## Work since the review, 2026-08-25

Two rounds landed after the eight fixes. Both are committed; neither has been reviewed.

### The ghost car ran on its own clock (`e728f25`)

The ghost and the live car drifted onto opposite sides of the circuit. Two causes, one of them a
real bug.

**The bug:** `progressRef.current.scrub` was never cleared, so it latched the last request forever
and a ghost mounted mid-lap adopted it on its first frame, snapping to the start line while the car
was half a lap away. **The design:** there was no central clock. Each marker owned its own playback
and `sAtTime` wraps modulo *that solve's* lap time, so two cars holding equal elapsed time wrapped
at different periods and the quicker ghost gained a whole lap periodically.

Both are fixed by hoisting the clock. `LapClock` in `Scene.tsx` is the only thing that advances the
lap; both markers read it and ask their own table where that puts them. Because it wraps on the
live car's lap time the two get a **rolling start**: the gap is one lap's grip cost and never more.

Three things fell out rather than needing their own fixes: the mount bug died with the marker's own
`sRef`, the scrub-id handshake is deleted, and the lossy per-frame `s -> t -> s` round trip is
gone. The ghost's table was also being built twice from one solve.

The gap is now legible: a dashed leader along the racing line labelled with the delta, a second
quieter marker on the timeline, and the separation in metres. **Seconds and metres are labelled
apart on purpose** — the seconds are `liveDeltaToGhost`, distance-aligned and the same helper the
rail and dock use; the metres are `gapMetres`, the instantaneous separation. As an unlabelled pair
they would read as two answers to one question.

`lapClock.test.ts` pins the regression directly: across 20,000 simulated frames the shared clock
holds the gap under a lap's worth of road while the old independent-clock arithmetic reaches the far
side of the circuit.

### The viewer was sparse and decorated at once (`f06ac12`)

A density and ornament pass, taken **inside** the world rather than against it, because
`index.html:59-73` refuses near-black telemetry chrome by name and the review's keep-list stands.
Measured before: ~85,000 px per number at rest, ten type sizes, seven letterspacings, a third of the
rail in section furniture.

- **A closed type scale.** Four sizes, all already in use, published as `TYPE` and read by the DOM
  *and* the canvases. That closes a claim that was not true: `primitives.tsx` has said 12 is the
  smallest type in the interface for as long as it has existed, but the four charts drew at 9 and
  10. `type.test.ts` walks the source and fails on any numeric `fontSize`, hardcoded `ctx.font`
  shorthand or `letterSpacing` literal.
- **Captions became live channels.** Each chart printed a caption naming the chart it was already
  inside; each now prints its channel and its value at the shared cursor. This is the MoTeC i2 and
  ATLAS pattern, and the charts already shared a cursor and an x axis, so it completes a pattern
  rather than importing one.
- **The delta row is not mounted without a ghost.** 64 of the dock's 284px printed one sentence in
  the default state; they go back to the scene through the inset path.
- **Dead vocabulary deleted**: `Field` and its leader-dot ornament, `Divider`, `Stat.trend` and its
  three marks, `Stat`'s `md` and `xl`, `SPACE.s6`. None rendered. This matters because DESIGN.md is
  recorded from the built artifact, and documenting the leader-dot row would document an ornament
  that has never shipped.

Section chrome went from 45px head-to-body to 35px across six sections, with the head and the rule
untouched because the review named them load-bearing. **No colour changed**, so `theme.test.ts`'s
lamp derivation and contrast floors pass unmodified; that was the deliberate tripwire.

**One inventory error worth recording.** `variant="quiet"` was reported unused and is not: the
landing's secondary action uses it. Caught by the compiler, restored, not deleted.

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

All green as of the last run: 225 tests. `verify-p0.mjs` captures
13 frames at 1600x900, 1440x900, 1024x700 and 390x844, plus the error card, and its shots now
reflect what a person sees. Both harnesses photograph the work-lamp rendition:
`lamp-both-pinned` in `shots-p0`, `spa-overview-lamp` and `spa-chase-lamp` in `shots`. The old
`spa-overview-light` was removed because it stopped photographing anything the moment light
became the default.

**One harness noise to ignore.** The first case of every run logs two 404s. It is a race against
`vite preview` starting up, not the page: a fully warmed load with a `response` listener attached
reports nothing above 400. It appears on whichever case runs first, in either theme.
