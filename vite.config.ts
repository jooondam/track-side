import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base matches the GitHub Pages project path (jooondam.github.io/track-side/)
export default defineConfig({
  base: "/track-side/",
  plugins: [react()],
});
