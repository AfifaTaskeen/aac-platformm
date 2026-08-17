import { useState } from 'react'
import { categoryColors, CORE_COLORS } from '../cardData'

/*
 * CommunicationCard.jsx
 * ---------------------
 * One tappable card: a picture with its word underneath, or -- for a core
 * word like "Want" -- just the word, large and clear.
 *
 * Props:
 *   card      - an entry from cardData.js
 *   onSelect  - called with the card when tapped
 *   isCore    - render in the core-word style (no picture)
 */
function CommunicationCard({ card, onSelect, isCore = false }) {
  /*
   * Drives the tap animation. It is state rather than a CSS :active rule
   * because the card should finish its little bounce even if the finger
   * lifts immediately -- :active would cut the animation short.
   */
  const [isTapped, setIsTapped] = useState(false)

  /* If a picture is missing or fails to load, fall back to a word-only card
     rather than showing a broken-image icon to a child. */
  const [imageFailed, setImageFailed] = useState(false)

  function handleClick() {
    setIsTapped(true)
    // Matches the animation length in the CSS.
    setTimeout(() => setIsTapped(false), 260)
    onSelect(card)
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
  const style = colors
    ? { '--tint': colors.tint, '--deep': colors.deep }
    : undefined

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
