// drawn marks, not borrowed letterforms.
//
// Every icon in this interface used to be a unicode glyph: a black-square play triangle, a
// fisheye for a pinned panel, a trigram for the menu. They are convenient and they are wrong.
// A glyph is a character, so it inherits the text face and is drawn by whatever font on the
// reader's machine happens to carry that codepoint. Its size, weight and baseline are decided by
// a type designer solving a different problem, they land differently on every platform, and two
// of them side by side never optically match. The pin and the play mark here were noticeably
// different weights for exactly that reason.
//
// These are drawn on a 16-unit grid to the same rules as the rest of the world: flat fills, no
// rounded joins, no optical rounding. The strokes are 1.5 units, which lands on a whole pixel at
// the sizes the chrome actually uses.
//
// They carry no accessible name. Every one of them sits inside a control that already has one
// (IconButton takes a label), and a second name there would be read twice.

export type IconName =
  | "menu"
  | "mark"
  | "sun"
  | "moon"
  | "help"
  | "pinned"
  | "unpinned"
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "up"
  | "down"
  | "flat"
  | "caret";

const STROKE = { stroke: "currentColor", strokeWidth: 1.5, fill: "none" } as const;

const PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <g {...STROKE}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </g>
  ),
  // the brand mark: a lozenge, the shape a corner apex is marked with on a circuit map
  mark: <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" />,
  sun: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.75M8 13.25V15M1 8h1.75M13.25 8H15M3.05 3.05l1.24 1.24M11.71 11.71l1.24 1.24M12.95 3.05l-1.24 1.24M4.29 11.71l-1.24 1.24" />
    </g>
  ),
  // a work lamp's crescent, cut rather than drawn: two circles, one subtracting the other
  moon: <path d="M11.4 10.9A5.5 5.5 0 0 1 6.1 3.1a5.5 5.5 0 1 0 5.3 7.8Z" fill="currentColor" />,
  help: (
    <g {...STROKE}>
      <path d="M5.6 5.8a2.4 2.4 0 1 1 2.9 2.4v1.6" />
      <path d="M8.5 12.4h.01" strokeWidth={2} strokeLinecap="square" />
    </g>
  ),
  // pinned reads as filled, unpinned as an outline: the same mark in two states, so the change
  // is a fill rather than a different shape to relearn
  pinned: (
    <g>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="8" cy="8" r="2.75" fill="currentColor" />
    </g>
  ),
  unpinned: <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth={1.5} />,
  play: <path d="M4.5 2.5 13 8l-8.5 5.5Z" fill="currentColor" />,
  pause: (
    <g fill="currentColor">
      <rect x="4" y="2.75" width="2.75" height="10.5" />
      <rect x="9.25" y="2.75" width="2.75" height="10.5" />
    </g>
  ),
  prev: (
    <g {...STROKE}>
      <path d="M10 2.75 4.5 8l5.5 5.25" />
    </g>
  ),
  next: (
    <g {...STROKE}>
      <path d="M6 2.75 11.5 8 6 13.25" />
    </g>
  ),
  up: <path d="M8 3.5 13.5 12h-11Z" fill="currentColor" />,
  down: <path d="M8 12.5 2.5 4h11Z" fill="currentColor" />,
  flat: <rect x="2.5" y="7.25" width="11" height="1.5" fill="currentColor" />,
  // the select's own mark. A caret, not the filled triangle the platform draws, because the
  // field it sits in is a ruled box rather than a button.
  caret: (
    <g {...STROKE}>
      <path d="M3.5 6.25 8 10.5l4.5-4.25" />
    </g>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      // the marks are geometric and the world has no rounded corners anywhere else either
      style={{ display: "block", shapeRendering: "geometricPrecision", flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
