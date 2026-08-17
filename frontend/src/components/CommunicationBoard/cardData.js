/*
 * cardData.js
 * -----------
 * Every card and folder on the communication board, as plain data.
 *
 * Keeping this separate from the components matters: later, Edit Words needs
 * to add, change and reorder cards. When the board reads from a data
 * structure rather than hard-coded JSX, that feature becomes a change to the
 * DATA, not a rewrite of the screen.
 *
 * IMAGES
 * ------
 * The pictures live in frontend/public/cards/<category>/<name>.jpg, copied
 * from the project's own assets/ folder. Files under public/ are served by
 * Vite at the matching URL and copied into the build untouched -- so `image`
 * below is just a URL string.
 *
 * The alternative, `import dosa from '...jpg'`, would bundle and hash all 25
 * files. That is the right choice for a handful of design assets, but not
 * here: caregivers will eventually upload their own photographs at runtime,
 * and a runtime upload cannot be reached by a build-time import. Plain URLs
 * mean an uploaded photo and a bundled one work the same way.
 */

/*
 * Every card has the same shape:
 *
 *   id       - unique, stable. Used as the React key and, later, as the
 *              handle Edit Words uses to find a card.
 *   label    - what the child sees, and what Speak reads aloud.
 *   category - which folder it belongs to ('basic' for the core words).
 *   image    - URL of the picture, or null for a text-only card.
 *   coreWord - marks a small, frequently used word. Structured now so a
 *              caregiver can flip this flag later; nothing edits it yet.
 */

/* -------------------------------------------------------------------------
   Core words: the small, high-frequency words that carry a sentence.

   These deliberately have no image. They are abstract ("want", "more") and a
   photograph would not make them clearer -- for these, the word itself is the
   clearest symbol. They are visually distinct from picture cards, which also
   helps the child tell the two kinds apart.
   ------------------------------------------------------------------------- */
/*
 * No emoji and no image on these: the project has no picture assets for
 * abstract words like "Want" or "More", and an invented icon would be a
 * guess at meaning rather than a real symbol. The word itself, set large,
 * is the clearest thing to show.
 *
 * All eight share ONE colour (CORE_COLORS below) so they read as a single
 * group, distinct from the colour-coded categories.
 */
/*
 * All eight share ONE colour (CORE_COLORS below) so they read as a single
 * group, distinct from the five colour-coded categories.
 *
 * The emoji are chosen to match how these words are actually signed or
 * gestured, so the picture reinforces the word rather than decorating it:
 * pointing at yourself for "I", pointing outward for "You", open hands for
 * "Want". They are a support for a child who cannot yet read the label --
 * the word itself stays the primary content.
 */
export const BASIC_WORDS = [
  { id: 'basic-i', label: 'I', category: 'basic', image: null, emoji: '🙋', coreWord: true },
  { id: 'basic-you', label: 'You', category: 'basic', image: null, emoji: '👉', coreWord: true },
  { id: 'basic-want', label: 'Want', category: 'basic', image: null, emoji: '🤲', coreWord: true },
  { id: 'basic-need', label: 'Need', category: 'basic', image: null, emoji: '🙏', coreWord: true },
  { id: 'basic-more', label: 'More', category: 'basic', image: null, emoji: '➕', coreWord: true },
  { id: 'basic-like', label: 'Like', category: 'basic', image: null, emoji: '👍', coreWord: true },
  { id: 'basic-no', label: 'No', category: 'basic', image: null, emoji: '🚫', coreWord: true },
  { id: 'basic-yes', label: 'Yes', category: 'basic', image: null, emoji: '✅', coreWord: true },
]

/* -------------------------------------------------------------------------
   The five categories. `color` is only the folder tile's fill -- the label on
   it is always ink on a light surface, never a colour-on-colour combination.
   ------------------------------------------------------------------------- */
/*
 * Each category owns a pastel. Two tones per colour:
 *
 *   tint  - the card's normal background, soft enough that ink text on it
 *           stays far above the contrast minimum
 *   deep  - the same hue darkened, used for the pressed state
 *
 * They are plain hex rather than theme tokens because the theme's colours are
 * mid-tones meant for SHAPES; a card is a large surface carrying text, so it
 * needs a lighter tint of the same hue. The hues themselves are the theme's.
 */
/*
 * Each category owns THREE tones:
 *
 *   tint   - the card's normal background (pale)
 *   deep   - the same hue darkened, for the pressed state
 *   accent - a saturated version used as a coloured band inside the card's
 *            dark border, so the category is readable at a glance even
 *            before the pale fill registers
 *
 * The dark border itself never changes: the accent sits inside it.
 */
