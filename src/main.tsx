// The display face, self-hosted rather than named and hoped for. theme.ts has asked for Archivo
// since the run-plan world was built, but nothing ever loaded it, so every headline and every
// label in the interface has been the platform sans: an own-world voice that was never actually
// spoken. --font-display is set on html, body and #root, so this is the whole interface, not a
// headline treatment.
//
// wght.css only: the weight axis, upright, no italic and no width axis. The three subsets it
// declares are gated by unicode-range, so a latin page pays for one 35 kB file. font-display is
// swap, so the fallback paints first and the sheet is never blank while the font arrives.
//
// SIL Open Font License 1.1. See README for the attribution the licence asks for.
import "@fontsource-variable/archivo/wght.css";

import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
