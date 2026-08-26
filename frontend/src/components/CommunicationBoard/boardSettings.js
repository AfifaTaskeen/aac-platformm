/*
 * boardSettings.js
 * ----------------
 * The board's display settings: Grid Size and Text Size.
 *
 * Both follow the same shape -- a list of options, a default, and load/save
 * helpers -- so the Settings panel can render either without special cases,
 * and a third setting can be added here without touching the UI.
 *
 * Separate from the components so the board, the settings dialog and the
 * persistence all read one definition. Adding a size later means editing
 * this file only.
 *
 * NOTE this is distinct from the child profile's `gridSize` (2/3/4), which
 * sets the card WIDTH. This setting shifts the COLUMN COUNT relative to
 * whatever the screen would normally show, so the two compose rather than
 * fight: a caregiver who chose big cards in the profile still gets bigger
 * cards on Large and smaller ones on Small.
 */

/*
 * `shift` is added to the column count the screen would otherwise use.
 *
 *   verysmall  +2 columns  -> the most, smallest cards
 *   small      +1 column   -> more, smaller cards
 *   medium      0          -> exactly today's layout, unchanged
 *   large      -1 column   -> fewer, larger cards
 *
 * Very Small extends the same +1 step Small already uses -- it is not a new
 * mechanism, just one more column added on top. effectiveColumns() in
 * CommunicationBoard.jsx floors the result at 1, so no shift, however large,
 * can ever produce zero or negative columns.
 */
export const GRID_SIZES = [
  {
    id: 'verysmall',
    label: 'Very Small',
    shift: 2,
    description: 'The most cards on screen',
  },
  {
    id: 'small',
    label: 'Small',
    shift: 1,
    description: 'More cards on screen',
  },
  {
    id: 'medium',
    label: 'Medium',
    shift: 0,
    description: 'The standard size',
  },
  {
    id: 'large',
    label: 'Large',
    shift: -1,
    description: 'Fewer, bigger cards',
  },
]

/* Medium is the default, so an untouched install looks exactly as it does
   today. */
export const DEFAULT_GRID_SIZE = 'medium'

const STORAGE_KEY = 'buddytalk.gridSize'

export function getGridSize(id) {
  return GRID_SIZES.find((s) => s.id === id) || GRID_SIZES.find((s) => s.id === DEFAULT_GRID_SIZE)
}

/*
 * Reads the saved choice.
 *
 * Wrapped in try/catch because localStorage throws rather than returning
 * null in private browsing on some browsers, and a settings preference is
 * never worth breaking the board over -- it falls back to Medium.
 */
export function loadGridSize() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && GRID_SIZES.some((s) => s.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_GRID_SIZE
}

export function saveGridSize(id) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/* -------------------------------------------------------------------------
   TEXT SIZE

   The size of the words on communication cards, and nothing else. It is a
   MULTIPLIER rather than a set of fixed sizes, so the existing relationships
   hold: a folder name stays larger than a word card's label at every
   setting, and every size still scales with the viewport.
   ------------------------------------------------------------------------- */
export const TEXT_SIZES = [
  {
    id: 'small',
    label: 'Small',
    scale: 0.85,
    description: 'Smaller text',
  },
  {
    id: 'medium',
    label: 'Medium',
    scale: 1,
    description: 'Standard text',
  },
  {
    id: 'large',
    label: 'Large',
    scale: 1.2,
    description: 'Larger text',
  },
]

export const DEFAULT_TEXT_SIZE = 'medium'

const TEXT_STORAGE_KEY = 'buddytalk.textSize'

export function getTextSize(id) {
  return TEXT_SIZES.find((s) => s.id === id) || TEXT_SIZES.find((s) => s.id === DEFAULT_TEXT_SIZE)
}

