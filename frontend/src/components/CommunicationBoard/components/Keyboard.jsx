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
 * ALPHABETICAL, NOT QWERTY.
 *
 * QWERTY is an arrangement a child has to be TAUGHT before it helps them:
 * its order carries no meaning, so finding a letter means scanning all
 * twenty-six. A child learning to spell already knows A B C in order, and an
 * AAC user is usually hunting one letter at a time rather than touch-typing,
 * so sequential order turns "search the whole board" into "count along from
 * where I know that letter lives".
 *
 * The rows are nine wide so the alphabet breaks A-I / J-R / S-Z, which keeps
 * each row a predictable length and leaves the last row short rather than
 * splitting the run at an arbitrary point.
 *
 * Numbers lead, on their own row of ten, because they are their own group --
 * mixing them into the letters would break the alphabetical run the layout
 * exists to preserve.
 */
const NUMBER_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

const LETTER_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
  ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
  ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
]

/*
 * The key colours, as tint/deep pairs.
 *
 * This is the SAME system the cards use (see cardData.js): a pale `tint` for
 * the resting fill and a deeper shade of the same hue for the pressed state,
 * both chosen so the app's fixed-dark --color-on-tint text stays readable on
 * them. Reusing the pattern is what keeps the keyboard looking like part of
 * Buddy Talk rather than a control panel bolted onto it.
 *
 * Every letter shares ONE hue, so A-Z reads as a single block. The colour
 * therefore separates the GROUPS -- letters, numbers, actions -- rather than
 * distinguishing one letter from another, which the shape of the letter
 * already does.
 */
const LETTER_HUE = { tint: '#dceeff', deep: '#8fc2ec' } /* sky */

/* Numbers keep their own hue, so the row still reads as a separate group. */
const NUMBER_HUE = { tint: '#bdfffb', deep: '#47d9d0' }

/* The inline custom properties the CSS reads for fill and pressed fill. */
function hueStyle({ tint, deep }) {
  return { '--tint': tint, '--deep': deep }
}

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
        {/* Numbers first, as one group in one hue. */}
        <div className="ckeys__row ckeys__row--chars">
          {NUMBER_ROW.map((digit) => (
            <button
              type="button"
              className="ckeys__key ckeys__key--number"
              key={digit}
              style={hueStyle(NUMBER_HUE)}
              onClick={() => press(digit)}
            >
              {digit}
            </button>
          ))}
        </div>

        {/* A to Z in order, every letter in the one shared hue. */}
        {LETTER_ROWS.map((row, rowIndex) => (
          <div className="ckeys__row ckeys__row--chars" key={rowIndex}>
            {row.map((letter) => (
              <button
                type="button"
                className="ckeys__key ckeys__key--letter"
                key={letter}
                style={hueStyle(LETTER_HUE)}
                onClick={() => press(letter)}
              >
                {letter}
              </button>
            ))}
          </div>
        ))}

        {/*
          The three actions, set apart from the characters above by their own
          row class: they are wider, and they are the only keys that DO
          something rather than adding a character.
        */}
        <div className="ckeys__row ckeys__row--actions">
          <button
            type="button"
            className="ckeys__key ckeys__key--wide ckeys__key--space"
            onClick={() => press(' ')}
          >
            SPACE
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
            <span>DELETE</span>
          </button>

          <button
            type="button"
            className="ckeys__key ckeys__key--wide ckeys__key--add"
            onClick={add}
            disabled={!buffer.trim()}
          >
            ADD WORD
          </button>
        </div>
      </div>
    </section>
  )
}

export default Keyboard
