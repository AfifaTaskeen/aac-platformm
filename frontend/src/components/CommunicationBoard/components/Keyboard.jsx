import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * Keyboard.jsx
 * ------------
 * The on-screen keyboard for words that are not on any card.
 *
 * The child types into a small buffer shown at the top, then presses Add.
 * That extra step is intentional: it keeps the sentence area holding whole
 * words, so Speak reads "I want juice" rather than a sentence that changes on
 * every keystroke.
 *
 * WHY THE KEYS SCROLL
 * -------------------
 * The board's Up/Down buttons move `.cboard__cards`, the scroll box the card
 * grid lives in. The keyboard is rendered INSIDE that same box but sized to
 * `height: 100%`, so it never overflows: scrollHeight equals clientHeight,
 * the board computes "nothing to scroll", and Up/Down sat permanently
 * disabled with the not-allowed cursor.
 *
 * The keys now scroll in their OWN box (`.ckeys__rows`) and the board drives
 * that box instead while the keyboard is open. That keeps one set of arrow
 * buttons doing one obvious thing, and leaves their behaviour on the card
 * grid completely untouched.
 *
 * Props:
 *   onAddWord    - called with the finished word
 *   onClose      - hides the keyboard and returns to the cards
 *   onDeleteWord - removes the last word from the sentence (the board's own
 *                  delete logic, passed in rather than reimplemented here)
 *   canDeleteWord- whether the sentence has anything left to remove
 *   scrollRef    - the board attaches this to the scrolling key area, so Up
 *                  and Down can move it
 *   onScrollableChange - called when the key area's scrollability changes, so
 *                  the board can enable/disable Up and Down to match
 */

/*
 * QWERTY, because that is what a tablet keyboard looks like.
 *
 * The number row and the apostrophe are here because their absence was a real
 * gap: a child could not type an age, a house number, or "I'm" -- and the
 * apostrophe in particular turns a typed word into a wrong one rather than
 * merely an unavailable one.
 */
const ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', "'"],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '?'],
]

function Keyboard({
  onAddWord,
  onClose,
  onDeleteWord,
  canDeleteWord = false,
  scrollRef,
  onScrollableChange,
}) {
  const [buffer, setBuffer] = useState('')
  const rowsRef = useRef(null)

  /*
   * Hands the scrolling element to the board and keeps its scrollability
   * reported, so Up/Down reflect the ACTUAL position rather than being
   * disabled on principle.
   *
   * Both the ref and the measurement live here because this component owns
   * the element; the board only needs to know "can it move, and by how much".
   */
  const attach = useCallback(
    (el) => {
      rowsRef.current = el
      if (typeof scrollRef === 'function') scrollRef(el)
      else if (scrollRef) scrollRef.current = el
    },
    [scrollRef],
  )

  useEffect(() => {
    const el = rowsRef.current
    if (!el || !onScrollableChange) return

    const report = () => {
      onScrollableChange({
        up: el.scrollTop > 4,
        down: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
      })
    }

    report()
    el.addEventListener('scroll', report, { passive: true })

    /* The rows resize with the window and with an orientation change, and
       either can turn a fitting keyboard into a scrolling one. */
    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(report)
      observer.observe(el)
    }
    window.addEventListener('resize', report)

    return () => {
      el.removeEventListener('scroll', report)
      window.removeEventListener('resize', report)
      if (observer) observer.disconnect()
      /* Leaving the keyboard must not leave Up/Down stuck in its state. */
      onScrollableChange({ up: false, down: false })
    }
  }, [onScrollableChange])

  function press(letter) {
    setBuffer((current) => current + letter)
  }

  function backspace() {
    setBuffer((current) => current.slice(0, -1))
  }

  /*
   * ONE Delete button, doing the obviously-right thing for what is on screen.
   *
   * While letters are being typed it erases a letter -- the same job the old
   * Back key did, so that behaviour is kept rather than lost. Once the buffer
   * is empty there is no letter to remove, so it falls through to the board's
   * OWN delete, taking the last word off the sentence.
   *
   * The board's handler is passed in as a prop rather than reimplemented, so
   * there is exactly one piece of delete logic in the app and the two paths
   * cannot drift apart.
   */
  function handleDelete() {
    if (buffer) {
      backspace()
      return
    }
    if (onDeleteWord) onDeleteWord()
  }

  function add() {
    const word = buffer.trim()
    if (!word) return
    onAddWord(word)
    setBuffer('')
  }

  /* Nothing to erase in either place -- the only time Delete is inert. */
  const deleteDisabled = !buffer && !canDeleteWord

  return (
    <section className="ckeys" aria-label="On-screen keyboard">
      <div className="ckeys__top">
        {/*
          What has been typed so far. aria-live keeps a screen reader in step
          with a child who cannot see the letters appear.
        */}
        <div className="ckeys__buffer" role="status" aria-live="polite">
          {buffer || <span className="ckeys__bufferhint">Type a word…</span>}
        </div>

        <button type="button" className="cbtn ckeys__close" onClick={onClose}>
          <span>Close</span>
        </button>
      </div>

      {/*
        The scrolling box. This is what Up and Down move while the keyboard is
        open -- see the comment at the top of this file.
      */}
      <div className="ckeys__rows" ref={attach}>
        {ROWS.map((row, rowIndex) => (
          <div className="ckeys__row" key={rowIndex}>
            {row.map((letter) => (
              <button
                type="button"
                className="ckeys__key"
                key={letter}
                onClick={() => press(letter)}
                aria-label={KEY_LABELS[letter] || letter}
              >
                {letter}
              </button>
            ))}
          </div>
        ))}

        <div className="ckeys__row">
          <button type="button" className="ckeys__key ckeys__key--wide" onClick={() => press(' ')}>
            Space
          </button>

          {/*
            Delete replaces the old Back key. It carries an icon as well as its
            word, matching the sentence bar's Delete, so the two read as the
            same action in both places.
          */}
          <button
            type="button"
            className="ckeys__key ckeys__key--wide ckeys__key--delete"
            onClick={handleDelete}
            disabled={deleteDisabled}
            aria-label={buffer ? 'Delete the last letter' : 'Delete the last word'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M20 6H9L3 12l6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinejoin="round"
              />
              <path
                d="M12 10l5 4M17 10l-5 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
            <span>Delete</span>
          </button>

          <button
            type="button"
            className="ckeys__key ckeys__key--add"
            onClick={add}
            disabled={!buffer.trim()}
          >
            Add word
          </button>
        </div>
      </div>
    </section>
  )
}

/*
 * Spoken names for the keys whose character a screen reader would otherwise
 * read as punctuation or skip entirely.
 */
const KEY_LABELS = {
  "'": 'Apostrophe',
  ',': 'Comma',
  '.': 'Full stop',
  '?': 'Question mark',
}

export default Keyboard
