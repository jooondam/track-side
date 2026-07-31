// hover-to-peek panels, done so they are not a trap.
//
// Hover alone would lock out keyboard and touch users, so hover is only one of four routes in:
// pointer hover (with an intent delay, so crossing the panel on the way somewhere else does not
// fire it), keyboard focus (immediate, and held while focus stays inside), an explicit pin, and
// a hold flag the caller raises while a drag is in progress. Coarse pointers skip hover entirely
// and start pinned, because "hover" on a touchscreen means "tap and hope".

import { useCallback, useEffect, useRef, useState } from "react";

const ENTER_DELAY_MS = 120;
const LEAVE_DELAY_MS = 400;

function coarsePointer(): boolean {
  return window.matchMedia?.("(hover: none)").matches ?? false;
}

export interface Expandable {
  expanded: boolean;
  pinned: boolean;
  togglePin: () => void;
  /** raise while dragging a control inside the panel so it cannot collapse mid-gesture */
  setHold: (held: boolean) => void;
  handlers: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
    onFocusCapture: () => void;
    onBlurCapture: (e: React.FocusEvent) => void;
  };
}

export function useExpandable(storageKey: string): Expandable {
  const [pinned, setPinned] = useState(() => {
    const stored = localStorage.getItem(`track-side:pin:${storageKey}`);
    if (stored === "1") return true;
    if (stored === "0") return false;
    return coarsePointer(); // touch defaults to open, pointer defaults to peek
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [held, setHeld] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    localStorage.setItem(`track-side:pin:${storageKey}`, pinned ? "1" : "0");
  }, [pinned, storageKey]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onPointerEnter = useCallback(() => {
    if (coarsePointer()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHovered(true), ENTER_DELAY_MS);
  }, []);

  const onPointerLeave = useCallback(() => {
    if (coarsePointer()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHovered(false), LEAVE_DELAY_MS);
  }, []);

  const onFocusCapture = useCallback(() => setFocused(true), []);

  // relatedTarget is where focus is going: staying inside the panel must not collapse it
  const onBlurCapture = useCallback((e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setFocused(false);
  }, []);

  return {
    expanded: pinned || hovered || focused || held,
    pinned,
    togglePin: () => setPinned((p) => !p),
    setHold: setHeld,
    handlers: { onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture },
  };
}
