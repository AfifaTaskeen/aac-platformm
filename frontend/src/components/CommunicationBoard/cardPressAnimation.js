/*
 * cardPressAnimation.js
 * ---------------------
 * The "come forward" animation played when a child taps a card.
 *
 * The card appears to leave the grid, travel to the middle of the visible
 * board, grow, hold there a moment, then travel back and settle exactly where
 * it started.
 *
 * NOTHING IN THE GRID MOVES.
 *
 * That is the whole design. The thing that travels is a CLONE of the tapped
 * card, appended to <body> and positioned with `position: fixed`. The real
 * card never receives a transform, never changes size, and never leaves its
 * grid cell.
 *
 * WHY A CLONE RATHER THAN MOVING THE CARD
 * ---------------------------------------
 * Two problems make moving the real card unworkable, and both were hit in
 * earlier attempts:
 *
 *   1. REFLOW. A grid item that grows or shifts pushes its neighbours and
 *      changes row heights. Transforms avoid that, but only until the second
 *      problem.
 *
 *   2. CLIPPING. The card area is a scroll container (`overflow-y: auto`),
 *      so anything crossing its bounds is cut off. The obvious fix --
 *      switching it to `overflow: visible` while a card travels -- is what
 *      caused the board to jump to the top on every tap: an element that
 *      stops being scrollable DISCARDS its scrollTop, so the view snapped
 *      back to row one whenever a child had scrolled down.
 *
 * A fixed-position clone on top of the page has neither problem. It is not a
 * grid item, so there is nothing to reflow. It is not a descendant of the
 * scroll container, so nothing clips it and there is never a reason to touch
 * overflow or scrollTop at all.
 *
 * WHY cloneNode RATHER THAN RE-RENDERING THE CARD
 * -----------------------------------------------
 * The clone must look EXACTLY like the card -- same image, word, tint,
 * border, radius, typography, theme, padding. Rebuilding that in a second
 * component would duplicate the markup and drift the moment either copy
 * changed. cloneNode(true) copies the element as it currently is, so the two
 * cannot disagree, and the effect reads as the card itself coming forward.
 */

/*
 * How far through the animation each phase sits, and how the card behaves.
 * Expressed as fractions of the total duration so a change to the duration
 * rescales every phase together.
 */
const TRAVEL_OUT = 0.34 /* moving to the centre, growing */
const HOLD_UNTIL = 0.58 /* sitting at the centre */

/*
 * Per-grid-size strength.
 *
 * `travel` is the FRACTION of the distance to the centre the card covers. A
 * small grid packs many cards close together, so a card crossing the whole
 * board would sweep over a dozen neighbours; it moves part of the way and
 * relies more on growth. A large grid has few, big cards and much more space,
 * so the full journey reads clearly.
 *
 * These are read from the grid-size class on the card area, so the setting
 * the caregiver chose is what selects them.
 */
const STRENGTH = {
  small: { travel: 0.45, scale: 1.07, duration: 1000 },
  medium: { travel: 0.7, scale: 1.09, duration: 1100 },
  large: { travel: 1, scale: 1.11, duration: 1200 },
}

/* Only one card animates at a time. Tapping a second card cancels the first
   cleanly rather than leaving two clones on screen. */
let activeCancel = null

/*
 * Which strength to use, taken from the class the board puts on the card
 * area. Medium is the default, matching the board's own default.
 */
function strengthFor(area) {
  if (!area) return STRENGTH.medium
  if (area.classList.contains('cboard__cards--small')) return STRENGTH.small
  if (area.classList.contains('cboard__cards--large')) return STRENGTH.large
  return STRENGTH.medium
}

/*
 * Plays the animation for one card.
 *
 * `cardEl` is the REAL card element, used only to measure and to copy. It is
 * never modified beyond being briefly made invisible (see below), and it
 * keeps its layout space throughout.
 *
 * Returns a cancel function, so a component unmounting mid-flight can tidy up
 * rather than orphaning a clone on screen.
 */