export function loadTextSize() {
  try {
    const saved = window.localStorage.getItem(TEXT_STORAGE_KEY)
    if (saved && TEXT_SIZES.some((s) => s.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_TEXT_SIZE
}

export function saveTextSize(id) {
  try {
    window.localStorage.setItem(TEXT_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/* -------------------------------------------------------------------------
   THEME

   Light is the default and is exactly the appearance the app has always had.
   Dark redefines the surface tokens in index.css -- see the [data-theme]
   block there. No component knows which theme is active.

   The five category colours are NOT part of this: Food stays yellow and
   Actions blue in both themes, because that coding is how a child
   recognises a group.
   ------------------------------------------------------------------------- */
export const THEMES = [
  {
    id: 'light',
    label: 'Light',
    description: 'Bright background',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Dark background',
  },
]

export const DEFAULT_THEME = 'light'

const THEME_STORAGE_KEY = 'buddytalk.theme'

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME)
}

export function loadTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_THEME
}

export function saveTheme(id) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/*
 * Puts the theme on <html> as data-theme, which is what the CSS block keys
 * off. Applied to the document root rather than a component so it covers
 * every screen -- board, settings, and the auth screens too.
 */
export function applyTheme(id) {
  if (typeof document === 'undefined') return
  const theme = getTheme(id)
  document.documentElement.setAttribute('data-theme', theme.id)
}

/* -------------------------------------------------------------------------
   VOICE

   Which voice reads the sentence aloud. Same shape as the settings above so
   the panel renders it with no special case.

   This is a PREFERENCE, not a guarantee. The voices belong to the device and
   its browser, not to this app: speechSynthesis.getVoices() returns whatever
   that phone, tablet or laptop happens to have installed. Some Android
   devices expose a single English voice, in which case both options resolve
   to the same one -- pickVoice() in speech.js degrades to a working English
   voice rather than to silence, because a child who cannot be heard is worse
   off than a child heard in the other gender.

   The child profile already carries a `voice` field, chosen once during
   profile setup. This setting overrides it per device, which is what makes it
   useful: the profile value cannot know which voices this particular device
   actually has.
   ------------------------------------------------------------------------- */
export const VOICES = [
  {
    id: 'female',
    label: 'Female',
    description: 'A female speaking voice',
  },
  {
    id: 'male',
    label: 'Male',
    description: 'A male speaking voice',
  },
]

export const DEFAULT_VOICE = 'female'

const VOICE_STORAGE_KEY = 'buddytalk.voice'

export function getVoice(id) {
  return VOICES.find((v) => v.id === id) || VOICES.find((v) => v.id === DEFAULT_VOICE)
}

/*
 * The saved choice, or null when the child has never set one.
 *
 * null is deliberately different from the default here: it means "no device
 * preference", which lets the board fall back to the voice saved on the child
 * profile. Returning DEFAULT_VOICE instead would silently override a profile
 * set to male with female on every device.
 */
export function loadVoice() {
  try {
    const saved = window.localStorage.getItem(VOICE_STORAGE_KEY)
    if (saved && VOICES.some((v) => v.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through.
  }
  return null
}

export function saveVoice(id) {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/* -------------------------------------------------------------------------
   CARD POSITION

   Where the card grid sits HORIZONTALLY inside the card area. Nothing else:
   the column count, the card size, the spacing and the scrolling are all
   decided elsewhere and are untouched by this setting.

   It exists because a child does not always have easy reach across a whole
   screen. A child who uses their left hand, or whose wheelchair tray puts the
   tablet off to one side, may only comfortably reach part of the board --
   moving the grid to that side is the difference between reaching every card
   and reaching some of them.

   Normal is deliberately its own option rather than an alias for one of the
   other three. It means "exactly what the board did before this setting
   existed" -- the grid stretched across the full width -- so an existing user
   who never opens this setting sees no change at all.
   ------------------------------------------------------------------------- */
export const CARD_POSITIONS = [
  {
    id: 'normal',
    label: 'Normal',
    description: 'Fills the whole width',
  },
  {
    id: 'left',
    label: 'Left',
    description: 'Cards on the left side',
  },
  {
    id: 'center',
    label: 'Center',
    description: 'Cards in the middle',
  },
  {
    id: 'right',
    label: 'Right',
    description: 'Cards on the right side',
  },
]

export const DEFAULT_CARD_POSITION = 'normal'

const CARD_POSITION_STORAGE_KEY = 'buddytalk.cardPosition'

export function getCardPosition(id) {
  return (
    CARD_POSITIONS.find((p) => p.id === id) ||
    CARD_POSITIONS.find((p) => p.id === DEFAULT_CARD_POSITION)
  )
}

export function loadCardPosition() {
  try {
    const saved = window.localStorage.getItem(CARD_POSITION_STORAGE_KEY)
    if (saved && CARD_POSITIONS.some((p) => p.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_CARD_POSITION
}

export function saveCardPosition(id) {
  try {
    window.localStorage.setItem(CARD_POSITION_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/* -------------------------------------------------------------------------
   ANIMATION

   Whether tapping a card plays the "come forward" animation -- the card
   appearing to lift out of the grid, grow, travel toward the middle of the
   board, hold, and settle back. See cardPressAnimation.js for what actually
   happens; this setting only decides WHETHER it happens.

   It is a display preference and nothing more. Turning it off changes no
   behaviour: the word still reaches the sentence bar on the same line of
   code, at the same moment, and is still spoken. The animation has always
   been feedback about something that has ALREADY happened, so removing it
   cannot remove the thing it was reporting.

   ON is the default because the movement is what tells a child WHICH card
   answered their tap -- valuable when a grid holds thirty near-identical
   tiles. But it is genuinely optional: motion is distracting or nauseating
   for some children, and for a child with a visual processing difficulty a
   card that leaves its place can be harder to track, not easier. Some
   caregivers also simply want the board to feel instant.

   Kept as an option list rather than a boolean so the settings panel renders
   it with the same row/chooser markup as every other setting, with no new UI
   code -- the same reason Text Size and Voice needed none.
   ------------------------------------------------------------------------- */
export const ANIMATIONS = [
  {
    id: 'on',
    label: 'On',
    description: 'Cards zoom when tapped',
  },
  {
    id: 'off',
    label: 'Off',
    description: 'Cards respond instantly',
  },
]

export const DEFAULT_ANIMATION = 'on'

const ANIMATION_STORAGE_KEY = 'buddytalk.animation'

export function getAnimation(id) {
  return (
    ANIMATIONS.find((a) => a.id === id) || ANIMATIONS.find((a) => a.id === DEFAULT_ANIMATION)
  )
}

export function loadAnimation() {
  try {
    const saved = window.localStorage.getItem(ANIMATION_STORAGE_KEY)
    if (saved && ANIMATIONS.some((a) => a.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_ANIMATION
}

export function saveAnimation(id) {
  try {
    window.localStorage.setItem(ANIMATION_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}

/*
 * Whether anyone has ever chosen this setting on this device.
 *
 * loadAnimation() cannot answer this -- it returns 'on' both for "the user
 * chose On" and for "nobody has touched it", which are different situations
 * once the operating system's reduced-motion preference is involved. This
 * distinguishes them without changing loadAnimation()'s contract.
 */
export function hasAnimationChoice() {
  try {
    const saved = window.localStorage.getItem(ANIMATION_STORAGE_KEY)
    return Boolean(saved) && ANIMATIONS.some((a) => a.id === saved)
  } catch {
    return false
  }
}

/*
 * Whether the animation should ACTUALLY play right now.
 *
 * Two things have to agree: the app setting, and the operating system's
 * reduced-motion preference. A child or caregiver who has told their device
 * they do not want motion -- often because it triggers nausea, dizziness or
 * a vestibular disorder -- has made a health decision, and an app setting
 * left at its default should not override it.
 *
 * So the OS wins when it asks for less motion. Deliberately NOT a hard veto:
 * if someone explicitly turns Animation on in this app while reduced motion
 * is set at the OS level, that is a clear, specific instruction about this
 * one app and it is honoured. What reduced motion overrides is the DEFAULT,
 * which is the setting nobody chose.
 *
 * Read at tap time rather than stored, so changing the OS preference takes
 * effect on the very next tap with no refresh.
 */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    /* matchMedia missing (very old browsers, some test environments) means
       no stated preference, which is not the same as asking for motion. */
    return false
  }
}

export function shouldAnimateCards(animationId, hasExplicitChoice) {
  if (animationId === 'off') return false
  if (prefersReducedMotion() && !hasExplicitChoice) return false
  return true
}

/* -------------------------------------------------------------------------
   NAVIGATION POSITION

   Which side of the board the navigation rail -- Keyboard, Core Words, Up,
   Down, Alert, Settings -- sits on.

   It exists for the same reason Card Position does: reach. A child who uses
   their left hand, or whose chair puts the tablet off to one side, may not be
   able to reach controls pinned to the right. Moving the whole rail is the
   difference between operating the board independently and needing someone
   else to press Settings or Core Words.

   This moves the RAIL ITSELF, not a mirrored copy of the buttons. The board
   and the rail are siblings in a flex row, so reversing that row genuinely
   swaps them and the board's available width is recomputed by layout -- which
   is what makes Card Position keep working: Center still means "centred in
   whatever space is left beside the rail", wherever the rail now is.

   Right is the default, so an untouched install is unchanged.
   ------------------------------------------------------------------------- */
export const NAV_POSITIONS = [
  {
    id: 'right',
    label: 'Right',
    description: 'Buttons on the right side',
  },
  {
    id: 'left',
    label: 'Left',
    description: 'Buttons on the left side',
  },
]

export const DEFAULT_NAV_POSITION = 'right'

const NAV_POSITION_STORAGE_KEY = 'buddytalk.navPosition'

export function getNavPosition(id) {
  return (
    NAV_POSITIONS.find((p) => p.id === id) ||
    NAV_POSITIONS.find((p) => p.id === DEFAULT_NAV_POSITION)
  )
}

export function loadNavPosition() {
  try {
    const saved = window.localStorage.getItem(NAV_POSITION_STORAGE_KEY)
    if (saved && NAV_POSITIONS.some((p) => p.id === saved)) return saved
  } catch {
    // Storage unavailable -- fall through to the default.
  }
  return DEFAULT_NAV_POSITION
}

export function saveNavPosition(id) {
  try {
    window.localStorage.setItem(NAV_POSITION_STORAGE_KEY, id)
  } catch {
    // Saving failed; the choice still applies for this session.
  }
}
