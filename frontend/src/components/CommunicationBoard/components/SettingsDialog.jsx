import { useEffect, useRef, useState } from 'react'
import { GRID_SIZES, getGridSize } from '../gridSize'

/*
 * SettingsDialog.jsx
 * ------------------
 * Settings, as a full panel rather than a small centred modal: it takes over
 * most of the screen with the board dimmed behind it, so changing a setting
 * feels like going somewhere.
 *
 * Two levels:
 *
 *   SETTINGS
 *     Grid Size    Medium  >     <- a row showing the current value
 *       |
 *       v
 *   < GRID SIZE                  <- the choices, on their own stage
 *     Small
 *     Medium  (selected)
 *     Large
 *
 * The list stays uncluttered as more settings arrive: each is one row here
 * and its own stage underneath, rather than every option competing for space
 * on the front screen.
 *
 * COLOURS: every value comes from a theme token in index.css. There are no
 * literal colours in this component or its styles, so redefining the tokens
 * re-themes this panel automatically.
 *
 * Props:
 *   gridSize         - the currently selected id
 *   onSelectGridSize - called with a new id; applies immediately
 *   onClose
 */
function SettingsDialog({ gridSize, onSelectGridSize, onClose }) {
  /*
   * Which stage is showing: null is the settings list, 'grid' is the Grid
   * Size chooser. A string rather than a boolean so further settings can
   * each take their own value without another flag.
   */
  const [stage, setStage] = useState(null)

  const firstControlRef = useRef(null)

  /* Move focus to the panel when it opens, and again when the stage changes,
     so a keyboard or screen-reader user follows the navigation. */
  useEffect(() => {
    firstControlRef.current?.focus()
  }, [stage])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      // Escape steps back one level, then closes -- the same shape as the
      // board's own Back button.
      if (stage) setStage(null)
      else onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stage, onClose])

  const current = getGridSize(gridSize)
  const isChoosing = stage === 'grid'

  return (
    <div className="cpanel__backdrop" onClick={onClose}>
      <div
        className="cpanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cpanel__head">
          {/*
            Back on the chooser, Close on the list -- one control in one
            place, whose meaning follows the stage.
          */}
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={() => (isChoosing ? setStage(null) : onClose())}
            aria-label={isChoosing ? 'Back to settings' : 'Close settings'}
            ref={firstControlRef}
          >
            {isChoosing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M20 12H5M12 5l-7 7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>

          <h2 className="cpanel__title" id="settings-title">
            {isChoosing ? 'Grid Size' : 'Settings'}
          </h2>
        </header>

        <div className="cpanel__body">
          {isChoosing ? (
            /* ---------- Grid Size chooser ---------- */
            <div className="cset__options">
              {GRID_SIZES.map((size) => {
                const isSelected = size.id === gridSize
                return (
                  <button
                    type="button"
                    key={size.id}
                    className={`cset__option ${isSelected ? 'cset__option--on' : ''}`}
                    /*
                     * Applies the size immediately and returns to the list,
                     * so the flow ends where it started with the new value
                     * visible on the row.
                     */
                    onClick={() => {
                      onSelectGridSize(size.id)
                      setStage(null)
                    }}
                    /* Announces the chosen state, which colour alone cannot. */
                    aria-pressed={isSelected}
                  >
                    <span className="cset__option-label">
                      {size.label}
                      {/* A tick as well as the fill, so the selection never
                          depends on colour. */}
                      {isSelected && <span aria-hidden="true"> ✓</span>}
                    </span>
                    <span className="cset__option-desc">{size.description}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            /* ---------- The settings list ---------- */
            <button type="button" className="cset__row" onClick={() => setStage('grid')}>
              <span className="cset__row-label">Grid Size</span>
              <span className="cset__row-value">{current.label}</span>
              <svg
                className="cset__row-chevron"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M9 5l7 7-7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