export function playCardPress(cardEl) {
  if (!cardEl || typeof window === 'undefined') return () => {}

  /* A second tap supersedes the first. */
  activeCancel?.()

  const area = cardEl.closest('.cboard__cards')
  const { travel, scale, duration } = strengthFor(area)

  /*
   * MEASURED AT THE MOMENT OF THE TAP.
   *
   * getBoundingClientRect() reports viewport coordinates of the element as it
   * is right now -- after any scrolling, at the current column count, on
   * whatever screen. So the start position is always this card's true
   * position, and there is no row arithmetic, no stored offset, and nothing
   * reused from a previous tap anywhere in this function.
   */
  const cardRect = cardEl.getBoundingClientRect()

  /*
   * THE DESTINATION: the centre of what is CURRENTLY VISIBLE.
   *
   * Also from getBoundingClientRect(), so it is the visible box wherever the
   * page happens to be scrolled -- not the document centre, not the grid's
   * full height, and never a fixed coordinate.
   *
   * The area's own padding is excluded. The card area carries a large
   * horizontal padding purely to give room at its edges, and including it
   * would pull the computed centre sideways.
   *
   * If the board cannot be found for any reason, the viewport itself is a
   * sane fallback rather than a crash.
   */
  let centreX
  let centreY

  if (area) {
    const areaRect = area.getBoundingClientRect()
    const cs = getComputedStyle(area)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const padT = parseFloat(cs.paddingTop) || 0
    const padB = parseFloat(cs.paddingBottom) || 0

    /* Clamped to the window, so if the board extends past the bottom of the
       screen the target is still somewhere the child can actually see. */
    const visTop = Math.max(areaRect.top + padT, 0)
    const visBottom = Math.min(areaRect.bottom - padB, window.innerHeight)
    const visLeft = Math.max(areaRect.left + padL, 0)
    const visRight = Math.min(areaRect.right - padR, window.innerWidth)

    centreX = (visLeft + visRight) / 2
    centreY = (visTop + visBottom) / 2
  } else {
    centreX = window.innerWidth / 2
    centreY = window.innerHeight / 2
  }

  const cardCentreX = cardRect.left + cardRect.width / 2
  const cardCentreY = cardRect.top + cardRect.height / 2

  /* The actual distance this particular card must cover, scaled by the
     grid-size strength. A card already near the middle barely moves, which
     falls out of the measurement rather than being special-cased. */
  const dx = (centreX - cardCentreX) * travel
  const dy = (centreY - cardCentreY) * travel

  /* ---- Build the clone ---- */
  const clone = cardEl.cloneNode(true)

  /*
   * Pinned to the card's exact current screen box. `fixed` matches the
   * coordinate system getBoundingClientRect() reports in, so no scroll
   * offsets have to be added and the clone cannot be clipped by any ancestor.
   */
  clone.style.position = 'fixed'
  clone.style.left = `${cardRect.left}px`
  clone.style.top = `${cardRect.top}px`
  clone.style.width = `${cardRect.width}px`
  clone.style.height = `${cardRect.height}px`
  clone.style.margin = '0'
  clone.style.zIndex = '900'
  /* Above the board, below the settings panel and dialogs. */
  clone.style.pointerEvents = 'none'
  clone.style.transformOrigin = 'center center'
  clone.style.willChange = 'transform'
  /* A clone is decoration; a screen reader has already announced the real
     card, and announcing it twice would be noise. */
  clone.setAttribute('aria-hidden', 'true')
  clone.tabIndex = -1

  document.body.appendChild(clone)

  /*
   * The real card is hidden WHILE KEEPING ITS LAYOUT SPACE, so the effect
   * reads as the card itself lifting out of the grid rather than a duplicate
   * appearing beside it. `visibility` is the right tool: unlike `display` it
   * does not remove the element from layout, so the grid is untouched.
   */
  cardEl.style.visibility = 'hidden'

  let finished = false

  function cleanUp() {
    if (finished) return
    finished = true

    clone.remove()
    /* Restores the stylesheet's own value rather than forcing `visible`. */
    cardEl.style.visibility = ''

    if (activeCancel === cancel) activeCancel = null
  }

  function cancel() {
    animation?.cancel()
    cleanUp()
  }

  activeCancel = cancel

  /*
   * The keyframes.
   *
   * Built here rather than in CSS because the distance is different for every
   * card and only known at tap time. The Web Animations API takes the same
   * shape a @keyframes block would, and gives a real `finished` promise plus
   * a `cancel()` that removes every trace -- which is what makes repeated
   * taps safe.
   *
   * Only `transform` and `box-shadow` are animated. Neither takes part in
   * layout, so even though this element is fixed-position it cannot cause a
   * reflow or a repaint of the page beneath it.
   */
  const animation = clone.animate(
    [
      {
        offset: 0,
        transform: 'translate(0px, 0px) scale(1)',
        boxShadow: '0 6px 0 rgba(43, 43, 58, 0.16)',
        easing: 'cubic-bezier(0.32, 0, 0.35, 1)',
      },
      /* A third of the way across, already growing -- the motion is legible
         from the very start rather than snapping into it. */
      {
        offset: TRAVEL_OUT * 0.45,
        transform: `translate(${dx * 0.42}px, ${dy * 0.42}px) scale(${1 + (scale - 1) * 0.45})`,
        boxShadow: '0 12px 22px rgba(43, 43, 58, 0.24)',
        easing: 'cubic-bezier(0.25, 0.5, 0.3, 1)',
      },
      /* Arrived at the centre, at full size, decelerating into the stop. */
      {
        offset: TRAVEL_OUT,
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        boxShadow: '0 22px 42px rgba(43, 43, 58, 0.34)',
        easing: 'linear',
      },
      /* The hold: ~26% of the duration sitting still, so the child has time
         to see WHICH card responded. */
      {
        offset: HOLD_UNTIL,
        transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
        boxShadow: '0 22px 42px rgba(43, 43, 58, 0.34)',
        easing: 'cubic-bezier(0.4, 0, 0.3, 1)',
      },
      /* On the way home, shrinking as it goes. */
      {
        offset: HOLD_UNTIL + (1 - HOLD_UNTIL) * 0.55,
        transform: `translate(${dx * 0.38}px, ${dy * 0.38}px) scale(${1 + (scale - 1) * 0.4})`,
        boxShadow: '0 12px 22px rgba(43, 43, 58, 0.24)',
        easing: 'cubic-bezier(0.3, 0, 0.25, 1)',
      },
      /* Exactly back: zero translation, scale 1, the original shadow. The
         clone is then removed, and the real card -- which never moved -- is
         made visible again in precisely the place it always occupied. */
      {
        offset: 1,
        transform: 'translate(0px, 0px) scale(1)',
        boxShadow: '0 6px 0 rgba(43, 43, 58, 0.16)',
      },
    ],
    { duration, fill: 'both' },
  )

  animation.finished.then(cleanUp).catch(() => {
    /* A cancelled animation rejects; cleanUp has already run in that case. */
  })

  return cancel
}
