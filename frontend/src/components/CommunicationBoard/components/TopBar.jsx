/*
 * TopBar.jsx
 * ----------
 * The back arrow, the sentence the child is building, and the three sentence
 * controls (Speak, Delete, Clear).
 *
 * Kept as its own component because the layout is meant to move later: a
 * child may need these controls somewhere else entirely. A self-contained
 * component can be repositioned by changing where it is rendered.
 *
 * Props:
 *   words      - array of selected card objects, in order
 *   canGoBack  - whether the back arrow does anything right now
 *   onBack, onSpeak, onDelete, onClear
 *   isSpeaking - true while speech is playing
 */
function TopBar({ words, canGoBack, onBack, onSpeak, onDelete, onClear, isSpeaking }) {
  const hasWords = words.length > 0

  return (
    <header className="cbar">
      {/*
        Back. Disabled rather than hidden at the top level: a control that
        vanishes and reappears is harder to learn than one that is always in
        the same place.
      */}
      <button
        type="button"
        className="cbar__back"
        onClick={onBack}
        disabled={!canGoBack}
        aria-label="Go back"
      >
        {/* An arrow with a shaft, not a bare chevron: it reads as "go back"
            rather than as a decorative angle. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M20 12H5M12 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/*
        One bar holding BOTH the sentence and its three controls, so they read
        as a single unit rather than separate blocks sitting next to each
        other. The white panel, border and rounding belong to this wrapper.
      */}
      <div className="cbar__panel">
        {/*
          The sentence being built.

          role="status" with aria-live="polite" means a screen reader
          announces each new word as it is added, without interrupting
          anything else. It stays on the WORDS alone -- wrapping the buttons
          in it too would make the announcement repeat their labels.
        */}
        <div className="cbar__sentence" role="status" aria-live="polite">
          {hasWords ? (
            <div className="cbar__words">
              {words.map((word, index) => (
                <span className="cbar__word" key={`${word.id}-${index}`}>
                  {word.label}
                </span>
              ))}
            </div>
          ) : (
            <span className="cbar__placeholder">Tap cards to build a sentence</span>
          )}
        </div>

        {/*
          The three sentence controls, inside the same bar. Each carries a
          word as well as an icon -- meaning never depends on the picture
          alone.
        */}
        <div className="cbar__actions">
          <button
            type="button"
            className="cbtn cbtn--speak"
            onClick={onSpeak}
            disabled={!hasWords}
            aria-label="Speak the sentence"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 9v6h4l5 4V5L8 9H4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <path
                d="M16.5 8.5a5 5 0 0 1 0 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>{isSpeaking ? 'Speaking…' : 'Speak'}</span>
          </button>

          <button
            type="button"
            className="cbtn cbtn--delete"
            onClick={onDelete}
            disabled={!hasWords}
            aria-label="Delete the last word"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M20 6H9L3 12l6 6h11a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <path
                d="M12 10l5 4M17 10l-5 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
            <span>Delete</span>
          </button>

          <button
            type="button"
            className="cbtn cbtn--clear"
            onClick={onClear}
            disabled={!hasWords}
            aria-label="Clear the whole sentence"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 7h12M10 7V5h4v2M8 7l1 12h6l1-12"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Clear</span>
          </button>
        </div>
      </div>
    </header>
  )
}

export default TopBar
