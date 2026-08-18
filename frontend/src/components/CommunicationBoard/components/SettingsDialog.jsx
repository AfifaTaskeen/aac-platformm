import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GRID_SIZES,
  getGridSize,
  TEXT_SIZES,
  getTextSize,
  THEMES,
  getTheme,
} from '../boardSettings'

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
 *     Text Size    Medium  >
 *       |
 *       v
 *   < GRID SIZE                  <- the choices, on their own stage
 *     Small
 *     Medium  (selected)
 *     Large
 *
 * The settings are described by DATA (the array below) rather than repeated
 * markup, so adding the next one is a single entry here and the list, the
 * chooser and the back navigation all follow. That is why Text Size needed
 * no new UI code.
 *
 * COLOURS: every value comes from a theme token in index.css. There are no
 * literal colours in this component or its styles, so redefining the tokens
 * re-themes this panel automatically.
 *
 * Props:
 *   gridSize, textSize            - the currently selected ids
 *   onSelectGridSize, onSelectTextSize - called with a new id; apply at once
 *   onClose
 */
function SettingsDialog({
  gridSize,
  onSelectGridSize,
  textSize,
  onSelectTextSize,
  theme,
  onSelectTheme,
  onClose,
}) {
  /*
   * Which stage is showing: null is the settings list, otherwise the id of
   * the setting being changed.
   */
  const [stage, setStage] = useState(null)

  const firstControlRef = useRef(null)

  /*
   * The scrolling body, and whether there is anywhere to scroll.
   *
   * The panel already scrolled, but only by swiping or dragging a scrollbar.
   * Buttons match how the board's own card area works, and are far easier
   * for a child -- or anyone using a switch or head pointer -- than a drag.
   */
  const bodyRef = useRef(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = bodyRef.current
    if (!el) return
    setCanScrollUp(el.scrollTop > 4)
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }, [])

  /* Re-checked when the stage changes, since a different panel has a
     different amount of content. */
  useEffect(() => {
    updateScrollState()
  }, [stage, updateScrollState])

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [updateScrollState])

  /* Moves by most of a panel-full, keeping a little overlap so the reader
     does not lose their place. */
  function scrollBy(direction) {
    const el = bodyRef.current
    if (!el) return
    el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' })
  }

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

  /*
   * Every setting the panel knows about. One entry per setting: its title,
   * the options, the current value and how to change it.
   */
  const settings = [
    {
      id: 'grid',
      title: 'Grid Size',
      options: GRID_SIZES,
      selected: gridSize,
      current: getGridSize(gridSize),
      onSelect: onSelectGridSize,
    },
    {
      id: 'text',
      title: 'Text Size',
      options: TEXT_SIZES,
      selected: textSize,
      current: getTextSize(textSize),
      onSelect: onSelectTextSize,
    },
    {
      id: 'theme',
      title: 'Theme',
      options: THEMES,
      selected: theme,
      current: getTheme(theme),
      onSelect: onSelectTheme,
    },
  ]

  const openSetting = settings.find((s) => s.id === stage) || null

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
            Back on a chooser, Close on the list -- one control in one place,
            whose meaning follows the stage.
          */}
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={() => (openSetting ? setStage(null) : onClose())}
            aria-label={openSetting ? 'Back to settings' : 'Close settings'}
            ref={firstControlRef}
          >
            {openSetting ? (
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
            {openSetting ? openSetting.title : 'Settings'}
          </h2>
        </header>

        <div className="cpanel__body" ref={bodyRef}>
          {openSetting ? (
            /* ---------- One setting's choices ---------- */
            <div className="cset__options">
              {openSetting.options.map((option) => {
                const isSelected = option.id === openSetting.selected
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={`cset__option ${isSelected ? 'cset__option--on' : ''}`}
                    /*
                     * Applies immediately and returns to the list, so the
                     * flow ends where it started with the new value visible
                     * on the row.
                     */
                    onClick={() => {
                      openSetting.onSelect(option.id)
                      setStage(null)
                    }}
                    /* Announces the chosen state, which colour alone cannot. */
                    aria-pressed={isSelected}
                  >
                    <span className="cset__option-label">
                      {option.label}
                      {/* A tick as well as the fill, so the selection never
                          depends on colour. */}
                      {isSelected && <span aria-hidden="true"> ✓</span>}
                    </span>
                    <span className="cset__option-desc">{option.description}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            /* ---------- The settings list ---------- */
            <div className="cset__rows">
              {settings.map((setting) => (
                <button
                  type="button"
                  key={setting.id}
                  className="cset__row"
                  onClick={() => setStage(setting.id)}
                >
                  <span className="cset__row-label">{setting.title}</span>
                  <span className="cset__row-value">{setting.current.label}</span>
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
              ))}
            </div>
          )}
        </div>

        {/*
          Scroll controls, shown ONLY when the content actually overflows --
          so today, with two short settings, they never appear. They exist for
          when the list grows, and match the board's own Up/Down buttons so
          the gesture is already familiar.
        */}
        {(canScrollUp || canScrollDown) && (
          <footer className="cpanel__foot">
            <button
              type="button"
              className="cpanel__iconbtn"
              onClick={() => scrollBy(-1)}
              disabled={!canScrollUp}
              aria-label="Scroll up"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M12 20V5M12 5l-6 6M12 5l6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            <button
              type="button"
              className="cpanel__iconbtn"
              onClick={() => scrollBy(1)}
              disabled={!canScrollDown}
              aria-label="Scroll down"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M12 4v15M12 19l-6-6M12 19l6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}

export default SettingsDialog
