---
name: track-side
description: A racing-line solver that looks like the run plan an engineer fills in during a session, printed on NCR carbon-copy stock.
colors:
  paper: "#fbfaf7"
  canary: "#f4f1e8"
  binder: "#d6d2c7"
  printed-grid: "#b9c4d4"
  rule-strong: "#2a2f36"
  ink: "#16191d"
  ink-muted: "#4e5560"
  ink-dim: "#6b7280"
  red-pencil: "#c8102e"
  red-pencil-deep: "#8f0b20"
  red-pencil-wash: "#f7dbe0"
  blue-pencil: "#1b5e9c"
  phase-accel: "#2f7dc4"
  phase-brake: "#a8102a"
  phase-coast: "#8a9099"
typography:
  hero:
    fontFamily: "ui-monospace, SF Mono, Cascadia Code, Menlo, Consolas, monospace"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  figure:
    fontFamily: "ui-monospace, SF Mono, Cascadia Code, Menlo, Consolas, monospace"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "0"
    fontFeature: "tabular-nums"
  value:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  label:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  sm: "0"
  md: "0"
  lg: "0"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
components:
  button-default:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "28px"
  button-default-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "28px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.value}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "40px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.sm}"
    width: "28px"
    height: "28px"
  select-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.value}"
    rounded: "{rounded.sm}"
    padding: "0 26px 0 8px"
    height: "28px"
  section-head:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    padding: "8px 12px"
  canary-sheet:
    backgroundColor: "{colors.canary}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px"
  kbd:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 5px"
---

# Design System: track-side

## Overview

**Creative North Star: "The Run Plan on NCR Carbon-Copy Stock"**

This interface is the working document an engineer fills in during a session, not a HUD floating over a dark scene. Every surface is a sheet of paper: a white bond top sheet (`panel` `#fbfaf7`, deliberately not cream), a canary duplicate underneath it (`panelRaised` `#f4f1e8`), and a manila binder behind both (`bg` `#d6d2c7`). The 3D circuit is not a backdrop the chrome sits on; on the cover sheet it is a bounded figure *printed into* the page, with a rule above it, a rule below it and a caption underneath, the way a diagram sits in a document (`printed` prop on `src/render/TerrainMesh.tsx`).

Two visual anti-references are refused by name in the direction contract at `index.html:55-73` and by the build: the near-black telemetry chrome this category always ships, and the cream-paper-and-serif rendition the subject would otherwise attract. What replaced them is a run plan's own vocabulary: ruled rows, column heads, boxed cells and printed leaders. There are no cards anywhere in `src/ui/primitives.tsx` and no rounded corners anywhere in the build (`RADIUS` is `0/0/0` in `src/ui/theme.ts`).

The system is dense, monochrome-legible and load-bearing. Colour is never decoration and never the only signal: a pressed control inverts to an ink fill rather than tinting; a delta always writes its sign; the racing line's phase is carried by stroke weight as well as hue. That discipline is enforced in the primitives rather than at call sites, so it cannot be forgotten per component. WCAG 2.2 AA is binding (PRODUCT.md), and the first finish review's contrast finding was answered with measured values asserted in `src/ui/theme.test.ts` (`textDim` 4.59:1, `phaseCoast` 3.05:1), not with a softened rule.

**Key Characteristics:**
- Paper is the substrate, ink is the foreground; nothing is inverted or "dark mode" in the low-luminance sense.
- Rules and column heads instead of cards; zero radius everywhere.
- Numbers set in mono, prose in proportional, and the split is load-bearing.
- Two renditions, one palette: the lamp rendition is *derived* from daylight by a stated transform, not designed beside it.
- No shadows at all. Depth is tonal sheet-on-sheet and ruled weight.
- Every state that matters survives a monochrome print and all three common colour-vision deficiencies.

## Colors

Bond paper, printed process-blue grid, ballpoint ink and two annotation pencils; nothing else is on the sheet. The frontmatter records the daylight rendition, which is the default and the primary (`initialTheme()` in `src/ui/theme.ts`).

### Primary
- **Red Pencil** (`red-pencil`): the accent, the marker's own colour. It is the focus outline (`2px solid var(--accent)` with `2px` offset, the one focus treatment in the build), the slider's `accentColor`, the brand lozenge on every masthead, and the row hover on the cover at 9% mix. `red-pencil-deep` is the foreground drawn on the `red-pencil-wash` toggle fill, because the accent itself fails 4.5:1 there in both renditions. `red-pencil` is also `neg`.
- **Blue Pencil** (`blue-pencil`): `pos`. The second annotation colour, used for a delta that is quicker.

