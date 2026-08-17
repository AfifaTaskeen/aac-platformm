import { useState, useRef, useEffect } from 'react'
import { categoryColors, CORE_COLORS } from '../cardData'

/*
 * CommunicationCard.jsx
 * ---------------------
 * One tappable card: a picture with its word underneath, or -- for a core
 * word like "Want" -- just the word, large and clear.
 *
 * Props:
 *   card         - an entry from cardData.js
 *   onSelect     - called with the card AFTER its animation finishes
 *   isCore       - render in the core-word style (no picture)
 *   onPopChange  - told true while this card is flying, false when it lands,
 *                  so the board can un-clip the card area for the duration
 */
function CommunicationCard({ card, onSelect, isCore = false, onPopChange }) {
  /*
   * Drives the pop animation. It is state rather than a CSS :active rule
   * because the card must finish coming forward and settling back even if
   * the finger lifts immediately -- :active would cut that short.
   */
  const [isTapped, setIsTapped] = useState(false)

  /* If a picture is missing or fails to load, fall back to a word-only card
     rather than showing a broken-image icon to a child. */
  const [imageFailed, setImageFailed] = useState(false)

  /* Backs up the animationend event -- see handleClick. */
  const fallbackRef = useRef(null)

  /*
   * The card element, so the tap can measure where it sits.
   *
   * The travel distance is different for every card -- a corner card has far
   * further to go than a middle one -- so it cannot be written into a static
   * CSS keyframe. It is measured at tap time and handed to the animation as
   * two custom properties.
   */
  const buttonRef = useRef(null)

  /* The measured offset, applied as --dx / --dy while the card animates. */
  const [travel, setTravel] = useState({ dx: '0px', dy: '0px' })

  /* Clears a pending timer if the card unmounts mid-animation, e.g. because
     the user navigated out of the folder. */
  useEffect(() => {
    return () => clearTimeout(fallbackRef.current)
  }, [])

  /*
   * True between the tap and the moment the word is added. A ref, not state,
   * because it guards a side effect and must be read and written
   * synchronously -- a state update would not be visible to a second caller
   * in the same tick.
   */
  const isRunningRef = useRef(false)

  /*
   * Ends the tap: the card returns to normal and ONLY THEN does the word go
   * into the sentence.
   *
   * Called by whichever comes first -- the animation finishing, or the
   * fallback timer. The ref makes the second caller a no-op, so the word can
   * never be added twice.
   */
  function finish() {
    if (!isRunningRef.current) return
    isRunningRef.current = false
    clearTimeout(fallbackRef.current)
    setIsTapped(false)
    onPopChange?.(false)
    onSelect(card)
  }

  /*
   * Starts the animation. The word is NOT added here.
   *
   * Guarded against a second tap while one is already running: without this
   * a fast double-tap would restart the animation and fire onSelect twice.
   */
  /*
   * Works out how far this card must travel to sit in the middle of the card
   * area, measured from centre to centre.
   *
   * getBoundingClientRect() is used deliberately: it reports the position as
   * actually rendered, so this stays correct at any screen size, column
   * count or scroll position without duplicating the layout arithmetic.
   *
   * The board area is the nearest scrolling ancestor -- the region the cards
   * live in -- so a card centres within the CARDS, not the whole window,
   * which would sit under the sidebar and top bar.
   */
  function measureTravel() {
    const el = buttonRef.current
    if (!el) return { dx: '0px', dy: '0px' }

    const area = el.closest('.cboard__cards')
    if (!area) return { dx: '0px', dy: '0px' }

    const cardBox = el.getBoundingClientRect()
    const areaBox = area.getBoundingClientRect()

    const cardCentreX = cardBox.left + cardBox.width / 2
    const cardCentreY = cardBox.top + cardBox.height / 2
    const areaCentreX = areaBox.left + areaBox.width / 2
    const areaCentreY = areaBox.top + areaBox.height / 2

    return {
      dx: `${Math.round(areaCentreX - cardCentreX)}px`,
      dy: `${Math.round(areaCentreY - cardCentreY)}px`,
    }
  }

  function handleClick() {
    // Ignore taps while one is already playing, so a fast double-tap cannot
    // restart the animation or add the word twice.
    if (isRunningRef.current) return

    // Measure BEFORE the class is applied, so the reading is of the card at
    // rest rather than mid-transform.
    setTravel(measureTravel())

    isRunningRef.current = true
    setIsTapped(true)
    // Lets the board un-clip the card area while this card is out of place.
    onPopChange?.(true)

    /*
     * Safety net. animationend normally does the work, but it does not fire
     * if the element is hidden or the tab is backgrounded mid-tap, and the
     * card would then stay stuck and never add its word. This fires well
     * comfortably after the 1000ms animation, and finish() makes whichever
     * arrives second a no-op.
     */
    clearTimeout(fallbackRef.current)
    fallbackRef.current = setTimeout(finish, 1450)
  }

  /*
   * Fired by the browser when the pop animation actually finishes.
   *
   * This is the whole point of the sequence: the card comes forward, returns
   * to its exact original state, and ONLY THEN does the word appear in the
   * sentence bar. Using the real animationend event rather than a matching
   * setTimeout means the two can never drift apart -- change the duration in
   * the CSS and this still fires at the right moment.
   *
   * The name check matters: any other animation on a child element bubbles
   * up here too, and would otherwise select the card early.
   *
   * Two names are accepted. `ccard-pop-still` is the motion-free version
   * used under prefers-reduced-motion -- it exists precisely so this event
   * still fires for a child who has motion turned off, who would otherwise
   * never be able to add a word.
   */
  function handleAnimationEnd(event) {
    if (event.animationName !== 'ccard-pop' && event.animationName !== 'ccard-pop-still') {
      return
    }
    finish()
  }

  const showImage = Boolean(card.image) && !imageFailed

  /*
   * The card's pastel comes from its category, so every Food card shares one
   * colour and a child can tell groups apart at a glance. Core words have no
   * category colour and keep the warm cream from the stylesheet.
   *
   * Two custom properties are set, and the CSS decides which to use: --tint
   * normally, --deep while pressed. Doing it this way keeps the press logic
   * in one CSS rule instead of branching here.
   */
  const colors = isCore ? CORE_COLORS : categoryColors(card.category)
  /*
   * --dx / --dy are the measured distance to the centre of the card area.
   * They are only read by the animation, so they cost nothing at rest.
   */
  const style = {
    ...(colors ? { '--tint': colors.tint, '--deep': colors.deep } : null),
    '--dx': travel.dx,
    '--dy': travel.dy,
  }

  return (
    <button
      type="button"
      className={[
        'ccard',
        isCore ? 'ccard--core' : '',
        colors ? 'ccard--tinted' : '',
        !showImage && !isCore ? 'ccard--noimage' : '',
        isTapped ? 'ccard--tapped' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={buttonRef}
      style={style}
      onClick={handleClick}
      onAnimationEnd={handleAnimationEnd}
      /* The visible label is the whole meaning of the card, so it is also
         exactly what a screen reader should announce. */
      aria-label={card.label}
    >
      {showImage && (
        <span className="ccard__imagebox">
          <img
            className="ccard__image"
            src={card.image}
            /* The label sits right below in text, so repeating it here would
               make a screen reader say the word twice. */
            alt=""
            onError={() => setImageFailed(true)}
            /* Pictures below the fold are only fetched when scrolled to. */
            loading="lazy"
            draggable="false"
          />
        </span>
      )}

      {/* The photo failed to load: show the emoji so the card is still
          recognisable at a glance instead of becoming word-only. */}
      {!showImage && card.emoji && (
        <span className="ccard__imagebox ccard__imagebox--emoji">
          <span className="ccard__emoji" aria-hidden="true">
            {card.emoji}
          </span>
        </span>
      )}

      <span className="ccard__label">{card.label}</span>
    </button>
  )
}

export default CommunicationCard
