/*
 * RightMenu.jsx
 * -------------
 * The vertical control strip, in a fixed order:
 *
 *   1. Keyboard   (first, and deliberately the largest)
 *   2. Core Words
 *   3. Up
 *   4. Down
 *   5. Alert
 *   6. Settings
 *
 * Keyboard leads because it is the child's own control -- the way they say
 * something that is not on a card. Settings sits last, furthest from the
 * controls the child uses constantly. Edit Words is not here at all: it
 * lives inside Settings, where configuration belongs.
 *
 * Deliberately a SEPARATE component with no knowledge of where it sits. It
 * takes callbacks and renders buttons; the board decides its position. Moving
 * it to the left later is a CSS change plus one class -- no rewrite, which is
 * exactly what a child needing left-hand reach will require.
 *
 * Props:
 *   onKeyboard      - toggles the on-screen keyboard
 *   isKeyboardOpen  - so the button can show its state
 *   onSettings, onCoreWords  - open placeholder dialogs for now
 *   onScrollUp, onScrollDown - move the card area
 *   canScrollUp, canScrollDown - whether there is anywhere to move
 *   onAlert         - plays the attention sound
 */
function RightMenu({
  onKeyboard,
  isKeyboardOpen,
  onSettings,
  onCoreWords,
  onScrollUp,
  onScrollDown,
  canScrollUp,
  canScrollDown,
  onAlert,
}) {
  return (
    <nav className="cmenu" aria-label="Board controls">
      {/*
        Keyboard: first and largest. Its own modifier class gives it a taller
        body and a bigger icon, so it is unmistakably the primary control here.
      */}
      <button
        type="button"
        className={`cmenu__btn cmenu__btn--keyboard ${isKeyboardOpen ? 'cmenu__btn--on' : ''}`}
        onClick={onKeyboard}
        aria-pressed={isKeyboardOpen}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path
            d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
        <span>Keyboard</span>
      </button>

      <button type="button" className="cmenu__btn cmenu__btn--core" onClick={onCoreWords}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 4l2.3 4.9 5.2.7-3.8 3.6 1 5.2-4.7-2.6-4.7 2.6 1-5.2L4.5 9.6l5.2-.7L12 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
        <span>Core Words</span>
      </button>

      <button
        type="button"
        className="cmenu__btn cmenu__btn--arrow cmenu__btn--up"
        onClick={onScrollUp}
        disabled={!canScrollUp}
        aria-label="Scroll cards up"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M6 15l6-6 6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Up</span>
      </button>

      <button
        type="button"
        className="cmenu__btn cmenu__btn--arrow cmenu__btn--down"
        onClick={onScrollDown}
        disabled={!canScrollDown}
        aria-label="Scroll cards down"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Down</span>
      </button>

      <button type="button" className="cmenu__btn cmenu__btn--alert" onClick={onAlert}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 4a5.5 5.5 0 0 0-5.5 5.5c0 4-1.5 5.5-1.5 5.5h14s-1.5-1.5-1.5-5.5A5.5 5.5 0 0 0 12 4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path d="M10.2 18a2 2 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span>Alert</span>
      </button>

      <button type="button" className="cmenu__btn cmenu__btn--settings" onClick={onSettings}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path
            d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
        <span>Settings</span>
      </button>
    </nav>
  )
}

export default RightMenu