### Secondary: the phase palette
Three tokens that colour the racing line, and the most constrained decision in the system.

- **Phase Accel** (`phase-accel`, 4.2:1 on paper, L* 51)
- **Phase Brake** (`phase-brake`, 7.4:1 on paper, L* 35)
- **Phase Coast** (`phase-coast`, 3.05:1 on paper, low chroma so it recedes)

Red against blue rather than red against green, because red/green is exactly the axis lost in deuteranopia and protanopia and phase is the core encoding of the whole tool. The pair is separated on lightness as well as hue (L* 51 against 35 in daylight, 39 against 28 under the lamp), and reinforced by stroke weight, so a monochrome print of the screen still reads. The reasoning is in the token block in `src/ui/theme.ts`; the constraint is in PRODUCT.md.

### Neutral
- **Bond Paper** (`paper`): the top sheet, and the surface the contrast ratios are specified against.
- **Canary Duplicate** (`canary`): the second sheet. Under the lamp it stays yellow relative to its own sheet (b* 16.5 against 14.7), which is why it is not simply "a slightly darker panel".
- **Manila Binder** (`binder`): what the sheets lie on, and the colour every scrim is made from.
- **Printed Grid** (`printed-grid`): process blue at working strength. It is the stock, drawn under the type at a 22px pitch on the cover's paper blocks, not a texture behind a hero.
- **Rule Strong** (`rule-strong`): the 2px ink of a column head or a sheet's top edge.
- **Ink / Ink Muted / Ink Dim** (`ink` 17.3:1, `ink-muted` 7.2:1, `ink-dim` 4.6:1 on paper): the three text weights. The greys are exactly as light as they need to be to clear 4.5:1 on their own panel, which is why they look less subtle than a conventional dim tone. That is the intended trade.

### Named Rules

**The One Stock Rule.** Nothing in `src/` may contain a hex literal outside `src/ui/theme.ts`. The DOM reads tokens as CSS custom properties; the canvas charts and the three.js scene read the same values as plain strings through `useThemeTokens`, because neither can resolve `var()`. Real-world materials that have a colour rather than a design (tyre rubber, FIA kerbs, brake glow) live in the `MATERIAL` block of the same file so the rule stays a rule with no judgement calls in it.

**The Derived Lamp Rule.** The lamp rendition is not a second palette. Every reflectance is the daylight value through `linear_rgb * t * [1.10, 1.00, 0.74]`, where the vector is the lamp's chromaticity normalised to luminance 1 and `t` is illumination: **0.57** on the sheet, **0.022** for `bg`, the binder out on the desk. `src/ui/theme.test.ts` re-runs that transform against the shipped values, so the two blocks cannot drift into hand-tuning. Exactly two departures are permitted and both are pinned as *darkenings only*: `textDim` (from `#565755`, which fell to 4.13:1) and `phaseCoast` (from `#6f6f67`, 2.88:1). Contrast is the one place physics is overruled, because WCAG's flare term is a fixed `+0.05` and dimming costs contrast that correctness cannot give back.

