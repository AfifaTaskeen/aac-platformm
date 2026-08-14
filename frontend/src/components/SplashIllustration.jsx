/*
 * SplashIllustration
 * ------------------
 * Original hand-drawn line-art scene: three friendly children standing
 * together on a grassy hill, waving, with little speech bubbles floating
 * above them. It says FRIENDSHIP + COMMUNICATION + TOGETHERNESS without
 * anyone needing to read a word.
 *
 * Drawing rules kept deliberately simple and consistent:
 *   - one ink colour for every outline (#2B2B3A)
 *   - one chunky stroke weight, rounded caps and joins, no sharp corners
 *   - flat colour fills, no gradients or shadows
 *   - faces are two dots and a curve -- friendly, and readable when small
 *
 * Note the <Child> component below: rather than copying the same 10 shapes
 * three times, the figure is written ONCE and then used three times with
 * different props. That is the core idea of React components.
 */

// The palette used by the artwork. Mirrors the tokens in src/index.css.
const INK = '#2B2B3A'

/*
 * One child figure.
 *   x     - horizontal centre of the figure inside the SVG canvas
 *   shirt - flat fill colour for the body
 *   skin  - flat fill colour for the head
 *   hair  - flat fill colour for the hair shape
 *   pose  - 'wave-right' | 'wave-left' | 'open'  (which way the arms go)
 */
function Child({ x, shirt, skin, hair, pose }) {
  // Each pose is just a different pair of arm lines.
  const arms = {
    'wave-right': [`M ${x - 32} 150 L ${x - 64} 182`, `M ${x + 32} 150 L ${x + 62} 118`],
    'wave-left': [`M ${x - 32} 150 L ${x - 62} 118`, `M ${x + 32} 150 L ${x + 64} 182`],
    open: [`M ${x - 32} 152 L ${x - 68} 172`, `M ${x + 32} 152 L ${x + 68} 172`],
  }[pose]

  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      {/* legs first, so the body overlaps them neatly */}
      <path d={`M ${x - 14} 200 L ${x - 17} 250`} stroke={INK} strokeWidth="9" fill="none" />
      <path d={`M ${x + 14} 200 L ${x + 17} 250`} stroke={INK} strokeWidth="9" fill="none" />

      {/* body */}
      <rect x={x - 32} y="130" width="64" height="76" rx="26" fill={shirt} stroke={INK} strokeWidth="7" />

      {/* arms */}
      <path d={arms[0]} stroke={INK} strokeWidth="9" fill="none" />
      <path d={arms[1]} stroke={INK} strokeWidth="9" fill="none" />

      {/* head */}
      <circle cx={x} cy="100" r="34" fill={skin} stroke={INK} strokeWidth="7" />

      {/* hair: a simple cap over the top of the head */}
      <path
        d={`M ${x - 33} 104 A 34 34 0 0 1 ${x + 33} 104 Q ${x + 16} 84 ${x} 88 Q ${x - 16} 84 ${x - 33} 104 Z`}
        fill={hair}
        stroke={INK}
        strokeWidth="6"
      />

      {/* face */}
      <circle cx={x - 12} cy="103" r="4.5" fill={INK} />
      <circle cx={x + 12} cy="103" r="4.5" fill={INK} />
      <path d={`M ${x - 12} 115 Q ${x} 126 ${x + 12} 115`} stroke={INK} strokeWidth="5" fill="none" />
    </g>
  )
}

/*
 * A small speech bubble with a tail.
 *   x, y     - top-left corner of the bubble
 *   tail     - 'left' or 'right', which way the little tail points
 *   children - whatever is drawn inside (a heart, dots, a star)
 */
function Bubble({ x, y, w, h, tail, children }) {
  const r = 22
  // The tail is inserted into the bottom edge of a rounded rectangle.
  const path =
    tail === 'right'
      ? `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + w - 34} L ${x + w - 6} ${y + h + 30} L ${x + w - 54} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
      : `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + 54} L ${x + 6} ${y + h + 30} L ${x + 34} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`

  return (
    <g>
      <path d={path} fill="#FFFFFF" stroke={INK} strokeWidth="6" strokeLinejoin="round" />
      {children}
    </g>
  )
}

function SplashIllustration({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 900 300"
      preserveAspectRatio="xMidYMax meet"
      /* The scene is decoration. The logo above it already carries the
         accessible name, so screen readers should skip this entirely. */
      aria-hidden="true"
      focusable="false"
    >
      {/* ---- grassy ground ---- */}
      <path d="M -20 246 Q 450 210 920 246 L 920 300 L -20 300 Z" fill="#7BC96F" />
      <path d="M -20 246 Q 450 210 920 246" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" />

      {/* ---- speech bubbles, floating above the children ---- */}
      {/* heart -- "I like you" */}
      <Bubble x={58} y={6} w={104} h={64} tail="right">
        <path
          d="M 110 52 C 88 38 84 22 96 18 C 104 15 110 22 110 26 C 110 22 116 15 124 18 C 136 22 132 38 110 52 Z"
          fill="#FFB3C1"
          stroke={INK}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </Bubble>

      {/* three dots -- "I have something to say" */}
      <Bubble x={512} y={0} w={104} h={60} tail="left">
        <circle cx="542" cy="30" r="7.5" fill={INK} />
        <circle cx="564" cy="30" r="7.5" fill={INK} />
        <circle cx="586" cy="30" r="7.5" fill={INK} />
      </Bubble>

      {/* star -- "that's great!" */}
      <Bubble x={742} y={14} w={100} h={62} tail="left">
        <path
          d="M 792 26 L 800 44 L 819 46 L 805 59 L 809 78 L 792 68 L 775 78 L 779 59 L 765 46 L 784 44 Z"
          fill="#FFC93F"
          stroke={INK}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      </Bubble>

      {/* ---- the three friends ---- */}
      <Child x={200} shirt="#FFC93F" skin="#F6C89A" hair="#4A3728" pose="wave-right" />
      <Child x={450} shirt="#5AA9E6" skin="#C68A5B" hair="#2B2B3A" pose="open" />
      <Child x={700} shirt="#FFB3C1" skin="#8D5A3B" hair="#7A4A2B" pose="wave-left" />
    </svg>
  )
}

export default SplashIllustration
