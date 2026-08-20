import { useState, useRef, useEffect } from 'react'
import { categoryColors, CORE_COLORS } from '../cardData'
import { playCardPress } from '../cardPressAnimation'

/*
 * CommunicationCard.jsx
 * ---------------------
 * One tappable card: a picture with its word underneath, or -- for a core
 * word like "Want" -- just the word, large and clear.
 *
 * THE PRESS ANIMATION IS NOT HERE.
 *
 * Tapping a card runs a "come forward" animation: the card appears to leave
 * the grid, travel to the middle of the visible board, grow, hold, and return.
 * None of that happens to this element. It is performed by a temporary CLONE
 * rendered outside the grid -- see cardPressAnimation.js -- because the real
 * card must never move:
 *
 *   - moving a grid item would reflow the grid and shift its neighbours
 *   - the card area is a scroll container that clips its children, so a card
 *     travelling across it would be cut off; the previous attempt to avoid
 *     that switched the container's overflow mid-animation, which discarded
 *     its scroll position and made the whole board jump to the top
 *
 * A clone on top of the page has neither problem: it is not in the grid, so
 * there is nothing to reflow, and it is not inside the scroll container, so
 * there is nothing to clip it and no reason to touch overflow.
 *
 * Props:
 *   card      - an entry from the board data
 *   onSelect  - called IMMEDIATELY on tap, before any animation
 *   isCore    - render in the core-word style
 */
function CommunicationCard({ card, onSelect, isCore = false }) {
  /* If a picture is missing or fails to load, fall back to a word-only card
     rather than showing a broken-image icon to a child. */
  const [imageFailed, setImageFailed] = useState(false)

  /* The real card element, so the tap can measure and clone it. */
  const buttonRef = useRef(null)

  /*
   * Cancels a running animation if this card unmounts mid-flight -- e.g. the
   * child leaves the folder while a card is travelling. Without this the
   * clone would be orphaned on screen with nothing left to remove it.
   */
  const cancelRef = useRef(null)

  useEffect(() => {
    return () => {
      cancelRef.current?.()
      cancelRef.current = null
    }
  }, [])

  function handleClick() {
    /*
     * THE WORD GOES IN FIRST.
     *
     * Communication never waits for decoration. The word reaches the sentence
     * bar on this line, roughly a millisecond after the tap; the animation is
     * feedback about something that has already happened.
     *
     * Deliberately unguarded: every tap is a real communicative act and must
     * produce a word, even if it lands while a previous card is still
     * animating. Swallowing a fast second tap would mean a child presses a
     * card and nothing appears, which is the worst failure this app can have.
     */
    onSelect(card)

    /* Then the visual feedback, entirely separately. */
    cancelRef.current = playCardPress(buttonRef.current)
  }

  const showImage = Boolean(card.image) && !imageFailed

  /*
   * The card's pastel comes from its category, so every Food card shares one
   * colour and a child can tell groups apart at a glance. Core words have no
   * category colour and keep the warm cream from the stylesheet.
   */
  const colors = isCore ? CORE_COLORS : categoryColors(card.category)

  const style = colors ? { '--tint': colors.tint, '--deep': colors.deep } : undefined

  return (
    <button
      type="button"
      className={[
        'ccard',
        isCore ? 'ccard--core' : '',
        colors ? 'ccard--tinted' : '',
        !showImage && !isCore ? 'ccard--noimage' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      ref={buttonRef}
      style={style}
      onClick={handleClick}
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
