// headless screenshots of the viewer, so a visual change can be reviewed without committing,
// pushing, and waiting for Pages.
//
//   npm run shots                  every frame in SHOTS
//   npm run shots -- spa           only frames whose name contains "spa"
//
// It drives the app entirely through the query string (src/ui/urlState.ts), so there is no test
// hook, no injected state and no privileged build: every frame it captures is a URL a person can
// open. That is the point of the URL state, not a side effect of it.
//
// Two things make this slower than it looks and both are unavoidable. Headless Chromium has no
// GPU, so WebGL runs on SwiftShader's software rasteriser; and the scene compiles its shaders on
// first draw, bakes a one-frame <Environment>, and streams the GLB through Suspense. The wait is
// therefore "ready flag, then a fixed number of animation frames", not a networkidle: networkidle
// fires while the terrain is still black.

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "shots");
const VIEWPORT = { width: 1600, height: 900 };
/** animation frames to let pass after the ready flag, before capturing. */
const SETTLE_FRAMES = 90;
/** how long to wait for the ready flag before giving up on a frame. */
const READY_TIMEOUT_MS = 60_000;

// [name, query, pins?]. Names are filenames, so keep them filesystem-safe.
//
// `pins` opens the rail and the dock. Those are hover-to-peek panels whose pinned state lives in
// localStorage (src/ui/useExpandable.ts), not in the URL, so a headless run with no pointer would
// otherwise only ever photograph them shut. Seeding the same key the app reads is honest: it is
// the state a user gets by clicking the pin, not a special mode.
const SHOTS = [
  ["spa-overview", "circuit=spa&view=overview&enter=1"],
  ["spa-eau-rouge", "circuit=spa&view=corner:Eau%20Rouge&enter=1"],
  ["spa-eau-rouge-bare", "circuit=spa&view=corner:Eau%20Rouge&enter=1&furniture=0"],
  ["spa-chase", "circuit=spa&view=chase&enter=1"],
  ["spa-plan", "circuit=spa&view=top&enter=1"],
  ["monza-overview", "circuit=monza&view=overview&enter=1"],
  ["monza-lesmo", "circuit=monza&view=corner:Lesmo%201&enter=1"],
  ["monza-rettifilo", "circuit=monza&view=corner:Variante%20del%20Rettifilo&enter=1"],
  ["monza-start", "circuit=monza&view=start&enter=1"],
  // the second rendition. It was `theme=light` here, which stopped photographing anything the
  // moment light became the default: this shot and `spa-overview` were the same frame.
  ["spa-overview-lamp", "circuit=spa&view=overview&enter=1&theme=dark"],
  ["spa-chase-lamp", "circuit=spa&view=chase&enter=1&theme=dark"],
  // the instruments, which only exist when the dock is open
  ["spa-telemetry", "circuit=spa&view=chase&enter=1", { dock: true, side: true }],
  ["spa-delta", "circuit=spa&view=chase&enter=1&mu=0.95&ghost=1", { dock: true }],
  ["spa-corners", "circuit=spa&view=overview&enter=1&mu=0.95&ghost=1", { dock: true, tab: "corners" }],
  // motion proof: the same frame with the shimmer on and off. `npm run shots -- motion` then
  // comparing the two "-a"/"-b" pairs is what turns "the animation is not working" into an
  // answer, instead of squinting at a still.
  ["motion-on-a", "circuit=spa&view=top&enter=1&motion=1&play=0"],
  ["motion-on-b", "circuit=spa&view=top&enter=1&motion=1&play=0", { extraFrames: 90 }],
  ["motion-off-a", "circuit=spa&view=top&enter=1&motion=0&play=0"],
  ["motion-off-b", "circuit=spa&view=top&enter=1&motion=0&play=0", { extraFrames: 90 }],
];

async function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

/** start `vite preview` and resolve once it is actually answering. */
async function startServer(port) {
  const child = spawn(
    "npx",
    ["vite", "preview", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (b) => process.stderr.write(`[vite] ${b}`));

  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview exited with ${child.exitCode}`);
    try {
      const r = await fetch(base);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`vite preview did not answer on ${base}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  return { child, base };
}

async function capture(page, base, name, query, pins = {}) {
  // seed the panel pins before any script runs, since useExpandable reads them during its first
  // render. Same localStorage keys the pin button writes.
  await page.addInitScript((p) => {
    try {
      localStorage.setItem("track-side:pin:dock", p.dock ? "1" : "0");
      localStorage.setItem("track-side:pin:side", p.side ? "1" : "0");
    } catch {
      /* storage unavailable: the shot is just taken with the panels shut */
    }
  }, pins);

  await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => window.__trackSideReady === true, null, {
    timeout: READY_TIMEOUT_MS,
  });

  // the corner report lives behind a tab that has no URL state, because it is a view of the dock
  // rather than a view of the circuit. Clicking it is what a person would do.
  if (pins.tab === "corners") {
    await page.getByRole("button", { name: "corners" }).click();
  }

  // let the GLB, the environment bake and the shader compiles land. Counting real animation
  // frames rather than sleeping means this tracks how slow the software rasteriser actually is
  // on this machine instead of guessing.
  await page.evaluate(
    (frames) =>
      new Promise((done) => {
        let left = frames;
        const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    SETTLE_FRAMES + (pins.extraFrames ?? 0),
  );

  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function main() {
  const filter = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const wanted = filter.length
    ? SHOTS.filter(([name]) => filter.some((f) => name.includes(f)))
    : SHOTS;
  if (!wanted.length) {
    console.error(`no shots match ${filter.join(", ")}. Known: ${SHOTS.map((s) => s[0]).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const { child, base } = await startServer(await freePort());
  // `channel: "chromium"` is load-bearing, not a preference. Playwright's default headless is the
  // old headless shell, and it composites this canvas wrong: the presented frame drops the top
  // `insets.bottom` rows of the drawing buffer, so with the dock open the upper half of the circuit
  // is missing and the corner labels hang over blank sheet. The WebGL buffer itself is correct
  // there (readPixels on the same frame returns the road at those rows, and a headed browser
  // screenshots it intact), so it is a capture artifact, and every frame this harness produced
  // before this line was lying about the product. The new headless mode composites it correctly.
  // Needs `npx playwright install chromium`.
  const browser = await chromium.launch({ channel: "chromium" });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  // surface page errors: a shader that fails to compile renders a black frame and otherwise
  // says nothing at all, which is the single most likely way this script lies to you
  page.on("pageerror", (e) => console.error(`  ! page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  ! console: ${m.text()}`);
  });

  try {
    for (const [name, query, pins] of wanted) {
      const t0 = Date.now();
      try {
        const file = await capture(page, base, name, query, pins);
        console.log(`${name}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${file}`);
      } catch (err) {
        console.error(`${name}  FAILED: ${err.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
    child.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
