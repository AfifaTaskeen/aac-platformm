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
 *   small  +1 column  -> more, smaller cards
 *   medium  0         -> exactly today's layout, unchanged
 *   large  -1 column  -> fewer, larger cards
 */
export const GRID_SIZES = [
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
