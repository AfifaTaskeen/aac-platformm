import { useCallback, useEffect, useRef, useState } from 'react'
import SettingsPasswordChange from './SettingsPasswordChange'
import {
  GRID_SIZES,
  getGridSize,
  TEXT_SIZES,
  getTextSize,
  THEMES,
  getTheme,
  VOICES,
  getVoice,
  CARD_POSITIONS,
  getCardPosition,
  CARD_FLEXIBILITY,
  getCardFlexibility,
  NAV_POSITIONS,
  getNavPosition,
  ANIMATIONS,
  getAnimation,
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
  voice,
  onSelectVoice,
  cardPosition,
  onSelectCardPosition,
  cardFlexibility,
  onSelectCardFlexibility,
  navPosition,
  onSelectNavPosition,
  animation,
  onSelectAnimation,
  onEditWords,
  userName,
  childName,
  /*
   * Whether this account currently has a Settings Password -- fetched once
   * by CommunicationBoard (the same check the lock screen uses) and passed
   * straight through, so the Account row can say "Set" vs. "Change" without
   * a second request, and so a password just created/changed on this screen
   * is immediately reflected without reopening Settings.
   */
  hasSettingsPassword,
  onSettingsPasswordChanged,
  onLogOut,
  /* Ends the current Settings unlock session immediately, so the next
     open of Settings asks for the Settings Password again. */
  onLockSettings,
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
    /*
     * Card Position -- where the grid sits horizontally. Same row/option
     * markup as every other setting, so it inherits the panel's responsive
     * layout rather than needing rules of its own.
     */
    {
      id: 'cardPosition',
      title: 'Card Position',
      options: CARD_POSITIONS,
      selected: cardPosition,
      current: getCardPosition(cardPosition),
      onSelect: onSelectCardPosition,
    },
    /*
     * Voice sits next to the other "how the board behaves" settings and uses
     * the same row/option markup, so it inherits the panel's existing
     * responsive layout rather than needing rules of its own.
     */
    {
      id: 'voice',
      title: 'Voice',
      options: VOICES,
      selected: voice,
      current: getVoice(voice),
      onSelect: onSelectVoice,
    },
    {
      id: 'theme',
      title: 'Theme',
      options: THEMES,
      selected: theme,
      current: getTheme(theme),
      onSelect: onSelectTheme,
    },
    /*
     * Animation -- whether a tapped card visibly comes forward. Grouped with
     * the other display settings because that is all it changes: what the
     * board LOOKS like when a card is chosen, never what choosing one does.
     */
    /*
     * Navigation Position sits next to Card Position: both answer "where on
     * the screen is this, so the child can reach it", and a caregiver setting
     * one usually wants the other.
     */
    /*
     * Movability -- whether cards can be dragged into a new order. A
     * caregiver tool, so it sits with the other layout settings; the
     * arrangement it produces is saved from the board itself, where the
     * caregiver can see what they are saving.
     */
    {
      id: 'cardFlexibility',
      title: 'Card Flexibility',
      options: CARD_FLEXIBILITY,
      selected: cardFlexibility,
      current: getCardFlexibility(cardFlexibility),
      onSelect: onSelectCardFlexibility,
    },
    {
      id: 'navPosition',
      title: 'Navigation Position',
      options: NAV_POSITIONS,
      selected: navPosition,
      current: getNavPosition(navPosition),
      onSelect: onSelectNavPosition,
    },
    {
      id: 'animation',
      title: 'Animation',
      options: ANIMATIONS,
      selected: animation,
      current: getAnimation(animation),
      onSelect: onSelectAnimation,
    },
  ]

  const openSetting = settings.find((s) => s.id === stage) || null
  /*
   * Account is a drill-in stage like any value-chooser above (same header/
   * back-button behaviour), but it shows fixed account info and an action
   * rather than a list of options -- so it is tracked separately from
   * `openSetting` instead of being folded into the `settings` array, which
   * assumes every entry is "a title, a current value, and a list of choices."
   */
  const isAccountStage = stage === 'account'
  /* The Set/Change Settings Password form, reached from the Account row. */
  const isSettingsPasswordStage = stage === 'settingsPassword'
  const onAnyStage = openSetting || isAccountStage || isSettingsPasswordStage

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
            Back on a chooser (or Account), Close on the list -- one control
            in one place, whose meaning follows the stage.
          */}
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={() => (onAnyStage ? setStage(null) : onClose())}
            aria-label={onAnyStage ? 'Back to settings' : 'Close settings'}
            ref={firstControlRef}
          >
            {onAnyStage ? (
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
            {isSettingsPasswordStage
              ? hasSettingsPassword
                ? 'Change Settings Password'
                : 'Set Settings Password'
              : isAccountStage
                ? 'Account'
                : openSetting
                  ? openSetting.title
                  : 'Settings'}
          </h2>
        </header>

        <div className="cpanel__body" ref={bodyRef}>
          {isSettingsPasswordStage ? (
            <SettingsPasswordChange
              hasSettingsPassword={hasSettingsPassword}
              onDone={() => {
                onSettingsPasswordChanged?.()
                setStage('account')
              }}
              onCancel={() => setStage('account')}
            />
          ) : isAccountStage ? (
            /*
              ---------- Account ----------
              Display-only: the signed-in user's name and the active child
              profile's name, both already-fetched values passed in as props
              (see CommunicationBoard.jsx) -- nothing here triggers a new
              request or stores a second copy of either. Log Out is the one
              action, moved in from being its own top-level row.
            */
            <div className="cset__account">
              <div className="cset__account-row">
                <span className="cset__account-label">Name</span>
                <span className="cset__account-value">{userName || 'Signed in'}</span>
              </div>
              <div className="cset__account-row">
                <span className="cset__account-label">Child</span>
                <span className="cset__account-value">{childName || '—'}</span>
              </div>

              <button
                type="button"
                className="cset__row"
                onClick={() => setStage('settingsPassword')}
              >
                <span className="cset__row-label">
                  {hasSettingsPassword ? 'Change Settings Password' : 'Set Settings Password'}
                </span>
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

              {onLockSettings && (
                <button
                  type="button"
                  className="cset__row"
                  onClick={() => {
                    onLockSettings()
                    onClose()
                  }}
                >
                  <span className="cset__row-label">Lock Settings</span>
                </button>
              )}

              {onLogOut && (
                <button
                  type="button"
                  className="cset__row cset__row--logout"
                  onClick={onLogOut}
                >
                  <span className="cset__row-label">Log Out</span>
                </button>
              )}
            </div>
          ) : openSetting ? (
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
              {/*
                Edit Words leads the list. Unlike the rows below it, it is an
                ACTION rather than a value to choose -- it opens its own
                screen -- which is why it is not part of the `settings` array
                and shows no current value beside its name.
              */}
              <button type="button" className="cset__row" onClick={onEditWords}>
                <span className="cset__row-label">Edit Words</span>
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

              {/*
                Account leads to who is signed in, which child this is, and
                Log Out -- a drill-in like every setting above it rather than
                an instant action, which is the normal shape for this kind of
                row in a production app (Settings -> Account -> sign out),
                and means a caregiver sees their name and child confirmed
                before the one truly irreversible action on this screen.

                A plain .cset__row, not .cset__row--logout: THIS row only
                navigates (same as Edit Words or any setting above it), it
                does not itself end the session, so it gets a chevron and the
                ordinary ink label rather than the danger-coloured, no-
                chevron treatment that styling is reserved for. Log Out keeps
                that treatment where it actually lives now, inside the
                Account stage below.
              */}
              <button
                type="button"
                className="cset__row"
                onClick={() => setStage('account')}
              >
                <span className="cset__row-label">Account</span>
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