**The Canary Means One Thing Rule.** `CANARY` (`src/ui/primitives.tsx`) is the second solve and nothing else. It appears on the ghost's readouts in the rail and on the cover's right margin column, and nowhere else. Colour is a role: the sheet you are reading tells you which solve you are reading. The surface rebinds two tokens, both measured rather than precautionary: `--text-dim` to the muted tone (it lands at 4.28:1 daylight / 4.26:1 lamp on canary) and `--neg` to `red-pencil-deep` (4.27:1 under the lamp, and this was a live defect on the ghost's delta readout, not a hypothetical). `--pos` needs no help at 5.94 / 5.19.

**The Never Colour Alone Rule.** No state, phase or sign is carried by hue by itself. A pressed control inverts to an ink fill. A delta writes `+` or `−` (U+2212, so the minus sits at digit width in tabular figures) and prints exact zero unsigned. Phase carries stroke weight. The audit test: screenshot the surface, desaturate it, and every distinction must survive.

## Typography

**Display / Body Font:** Archivo Variable, self-hosted via `@fontsource-variable/archivo/wght.css` (imported in `src/main.tsx`), with a system sans fallback stack.
**Numeric Font:** the platform mono stack (`ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas`), always with `font-variant-numeric: tabular-nums` via the `.tnum` class, so numerals never reflow as they tick.

**Character:** a technical grotesque set tight and small, with every number pulled into mono. It reads as a form that was typed rather than a page that was designed.

### Hierarchy
The scale is four sizes, two trackings and three weights, and it is **closed**. `src/ui/type.test.ts` asserts the counts, asserts the ordering and distinctness, asserts a 12px floor, and then walks every `src/ui/*.tsx` file and fails on any numeric `fontSize`, any hardcoded `ctx.font` shorthand in the canvas charts, or any `letterSpacing` literal.

- **Hero** (mono, 500, 30px, 1.15): the lap time in the title block (`src/ui/TopBar.tsx`). The answer the whole tool exists to produce, and the only thing at that size.
- **Figure** (mono, 500/600, 22px, 1.15): a number that anchors a section. The grip slider's readout, `Stat size="lg"`, and the error card's heading.
- **Value** (15px, 1.6): a number read at a glance, and the cover's body prose (capped at `46ch`).
- **Label** (12px, `0.08em`, uppercase, 700 on a section head): the interface floor. `primitives.tsx` claimed 12 as the smallest type for as long as it existed, but that only described the DOM; the four canvas charts drew axis ticks and corner names at 9 and 10. They read `TYPE` now, so the claim and the artifact agree.

### Named Rules

**The Two Faces Rule.** Numbers are set in mono; prose and labels are set in Archivo. This split is load-bearing and carries most of the world in the app chrome, where there is no printed grid to do it. The four-size scale must not be allowed to swallow it: closing the *size* ramp is not permission to collapse the *face* distinction.

**The Named Exception Rule.** The scale is closed, so an exception must be a named constant rather than a literal. There is exactly one in the app chrome: `MASTHEAD_TRACK = "0.14em"` in `src/ui/Landing.tsx`, wider than the interface's label tracking because a masthead is display type on a cover sheet read once, where a working screen wants a tracking you stop noticing. `type.test.ts` bans raw `letterSpacing` values precisely so exceptions have to say what they are.

**The Micro Sign Rule.** The grip symbol is U+00B5 MICRO SIGN, imported as `MU` from `primitives.tsx`, never typed. Archivo's latin subset declares U+0000-00FF and covers it; **no shipped subset covers U+03BC GREEK SMALL LETTER MU**, so the Greek character was silently falling back to the system face, one glyph out of family. Measured, not assumed: drawn at 120px in the app's own stack the two differ by 565 pixels, against 0 for the same character twice. Keep `MU` out of anything CSS uppercases: it maps to U+039C and prints as a Latin M, which is why `Stat`'s label prop documents that grip belongs in `note`.

## Layout

One centred column of `1040px` maximum with `clamp(20px, 4vw, 56px)` gutters on the cover sheet; the viewer is a full-bleed scene with chrome pinned to its edges. Spacing is a five-step scale (`4 / 8 / 12 / 16 / 24`), published as `--s1`..`--s5` from the same `SPACE` object that the TS reads, so CSS and TS cannot drift.

The chrome is three fixed instruments around the scene, and each publishes its size as both a CSS variable and a camera inset, from one exported constant, because two copies of a number is exactly how the camera ends up composing for a frame that no longer exists:

- **Side rail** (`src/ui/SidePanel.tsx`): `RAIL_COLLAPSED_W = 68`, `RAIL_EXPANDED_W = 280`. Collapsed it is live numbers with no controls; expanded it is five labelled `Section` groups.
- **Telemetry dock** (`src/ui/TelemetryDock.tsx`): `DOCK_STRIP_H = 34` always visible, carrying live speed, g and delta. Expanded heights are sums of their parts rather than round numbers, because an earlier round-number height clipped the timeline. The delta row exists only when there is a ghost to compare against.
- **Top bar** (`src/ui/TopBar.tsx`): the title block, carrying the lap time at Hero.

**Responsive:** one breakpoint that changes structure, `760px` (`useIsNarrow`), below which the rail cannot coexist with a usable viewport and becomes a drawer over it. Everything else is fluid: `useViewportSize` re-fits the camera on any resize, because `src/render/viewpoints.ts` solves `fitDistance` against the rectangle the chrome leaves uncovered and a resize that never crosses a breakpoint still has to re-fit.

**The printed grid** is `22px` square, drawn as two `1px` `color-mix` gradients at 42% of `--line`, offset `-1px`, on the cover's paper blocks only. It is scoped off the viewer deliberately.

### Named Rules

**The Instrument Names Itself Rule.** Each of the four canvas charts prints its channel and its live value where a caption would otherwise name the chart, and the collapsed strip prints only what the open body does not. No instrument spends space on a title that its own axis already gives.

**The Same Place on the Road Rule.** Every trace shares one cursor and one x axis in arc length, so a vertical line through the stack is one point on the circuit. The delta is distance-aligned in all four places it appears (`deltaToGhost` and `liveDeltaToGhost`, `src/solver/lapTime.ts`), under one convention pinned by test: car minus ghost, negative is quicker. Comparing two cars at the same *instant* compares different pieces of road.

## Elevation & Depth

**There are no shadows in this system, at any elevation, in either rendition.** Nothing in the build declares a `box-shadow`. Depth is entirely tonal and ruled: a sheet is distinguished from what is under it by being a different paper (`panel` over `panelRaised` over `bg`) and by the weight of the rule at its edge. A `1px` `--line` is the printed grid's hairline; a `2px` `--line-strong` is a column head or the top edge of a sheet.

Modals are not lifted, they are *laid down*. Every one is the same construction (`src/ui/HelpOverlay.tsx`, and the error card in `src/ui/AppState.tsx`): a `2px --line-strong` top rule, a masthead carrying the lozenge mark and the product name at `MASTHEAD_TRACK`, a second `2px` rule under the masthead, a `1px` bottom rule, no side borders, and a square cut. `520px` wide, `calc(100vw - 32px)` on a narrow window.

### Named Rules

**The Binder Scrim Rule.** A modal veil is the binder's own colour at near-opacity (`color-mix(in srgb, var(--bg) 92%, transparent)`), never black. `rgba(0,0,0,0.5)` greys the paper, the ink and the pencil equally, which is a lighting effect on a sheet that has no lighting. **What recedes is not dimmed, it is covered.**

**The Printed Figure Rule.** The 3D is a figure printed into a sheet wherever it is bounded by the page. `TerrainMesh` takes `printed`, true only for the cover's plate: ink weight (`uInkGain` 0.72), fog off, no atmospheric falloff, no twinkle, a hard bounded edge (`uOpacity` 0.95 against 0.6). The viewer keeps recession, and the sky dome is the sheet's own colour with no sun disc and no stars in either rendition, because stars on a printed page were the clearest thing left saying "3D scene" rather than "drawing". `sceneFog` has exactly three consumers that must never disagree, so fully fogged geometry lands on the same value as the sky it ends against and the terrain plate's silhouette is unfindable.

## Shapes

**Everything is cut square.** `RADIUS` is `{ sm: 0, md: 0, lg: 0 }`. Paper is cut square, nothing in a run book has a rounded corner, and the 2-to-4px radii that were previously here are the single cheapest tell that a surface was assembled from a component library rather than drawn. The only rounded thing in the build is the `4px` scrollbar thumb, which is host chrome.

The recurring silhouettes are a **rule** (a 1 or 2px ink band, `Rule` in `primitives.tsx`), a **boxed cell** (`1px solid var(--line)`, no fill), and a **butted group** (segmented cells sharing one rule via `marginLeft: -1`, as printed boxes are). The brand mark is a lozenge, the shape a corner apex is marked with on a circuit map.

Icons are drawn, not borrowed: `src/ui/Icon.tsx` draws all twelve on a 16-unit grid with flat fills, `1.5`-unit strokes that land on whole pixels at the sizes the chrome uses, no rounded joins and no optical rounding. They carry no accessible name, because each sits inside a control that already has one.

### Named Rules

**The Drawn Mark Rule.** No icon is a Unicode glyph. A glyph is a character: it inherits the text face, is drawn by whatever font on the reader's machine carries that codepoint, and its size, weight and baseline are decided by a type designer solving a different problem. This build previously shipped a black-square play triangle, a fisheye pin and a trigram menu, and the pin and play mark were noticeably different weights for exactly that reason. Draw the path.

**The World Draws Its Own Controls Rule.** Platform-drawn marks are suppressed and redrawn in this world's hand: `appearance: none` on `<select>` with the caret drawn as an `Icon`, `summary { list-style: none }` with the disclosure triangle redrawn as `.ts-marker`. Left native, a select arrives with the host's radius, its own arrow weight and on macOS a blue focus ring, which is three design systems visible inside one field. The honest boundary of this fix: the option list itself is drawn by the OS and cannot be styled.

## Components

### Buttons
- **Shape:** square (`0`), `1px` border, `28px` tall at `sm` and `40px` at `md`; `24px` is the WCAG 2.2 target-size minimum and primaries get 40.
- **Default:** transparent fill, muted ink, `--line` border, label type at weight 500.
- **Primary / Active:** **inverted, not tinted.** Solid `--text` fill, `--panel` text, `--text` border, weight 700. A selected cell on a sheet is inked in. The inversion *is* the state, so it survives a monochrome print and a dichromat reader.
- **Focus:** the single global `:focus-visible` treatment, `2px solid var(--accent)` at `2px` offset. Never removed, never colour-only.
- **Transition:** `background, color, border-color` over `--t-fast` (140ms) on `--ease`.
- **Toggles:** `active` being present is what makes a Button a toggle, and it emits `aria-pressed` automatically.

### Button Group
Segmented cells butted against each other with `gap: 0` and `marginLeft: -1`, sharing one rule. `role="group"` with a required label. This is the radio; `Check` is the checkbox.

### Check
An independent boolean drawn as a ticked box, `14px`, `accentColor: var(--text)`, with an optional dim `note` under the label. It exists because mutually-exclusive choices and independent switches were rendering as the identical control, so nothing on screen said which ones could be on together. **It never fills its whole row**, so a section with three things switched on no longer reads as three alarms.

### Inputs and Fields
- **Select:** a ruled field. `appearance: none`, transparent fill, `1px --line` box, `28px` min height, `240px` max width, caret drawn at 14px and inset `-22px`. An option with an empty value is a placeholder and is `disabled`, because it was selectable and choosing it did nothing, which is a control that lies about being a control.
- **Slider:** visible label as the accessible name (no `aria-label`), with the value set at **Figure** size, because grip is one of the two numbers the whole interface exists to move and a body-size readout made the product's primary input look incidental.

### Section
The run plan's grouping device and the replacement for the card: an uppercase label at Label type in muted ink, a `2px --line-strong` rule 3px under it, then the rows at `--s2` gaps. `padding: var(--s2) var(--s3)`. The first finish review named this one of only three places where the run plan is genuinely the world rather than a label on it; the other two are the phase palette and the zero-radius square cut.

### Stat
Label above, tabular value below. Carries `unit`, an optional `delta` with `deltaTone`, and `note`. Two sizes, because two are used. Structurally it makes provenance the default: a bare figure has to be a deliberate omission rather than the path of least resistance.

### Canary Sheet
The second-solve surface (`CANARY` spread, or `RaisedSheet` for the bordered version at `--s3` padding). A surface rather than a component, so anything can sit on it: a panel, or one column of a table. Carries the two measured token rebindings recorded under The Canary Means One Thing Rule.

### Kbd
A boxed key cap: transparent, `1px --line-strong`, mono, `18px` minimum width, `1px 5px` padding, square.

### Named Rules

**The Number Carries Its Provenance Rule.** PRODUCT.md is explicit that absolute lap times are estimated, not measured. The cover's monumental lap time sets its qualifier directly under it ("Modelled from an estimated g-g-v, not a measured lap"), and `Stat` and `Field` take `note` so the same discipline is structural. A number this size with no qualifier is the single most misleading thing this product could print.

**The Camera Composes For The Page Rule.** `src/render/viewpoints.ts` fits the circuit to whatever rectangle the chrome leaves uncovered (`fitDistance`, closed form, pinned in `viewpoints.test.ts`), and on the cover it composes for the diagram plate's measured rect rather than for the window. Nothing is cropped by the plate's edges and no copy ever sits over the road.

## Do's and Don'ts

### Do:
- **Do** put every colour in `src/ui/theme.ts` and read it as a CSS custom property in the DOM or through `useThemeTokens` in canvas and three.js. No hex literal anywhere else in `src/`.
- **Do** derive any new lamp-rendition value with `linear_rgb * t * [1.10, 1.00, 0.74]`, `t = 0.57` on the sheet and `0.022` on the binder, and add it to the `POOL_KEYS` list in `theme.test.ts`. If contrast forces a hand correction, make it a **darkening** and mark it in the token comment.
- **Do** reuse the four sizes, two trackings and three weights. If a new surface genuinely needs an exception, make it a named exported constant with a comment saying what it is, like `MASTHEAD_TRACK`.
- **Do** set numbers in mono with `.tnum` and prose in Archivo, on every new surface.
- **Do** build groups from a label plus a `2px` rule (`Section`), and separate rows with `1px` rules.
- **Do** express a chosen state as an ink inversion, and a signed quantity with a written `+` / `−`.
- **Do** lay a new modal down as a sheet: `2px` top rule, lozenge masthead, second `2px` rule, `1px` bottom rule, no side borders, square cut.
- **Do** make the scrim `color-mix(in srgb, var(--bg) 92%, transparent)`.
- **Do** print an estimated number with its provenance in the same block.

### Don't:
- **Don't** add a corner radius. `RADIUS` is 0 in all three steps and that is the form language, not a default waiting to be overridden.
- **Don't** add a `box-shadow`. This system has none; use a different paper or a heavier rule.
- **Don't** use a black scrim, or dim a surface to push it back.
- **Don't** pair red against green for phase, or "balance" the phase pair to equal lightness. Both the hue axis and the L* separation are load-bearing, and the L* gap is what keeps it readable in monochrome.
- **Don't** put the canary paper under anything that is not the second solve.
- **Don't** use a Unicode glyph as an icon; draw the path on the 16-unit grid in `Icon.tsx`.
- **Don't** ship a `<select>`, `<summary>` or focus ring at the platform's own weight.
- **Don't** type either mu character; import `MU`, and keep it out of anything CSS uppercases.
- **Don't** let a numeric `fontSize`, a `ctx.font` shorthand or a `letterSpacing` literal into `src/ui/*.tsx`; `type.test.ts` fails the build on all three.
- **Don't** hardcode a chrome dimension twice. Export it once and hand the same number to CSS and to the camera inset.

## Contested and settled

Two findings from the finish reviews were declined with reasons and withdrawn by the reviewer. Both are recorded because the reasoning, not the outcome, is what constrains future work.

**The lamp rendition's contrast.** The review quoted pre-correction numbers. The shipped values are `textDim` 4.59:1 and `phaseCoast` 3.05:1 on `panel`, asserted in `src/ui/theme.test.ts` rather than claimed in prose. The general principle survives the specific withdrawal: dimming illumination costs contrast that no amount of physical correctness returns, because WCAG's flare term is fixed, so the derived rendition is permitted exactly two hand corrections and both must be darkenings.

**The plate's field being cooler than the paper.** Withdrawn, and the reviewer's withdrawal is the useful part: *"temperature was never the finding on its own; it was the tell for atmosphere, because a cloud that fades into the stock at a different temperature can only be air."* The test for any future figure on this stock is therefore not "is it the same temperature as the paper" but "does it read as printed rather than as seen through air": bounded edge, ink weight, no falloff.

**Known divergences between the claim and the artifact.** Recorded here rather than smoothed over. The type scale is closed for the app chrome but not absolutely: the cover's lap time uses `fontSize: "clamp(46px, 8vw, 88px)"` with `letterSpacing: "-0.03em"` in `src/ui/Landing.tsx`, which is a display-size optical correction that `type.test.ts` permits by only matching numeric literals and non-negative trackings. It is used once, on one surface, and is **not** part of the scale. Separately, the weight ramp was enforced by convention rather than by the test: `TYPE.weight` declared three weights while `600` appeared as a literal at four sites, and `400` and `500` were re-typed rather than referenced at eighteen more. **That divergence was closed by writing this document**, which is the argument for recording the artifact rather than the intention: `type.test.ts` now fails on any numeric `fontWeight`, the four `600` sites fold to `bold`, and the ramp is three weights in fact as well as in claim. The `figure` step also has two treatments rather than one: `Stat size="lg"` sets it at weight `medium` with line-height 1.15, while the slider's own value sets the same size at weight `bold` with line-height 1.1 (`src/ui/primitives.tsx:303`). The frontmatter records the `Stat` treatment, which is the more common of the two. Finally, the display face is self-hosted but the numeric face is the platform mono stack, so the numbers, which carry most of the world, are drawn by whatever mono the reader's machine ships.