export const CATEGORIES = [
  { id: 'food', label: 'Food', tint: '#fff2c9', deep: '#f5cf57', accent: '#9a6f00', emoji: '🍽️' },
  { id: 'actions', label: 'Actions', tint: '#dceeff', deep: '#8fc2ec', accent: '#1f6199', emoji: '🏃' },
  { id: 'feelings', label: 'Feelings', tint: '#ffdde9', deep: '#f7a8bb', accent: '#b0355a', emoji: '😊' },
  { id: 'people', label: 'People', tint: '#dff5d3', deep: '#a3d495', accent: '#2f7a24', emoji: '👨‍👩‍👧' },
  /* Pushed further towards peach/pink than a plain orange, so it stays
     clearly distinct from Food's yellow rather than reading as a shade of
     it -- the two warm categories are the easiest pair to confuse. */
  { id: 'places', label: 'Places', tint: '#ffd8c4', deep: '#f9a58e', accent: '#b4471f', emoji: '🏠' },
]

/*
 * ONE violet for all eight basic words.
 *
 * A neutral grey was tried first and was the wrong call: at deltaE 5.3 from
 * the cream page it barely registered as a card at all, while every category
 * sits at 15-17. This violet is 23.5 from the page, so the group is
 * unmistakable, and 12.9 from its nearest category (Actions), so it is never
 * mistaken for one. Lightening it much further starts to collide with the
 * Actions blue, which is why it stops here.
 *
 * Violet is deliberately outside the five category hues -- these words
 * belong to no category, and the colour says so.
 */
export const CORE_COLORS = { tint: '#e3daf9', deep: '#b49ce8', accent: '#5b3a9e' }

/* Looks up a category's colours, for cards rendered outside their folder. */
export function categoryColors(categoryId) {
  return CATEGORIES.find((c) => c.id === categoryId) || null
}

/*
 * Builds a card from its category and file name, so the 25 entries below stay
 * readable instead of repeating the same URL prefix twenty-five times.
 */
function card(category, name, label, emoji) {
  return {
    id: `${category}-${name}`,
    label,
    category,
    image: `/cards/${category}/${name}.jpg`,
    /*
     * A fallback only. The photograph is what the child sees; this emoji
     * appears solely if that file fails to load, so a missing picture still
     * leaves a recognisable card rather than an empty frame.
     */
    emoji,
    coreWord: false,
  }
}

/* The 25 picture cards, five per category, matching the provided assets. */
export const CARDS = [
  card('food', 'rice', 'Rice', '🍚'),
  card('food', 'dosa', 'Dosa', '🥞'),
  card('food', 'idli', 'Idli', '🍡'),
  card('food', 'puri', 'Puri', '🫓'),
  card('food', 'bread', 'Bread', '🍞'),

  card('actions', 'eat', 'Eat', '🍴'),
  card('actions', 'drink', 'Drink', '🥤'),
  card('actions', 'go', 'Go', '🚶'),
  card('actions', 'play', 'Play', '⚽'),
  card('actions', 'sleep', 'Sleep', '😴'),

  card('feelings', 'happy', 'Happy', '😀'),
  card('feelings', 'sad', 'Sad', '😢'),
  card('feelings', 'angry', 'Angry', '😠'),
  card('feelings', 'scared', 'Scared', '😨'),
  card('feelings', 'tired', 'Tired', '🥱'),

  card('people', 'mother', 'Mother', '👩'),
  card('people', 'father', 'Father', '👨'),
  card('people', 'brother', 'Brother', '👦'),
  card('people', 'sister', 'Sister', '👧'),
  card('people', 'teacher', 'Teacher', '🧑‍🏫'),

  card('places', 'home', 'Home', '🏠'),
  card('places', 'school', 'School', '🏫'),
  card('places', 'park', 'Park', '🌳'),
  card('places', 'hospital', 'Hospital', '🏥'),
  card('places', 'bathroom', 'Bathroom', '🚿'),
]

/* Cards belonging to one folder, in the order they were defined. */
export function cardsInCategory(categoryId) {
  return CARDS.filter((c) => c.category === categoryId)
}

/*
 * Search across everything the child can say -- core words and picture cards
 * alike, in every folder, not just the one currently open.
 *
 * Matches anywhere in the label rather than only the start, so "other" finds
 * "Mother". A child who is still learning to spell is more likely to remember
 * a fragment than an exact opening.
 */
export function searchCards(query) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return [...BASIC_WORDS, ...CARDS].filter((c) => c.label.toLowerCase().includes(q))
}
