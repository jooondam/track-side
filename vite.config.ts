import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base is "/track-side/" only on Pages (jooondam.github.io/track-side/). Locally it has to be "/":
// with a base one path deep the dev server answers http://localhost:5173/ with a blank page and
// serves the app only at /track-side/, which made local preview look broken and left committing
// and pushing to Pages as the only apparent way to see a change.
//
// process is untyped without @types/node, so this reads the env through globalThis, the same route
// 818c97a established for CI flags.
const onPages = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.GITHUB_ACTIONS,
);

export default defineConfig({
  base: onPages ? "/track-side/" : "/",
  plugins: [react()],
});
