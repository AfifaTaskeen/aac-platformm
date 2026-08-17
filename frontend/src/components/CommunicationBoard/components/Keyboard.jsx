import { useState } from 'react'

/*
 * Keyboard.jsx
 * ------------
 * A simple on-screen keyboard for words that are not on any card.
 *
 * Deliberately basic, as asked. Letters, space, backspace, and a button that
 * adds the typed word to the sentence.
 *
 * The child types into a small buffer shown at the top of the keyboard, then
 * presses Add. That extra step is intentional: it keeps the sentence area
 * holding whole words, so Speak reads "I want juice" rather than a sentence
 * that changes on every keystroke.
 *
 * Props:
 *   onAddWord - called with the finished word
 *   onClose   - hides the keyboard and returns to the cards
 */

/* QWERTY, because that is what a tablet keyboard looks like. */
const ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
]

function Keyboard({ onAddWord, onClose }) {
  const [buffer, setBuffer] = useState('')

  function press(letter) {
    setBuffer((current) => current + letter)
  }

  function backspace() {
    setBuffer((current) => current.slice(0, -1))
  }

  function add() {
    const word = buffer.trim()
    if (!word) return
    onAddWord(word)
    setBuffer('')
  }

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

      <div className="ckeys__rows">
        {ROWS.map((row, rowIndex) => (
          <div className="ckeys__row" key={rowIndex}>
            {row.map((letter) => (
              <button type="button" className="ckeys__key" key={letter} onClick={() => press(letter)}>
                {letter}
              </button>
            ))}
          </div>
        ))}

        <div className="ckeys__row">
          <button type="button" className="ckeys__key ckeys__key--wide" onClick={() => press(' ')}>
            Space
          </button>
          <button
            type="button"
            className="ckeys__key ckeys__key--wide"
            onClick={backspace}
            disabled={!buffer}
          >
            Back
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

export default Keyboard
