# Plan: acting on the finish review

Working state for the interface rebuild. Written to survive a new session, since the task list
does not. Read this and `PRODUCT.md` first; `docs/DESIGN_NOTES.md` holds the physics and the
23-entry assumptions register, which this work does not touch.

Last updated 2026-08-21.

## Where things stand

The interface was rebuilt into the **Run Plan** world: NCR carbon-copy stock, a white top sheet
over a canary duplicate, a printed process-blue grid, ballpoint ink, red and blue pencil
annotation. Five of the six tasks that built it are done: the token layer, the chrome as ruled
sheet, the landing, the printed 3D scene, and the verification pass.

The finish reviewer then returned **disposition: rebuild**, scoped to the landing. Everything
below is the open list. The rebuild is committed as of 2026-08-21, in three commits on `main`
starting at 454ec08, so `git log` now carries it.

What the reviewer said to keep, unchanged: the phase palette and its reasoning, the zero-radius
square cut, and the rail's column-head-and-rule structure, as "the only places the run plan is
genuinely the world rather than a label on it".

## Open items

1. **Rebuild the landing's first viewport as a ruled run sheet.** Replace the three-up stat row,
   which is the hero-metric template the craft floor refuses. Corner rows, printed grid, deltas in
   a real right margin, lap time monumental as page structure. Name the vehicle. Qualify the lap
   time, since absolute lap times are estimated and not measured.
2. ~~Self-host Archivo or drop it.~~ **Done.** Self-hosted via `@fontsource-variable/archivo`,
   weight axis only, imported in `main.tsx`. One 35 kB latin woff2 is fetched; the other two
   subsets are gated by unicode-range and never requested for a latin page. Note `--font-display`
   is set on html, body and #root, so this is the whole interface, not a headline treatment, and
   every screenshot taken before this shows the wrong face. Greek mu falls outside the latin
   subset, so U+03BC alone still renders in the fallback.
3. **Bind `panelRaised` or strike it.** Declared at `theme.ts:19`, valued at `:104` and `:159`,
   mapped to `--panel-raised` at `:248`, consumed nowhere. It carries the promise that the sheet
   you are reading tells you which solve you are reading.
4. **Replace the 16 unicode glyph icon sites with drawn SVG.**
5. **Theme the native selects, restate the error card as a ruled block.** Presentation only: the
   error path's behaviour is fixed and verified, do not regress it.
6. **Derive the dark rendition as stock under a lamp,** not leather grain.
7. ~~Fix the ghost delta sign inversion.~~ **Done.** One exported `deltaToGhost(car, ghost)`
   in `solver/lapTime.ts`, used by all four sites, pinned by a test. Note that the critique
   prescribed `ghost - car` *and* "negative = quicker", which cannot both hold; the convention
   kept is **car minus ghost, negative is quicker**, because that is what a delta bar shows a
   driver and what a time variance channel shows an engineer. DeltaTrace's 46px gutter now
   carries ticks, a zero and the key; the rail's lap time carries its provenance.
8. **Write DESIGN.md from the rebuilt world.** Blocked on 1 to 7 and on a fresh finish review
   returning something other than rebuild. It is recorded from the built artifact, not from
   intentions, so it cannot be written under a rebuild disposition.

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

All green as of the last run. `verify-p0.mjs` captures 8 frames at 1600x900, 1440x900, 1024x700
and 390x844, plus the error card, and its shots now reflect what a person sees.
