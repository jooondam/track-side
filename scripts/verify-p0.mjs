// one-off verification for the two P0 fixes: the camera composing for the unoccluded rectangle,
// and the error path. Captures the exact configurations the critique found broken, at the exact
// viewports it found them at, plus the error card that used to print a JSON parser message.
//
//   node scripts/verify-p0.mjs      (expects `npm run build` to have run)

import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "shots-p0");
const SETTLE_FRAMES = 90;
const READY_TIMEOUT_MS = 60_000;

// [name, viewport, query, pins, opts]
const CASES = [
  ["desktop-both-pinned", { width: 1600, height: 900 }, "circuit=spa&view=overview&enter=1", { dock: true, side: true }],
  ["desktop-at-rest", { width: 1600, height: 900 }, "circuit=spa&view=overview&enter=1", {}],
  ["laptop-both-pinned", { width: 1440, height: 900 }, "circuit=spa&view=overview&enter=1", { dock: true, side: true }],
  ["small-both-pinned", { width: 1024, height: 700 }, "circuit=spa&view=overview&enter=1", { dock: true, side: true }],
  ["plan-both-pinned", { width: 1440, height: 900 }, "circuit=spa&view=top&enter=1", { dock: true, side: true }],
  ["chase-both-pinned", { width: 1440, height: 900 }, "circuit=spa&view=chase&enter=1", { dock: true, side: true }],
  ["mobile-dock", { width: 390, height: 844 }, "circuit=spa&view=overview&enter=1", { dock: true }],
  // the error path: a circuit that does not exist. The dev/preview server answers with
  // index.html at 200, which is exactly the case that used to surface as a parser message.
  ["error-no-such-circuit", { width: 1440, height: 900 }, "circuit=nope&enter=1", {}, { expectError: true }],
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

async function main() {
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

  try {
    for (const [name, viewport, query, pins, opts = {}] of CASES) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });

      await page.addInitScript((p) => {
        try {
          localStorage.setItem("track-side:pin:dock", p.dock ? "1" : "0");
          localStorage.setItem("track-side:pin:side", p.side ? "1" : "0");
        } catch {
          /* storage unavailable */
        }
      }, pins);

      await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded" });

      if (opts.expectError) {
        // the error card is an alert, so waiting on the role proves the state rendered rather
        // than that some pixels appeared
        await page.getByRole("alert").waitFor({ timeout: 20_000 });
        const heading = await page.getByRole("heading").first().textContent();
        const body = await page.locator("[role=alert] p").first().textContent();
        const hasPicker = await page.getByLabel("Circuit").count();
        const hasRetry = await page.getByRole("button", { name: /try again/i }).count();
        const summary = await page.locator("summary").first().textContent().catch(() => null);
        console.log(`  heading:  ${heading}`);
        console.log(`  body:     ${body}`);
        console.log(`  picker:   ${hasPicker > 0}`);
        console.log(`  retry:    ${hasRetry > 0}`);
        console.log(`  details:  ${summary}`);
      } else {
        await page.waitForFunction(() => window.__trackSideReady === true, null, {
          timeout: READY_TIMEOUT_MS,
        });
        await page.evaluate(
          (frames) =>
            new Promise((done) => {
              let left = frames;
              const tick = () => (left-- > 0 ? requestAnimationFrame(tick) : done());
              requestAnimationFrame(tick);
            }),
          SETTLE_FRAMES,
        );
      }

      const file = resolve(OUT, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`${name}  ${viewport.width}x${viewport.height}  ${file}${errors.length ? `  ERRORS: ${errors.join(" | ")}` : ""}`);
      await page.close();
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
