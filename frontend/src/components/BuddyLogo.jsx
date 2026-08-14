/*
 * BuddyLogo
 * ---------
 * The Buddy Talk mark: a speech bubble that is also a smiling face,
 * with a smaller bubble answering it.
 *   - big coral bubble  = "Buddy" (the friend)
 *   - small teal bubble = the child answering
 * The two tails point away from each other, so it reads as two speakers
 * having a conversation rather than one bubble with a face in it.
 *
 * It is drawn as an inline SVG (not a .png) so that it stays perfectly sharp
 * at any size, weighs almost nothing, and can be animated with plain CSS.
 *
 * Colours are written as literal hex values on purpose. They match the tokens
 * in src/index.css -- see the palette table there. Artwork colours are kept
 * inside the artwork so the drawing is readable on its own.
 */

function BuddyLogo({ className = '', title = 'Buddy Talk' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 128 128"
      role="img"
      aria-label={title}
    >
      {/* small teal bubble -- the reply. The class lets CSS give it a slow drift. */}
      <path
        className="logo__bubble-small"
        d="M87 6 H105 A15 15 0 0 1 120 21 V29 A15 15 0 0 1 105 44 H102 L116 62 L90 44 H87 A15 15 0 0 1 72 29 V21 A15 15 0 0 1 87 6 Z"
        fill="#1FA8A0"
        stroke="#2B2B3A"
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* big coral bubble -- the buddy */}
      <path
        d="M34 30 H78 A26 26 0 0 1 104 56 V80 A26 26 0 0 1 78 106 H62 L40 124 L46 106 H34 A26 26 0 0 1 8 80 V56 A26 26 0 0 1 34 30 Z"
        fill="#FF6F5E"
        stroke="#2B2B3A"
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* face: two dots and a curve is all it takes to read as friendly,
          and it survives being shrunk down to an app icon */}
      <circle cx="40" cy="64" r="5.5" fill="#2B2B3A" />
      <circle cx="66" cy="64" r="5.5" fill="#2B2B3A" />
      <path
        d="M38 82 Q53 96 68 82"
        fill="none"
        stroke="#2B2B3A"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default BuddyLogo
