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
  /*
   * WHY THE SMALL SIZES SCALE HARDER THAN THE LARGE ONES
   * ----------------------------------------------------
   * `scale` is a RATIO, but what the eye reads as "coming forward" is the
   * change in ACTUAL PIXELS. Those are not the same thing, because the card
   * the ratio multiplies is a different size at every setting.
   *
   * The first version of this table ran the ratio the intuitive way -- small
   * cards, small scale -- which quietly made the problem worse. Measured on a
   * 1280x900 screen:
   *
   *     Very Small  177px card x 1.06  ->  grew  10.7px    barely visible
   *     Small       215px card x 1.07  ->  grew  15.0px    barely visible
   *     Medium      271px card x 1.09  ->  grew  24.3px    clear
   *     Large       364px card x 1.11  ->  grew  40.0px    clear
   *
   * A card growing by ten pixels does not read as coming forward; it reads as
   * nothing happening. The ratio has to move OPPOSITE the card size for the
   * pixel change to stay comparable, so the smaller settings scale hardest.
   *
   * The values below are set so every tier grows by roughly 26-30px, which is
   * the range Medium and Large already sit in and were the two sizes reported
   * as looking right. Medium and Large are therefore UNCHANGED -- they were
   * never the problem, and matching them is the entire goal.
   *
   * Growing more is safe here precisely because these cards are small: even
   * at 1.16, a Very Small card reaches only ~16% of the viewport width, well
   * under the ~30% a Large card has always reached. Headroom, not risk.
   *
   * `travel` is the fraction of the distance to the centre the card covers,
   * and stays modest on the packed layouts: a small grid puts many cards
   * close together, so a card crossing the whole board would sweep over a
   * dozen neighbours. It is nudged up just enough that the movement reads as
   * deliberate travel rather than a twitch, while the growth does the heavy
   * lifting.
   */
  /*
   * `anchor` holds the card near where it was TOUCHED. It is the difference
   * between "the card I pressed came forward" and "a card appeared in the
   * middle of the board", and it is why the packed grids needed their own
   * treatment rather than just a bigger number.
   *
   *   0     travel exactly as before (Medium and Large)
   *   0.75  keeps three quarters of the way back to the card's own position
   *
   * The scale is what carries the effect on these sizes, and it has to carry
   * MORE of it than the ratio alone suggests. Measured against Large, which
   * is the look these are matched to:
   *
   *     Large       scale 1.11, travels 485px  -> reads as dramatic
   *     Small       scale 1.30, travels  83px
   *     Very Small  scale 1.32, travels  60px
   *
   * Large's impact comes mostly from that 485px journey across the board, not
   * from its modest 1.11. The packed grids deliberately do not travel like
   * that -- anchoring them near the touch is what stops every card converging
   * on the middle -- so the growth has to make up the difference, and these
   * ratios are set well above Large's to do it.
   *
   * There is room for that. Even at 1.32 a Very Small card reaches about 16%
   * of the screen width, still half of the ~30% a Large card has always
   * occupied, and the tightest measured layout leaves headroom up to 2.89x
   * before anything would need clamping. Every value here is an UPPER BOUND
   * -- playCardPress() reduces it for any card whose enlarged rect would
   * leave the visible box, so an edge or corner card animates within whatever
   * room it actually has.
   */
  verysmall: { travel: 0.5, scale: 1.32, duration: 980, anchor: 0.78 },
  small: { travel: 0.55, scale: 1.3, duration: 1030, anchor: 0.72 },
  /* Unchanged -- these two already looked right. anchor 0 means the travel
     maths below reduces to exactly what it was before. */
  medium: { travel: 0.7, scale: 1.09, duration: 1100, anchor: 0 },
  large: { travel: 1, scale: 1.11, duration: 1200, anchor: 0 },
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
  if (area.classList.contains('cboard__cards--verysmall')) return STRENGTH.verysmall
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
 * `enabled` is the Animation setting, resolved by the caller (which also
 * folds in the operating system's reduced-motion preference). When false this
 * returns immediately having done nothing -- see the note at the top of the
 * body for why that is not the same as animating with duration 0.
 *
 * Returns a cancel function, so a component unmounting mid-flight can tidy up
 * rather than orphaning a clone on screen.
 */
export function playCardPress(cardEl, enabled = true) {
  if (!cardEl || typeof window === 'undefined') return () => {}

  /*
   * ANIMATION IS OFF: return before touching the DOM at all.
   *
   * Deliberately an early return rather than a zero-duration animation. The
   * work below hides the real card, appends a clone, and restores the card
   * when the clone finishes -- run with duration 0 that whole sequence still
   * happens, just too fast to follow, which is exactly how a one-frame
   * flicker is produced. Doing nothing produces nothing to see.
   *
   * Nothing communicative is skipped. onSelect(card) has already run in the
   * caller before this function is reached, so the word is in the sentence
   * and on its way to being spoken regardless of what happens here.
   *
   * A no-op cancel is returned so callers can store and call it unchanged --
   * the OFF path needs no special case anywhere else.
   */
  if (!enabled) return () => {}

  /* A second tap supersedes the first. */
  activeCancel?.()

  const area = cardEl.closest('.cboard__cards')
  const strength = strengthFor(area)
  const { travel, duration } = strength
  /* Reassigned below once the edge constraints are known. */
  let scale = strength.scale

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
  /* The box the enlarged card must stay inside. Set alongside the centre
     below, from the same measurement, so the two can never disagree. */
  let boundsLeft = 0
  let boundsTop = 0
  let boundsRight = window.innerWidth
  let boundsBottom = window.innerHeight

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

    /*
     * THE VISIBLE BOX.
     *
     * Intersected with the window, because the card area is WIDER than the
     * screen on some layouts -- measured at -145..1287 against a 1280 viewport
     * -- so trusting the area alone would permit a peak that is technically
     * inside the container but off the side of the screen.
     *
     * The vertical bounds come from the window rather than the area: the area
     * is a scroll container that continues past the bottom of the screen, and
     * the clone is fixed-position so only what the window shows matters.
     */
    boundsLeft = Math.max(visLeft, 0)
    boundsRight = Math.min(visRight, window.innerWidth)
    boundsTop = 0
    boundsBottom = window.innerHeight
  } else {
    centreX = window.innerWidth / 2
    centreY = window.innerHeight / 2
  }

  /* A little breathing room, so a constrained card stops just short of the
     edge rather than appearing glued to it. Proportional to the card, and
     capped so it never eats the whole margin on a small phone. */
  const margin = Math.min(12, cardRect.width * 0.06)
  boundsLeft += margin
  boundsTop += margin
  boundsRight -= margin
  boundsBottom -= margin

  const cardCentreX = cardRect.left + cardRect.width / 2
  const cardCentreY = cardRect.top + cardRect.height / 2

  /*
   * HOW FAR THE CARD TRAVELS -- and why the packed grids barely travel at all.
   *
   * `travel` is the fraction of the distance to the board centre the card
   * covers. On Medium and Large that reads well: there are few, large cards,
   * so a card crossing part of the board is unmistakably THAT card moving.
   *
   * On Small and Very Small it did not. Measured across a whole grid, cards
   * starting at x=98 and x=843 both peaked around x=315-718: a 745px spread of
   * starting positions collapsed into roughly 400px of peaks. Every card
   * converged on the middle, so what the eye saw was not "the card I touched
   * came forward" but "a card appeared in the centre" -- the movement
   * overwhelmed the zoom, and the connection to the tapped card was lost.
   *
   * `anchor` fixes that by holding the card near where it was touched. At 1
   * the card lifts in place and the growth alone carries the effect; at 0 it
   * behaves exactly as before. Medium and Large use 0 and are therefore
   * completely unchanged.
   */
  const anchor = strength.anchor || 0
  let dx = (centreX - cardCentreX) * travel * (1 - anchor)
  let dy = (centreY - cardCentreY) * travel * (1 - anchor)

  /*
   * EDGE AWARENESS.
   *
   * The peak is the enlarged card centred on wherever the translation puts
   * it. A card in the middle of the board has room on every side and is
   * unaffected by everything below. A card at an edge -- and especially a
   * corner, where both axes bind -- does not, so its peak is brought back
   * inside the visible box.
   *
   * TRANSLATION IS ADJUSTED FIRST, SCALE ONLY IF THAT IS NOT ENOUGH.
   * Sliding a card a few pixels inward is invisible; shrinking it is the
   * thing the child would actually notice, so it is the last resort rather
   * than the first move.
   */
  const availW = boundsRight - boundsLeft
  const availH = boundsBottom - boundsTop

  /*
   * The largest scale that can fit in the visible box at all, independent of
   * position. On a small phone in landscape the box can be shorter than a
   * grown card, and no amount of sliding fixes that.
   */
  const fitScale = Math.min(
    availW / cardRect.width,
    availH / cardRect.height,
    scale,
  )
  /* Never shrink below the real card: the effect may be reduced to nothing,
     but the card must never appear SMALLER than it is in the grid. */
  let finalScale = Math.max(1, fitScale)

  const peakW = cardRect.width * finalScale
  const peakH = cardRect.height * finalScale

  /* Where the peak would land, and how far outside the box that is. */
  const slide = (centre, half, lo, hi) => {
    if (centre - half < lo) return lo + half - centre
    if (centre + half > hi) return hi - half - centre
    return 0
  }
  dx += slide(cardCentreX + dx, peakW / 2, boundsLeft, boundsRight)
  dy += slide(cardCentreY + dy, peakH / 2, boundsTop, boundsBottom)

  /*
   * After sliding, the peak fits by construction whenever the card fits in
   * the box at all -- fitScale guaranteed that. This is a belt-and-braces
   * check for the pathological case (a box smaller than the un-scaled card,
   * e.g. an extremely short landscape window), where the honest answer is to
   * stop scaling rather than draw outside the screen.
   */
  const finalLeft = cardCentreX + dx - peakW / 2
  const finalTop = cardCentreY + dy - peakH / 2
  if (
    finalLeft < boundsLeft - 0.5 ||
    finalTop < boundsTop - 0.5 ||
    finalLeft + peakW > boundsRight + 0.5 ||
    finalTop + peakH > boundsBottom + 0.5
  ) {
    finalScale = 1
    dx = slide(cardCentreX, cardRect.width / 2, boundsLeft, boundsRight)
    dy = slide(cardCentreY, cardRect.height / 2, boundsTop, boundsBottom)
  }

  /* From here down, `scale` means the constrained value. */
  scale = finalScale

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
