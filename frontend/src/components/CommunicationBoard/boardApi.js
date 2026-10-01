/*
 * boardApi.js
 * -----------
 * Fetches the child's board from the backend, and adapts it to the shape the
 * board components already expect.
 *
 * WHY AN ADAPTER RATHER THAN CHANGING THE COMPONENTS
 * --------------------------------------------------
 * The API speaks the database's language -- `word`, `imageUrl`, `folderId`.
 * The components speak the board's -- `label`, `image`, `category`. Both are
 * reasonable names in their own place, and the mismatch is one line each to
 * translate.
 *
 * Translating HERE, in one function, means CommunicationCard, TopBar and the
 * stylesheet do not change at all. That matters more than it might sound: the
 * card's markup and CSS are the part of this project that has been hardest to
 * get right, and the requirement is that the UI look exactly as it does now.
 * Not touching it is the surest way to satisfy that -- an unchanged file
 * cannot render differently.
 *
 * WHAT IS *NOT* HERE
 * ------------------
 * Colours. The API sends a `colorKey` ("food", "actions"); cardData.js still
 * owns what those look like. That split is deliberate and permanent: the
 * palette is presentation and belongs with the stylesheet, not in 33 database
 * documents per child. It is also why the categories look identical after
 * this change -- the same CATEGORIES array is still what paints them.
 *
 * childProfileId is never sent. The backend derives it from the session
 * cookie; a frontend that could name a child is a frontend that could name
 * SOMEONE ELSE'S child.
 */

import { API_BASE_URL } from '../AccountScreen/authConfig'

/*
 * Turns a stored media reference into a URL the browser can actually load.
 *
 * THE TWO KINDS OF MEDIA LIVE ON DIFFERENT ORIGINS.
 *
 *   /cards/...    the built-in library, in frontend/public -- served by the
 *                 FRONTEND, so it is already on the page's own origin
 *   /uploads/...  a caregiver's own picture or recording -- served by the
 *                 BACKEND, which in development is a different port
 *
 * Both are stored root-relative, which is right for the database: it keeps
 * the record free of any hostname, so the same document works in development
 * and in production. But a root-relative URL in an <img> is resolved against
 * the PAGE's origin, so "/uploads/x.jpg" asked the frontend dev server for a
 * path it does not have. Vite answered with its SPA fallback -- index.html,
 * 200, text/html -- and the <img> silently rendered nothing. That is exactly
 * a blank picture area on a card whose data is perfectly correct.
 *
 * Prefixing only the /uploads/ paths with the API's origin fixes it without
 * touching the database and without affecting the 163 built-in images, whose
 * URLs are left exactly as they are.
 *
 * In production, where the API is usually served from the same origin,
 * API_BASE_URL is either empty or that same origin, so this is a no-op.
 */
function toMediaUrl(stored) {
  if (!stored) return stored

  /* An absolute URL (object storage, later) is already complete. */
  if (/^https?:\/\//i.test(stored)) return stored

  /* Uploads live on the API. Everything else is on this origin already. */
  if (stored.startsWith('/uploads/')) return `${API_BASE_URL}${stored}`

  return stored
}

/*
 * The inverse: turns a displayable URL back into what belongs in the database.
 *
 * Necessary because toMediaUrl() puts the API's origin on upload paths for
 * display, and that origin must NOT be written back to MongoDB -- a stored
 * "http://localhost:5000/uploads/x.jpg" would be correct on this machine and
 * broken everywhere else, including production. The database keeps the
 * root-relative form, which is portable.
 */
export function toStoredUrl(displayed) {
  if (!displayed) return displayed

  if (API_BASE_URL && displayed.startsWith(`${API_BASE_URL}/uploads/`)) {
    return displayed.slice(API_BASE_URL.length)
  }

  return displayed
}

/*
 * Turns one API card into the object a card component renders.
 *
 * The field names on the left are what the components read today; the ones on
 * the right are what the database stores. This function is the only place the
 * two vocabularies meet.
 */
function toCard(apiCard, categoryIdByFolderId) {
  return {
    id: apiCard.id,
    label: apiCard.word,
    /*
     * The components identify a category by its palette key, because that is
     * what looks up the colours. The API gives a folder ObjectId, so it is
     * resolved through the folder list into the same key the palette uses.
     *
     * 'basic' is the fallback for a card in no folder at all. A CORE WORD is
     * no longer that case: core words live in the Core Words folder like any
     * other card, and are marked by `coreWord` below rather than by having no
     * folder. Keeping the real key here is what lets the Core Words folder
     * open and show all of them.
     */
    category: apiCard.folderId ? categoryIdByFolderId.get(apiCard.folderId) ?? 'basic' : 'basic',
    image: toMediaUrl(apiCard.imageUrl),
    emoji: apiCard.emoji,
    coreWord: Boolean(apiCard.isCoreWord),
    /*
     * Carried through untouched, unused by the UI today. Edit Words will need
     * both -- the folder to move a card between folders, the audio to play a
     * caregiver's recording -- and dropping them here would mean re-fetching
     * to get them back.
     */
    folderId: apiCard.folderId,
    audioUrl: toMediaUrl(apiCard.audioUrl),
  }
}

/*
 * Turns one API folder into the object the board renders as a folder tile.
 *
 * `id` becomes the palette key rather than the ObjectId, because that is what
 * the tile's colours and the card's `category` are matched on. The real
 * database id is kept alongside as `folderId` for Edit Words.
 */
function toCategory(apiFolder) {
  return {
    id: apiFolder.colorKey || apiFolder.id,
    folderId: apiFolder.id,
    label: apiFolder.name,
    emoji: apiFolder.emoji,
    imageUrl: toMediaUrl(apiFolder.imageUrl),
  }
}

/*
 * Loads the board.
 *
 * Returns { basicWords, categories, cardsByCategory } -- already ordered by
 * the backend, which sorts on the `order` field. The frontend deliberately
 * does no sorting of its own: the database is the source of truth for order,
 * and re-sorting here would be a second opinion that could disagree.
 *
 * THROWS on any failure. It never returns a partial or stale board: showing a
 * child a board that is quietly missing words would be worse than showing an
 * error, because nobody would know to fix it. The caller decides what the
 * failure looks like on screen.
 *
 * `signal` lets a caller abort the request -- used to drop the response if the
 * component unmounts, so a slow reply cannot update a screen that has gone.
 */
export async function fetchBoard({ signal } = {}) {
  let response

  try {
    response = await fetch(`${API_BASE_URL}/api/board`, {
      // Sends the session cookie, which is how the backend knows which child.
      credentials: 'include',
      signal,
    })
  } catch (networkError) {
    // fetch() rejects only when the request never completed -- offline, DNS
    // failure, the backend not running. A 404 or 500 is a RESOLVED promise.
    if (networkError.name === 'AbortError') throw networkError
    throw new Error('Could not reach the server. Please check your connection and try again.')
  }

  if (!response.ok) {
    /*
     * Read the backend's own message where there is one: it distinguishes
     * "please sign in" from "create a child profile first", which are
     * different problems with different fixes.
     */
    let message = 'Could not load the board. Please try again.'

    try {
      const problem = await response.json()
      if (problem?.message) message = problem.message
    } catch {
      /* Not JSON -- keep the generic message. */
    }

    const error = new Error(message)
    error.status = response.status
    throw error
  }

  const data = await response.json()

  if (!data?.success || !Array.isArray(data.folders) || !Array.isArray(data.cards)) {
    throw new Error('The server sent an unexpected response. Please try again.')
  }

  const allCategories = data.folders.map(toCategory)

  /* Folder ObjectId -> palette key, so each card can name its category. */
  const categoryIdByFolderId = new Map(
    data.folders.map((folder) => [folder.id, folder.colorKey || folder.id]),
  )

  const allCards = data.cards.map((card) => toCard(card, categoryIdByFolderId))

  /*
   * CORE WORDS IS NOT A FOLDER TILE.
   *
   * It stays a real folder in MongoDB -- its cards keep a real folderId, and
   * nothing is deleted or duplicated -- but it is filtered out of the list
   * the board draws as category tiles, because core words are reached
   * through the quick-access row instead. Showing both would offer the same
   * words in two places on the same screen.
   *
   * `categories` is what the home board renders as tiles. `cardsByCategory`
   * below is still keyed for EVERY folder including this one, so the Core
   * Words group remains openable by anything that asks for it by key -- Edit
   * Words lists it, and its cards stay editable.
   */
  /*
   * SPECIAL-ACCESS FOLDERS.
   *
   * Two folders are real folders in MongoDB -- real documents, real cards,
   * editable like any other -- but are deliberately NOT drawn as tiles on the
   * board. Each has its own dedicated button in the right-hand menu instead:
   *
   *   Core Words  -> the "Core Words" button
   *   Emergency   -> the "Alert" button
   *
   * Emergency is hidden for a specific reason rather than for tidiness: a
   * child who is hurt or frightened should not have to find the right tile
   * among thirteen. One always-visible button is faster and works the same
   * from anywhere on the board.
   *
   * Filtering here, in one place, is what guarantees they cannot appear
   * twice: `categories` (the tiles) excludes them, while `cardsByCategory`
   * below is still keyed for EVERY folder, so their own buttons can open
   * them and Edit Words can still list them.
   */
  const isSpecialAccessFolder = (category) =>
    category.id === 'core' ||
    category.id === 'emergency' ||
    /^core\s*words?$/i.test(category.label || '') ||
    /^emergency$/i.test(category.label || '')

  const categories = allCategories.filter((category) => !isSpecialAccessFolder(category))

  /*
   * Split once, here, rather than filtering on every render. The board asks
   * for "the cards in this folder" each time one is opened; doing the grouping
   * a single time turns that into a lookup.
   */
  /* Keyed for EVERY folder, including Core Words -- which is absent from the
     tile list but whose cards must still be reachable by key. */
  const cardsByCategory = new Map()
  for (const category of allCategories) {
    cardsByCategory.set(category.id, [])
  }

  /*
   * The quick-access words shown on the home screen.
   *
   * A card appears here because it is FLAGGED `coreWord`, not because it has
   * no folder. The two lists therefore OVERLAP by design: a core word is
   * pushed here AND into its folder below, from the same object, so tapping
   * Core Words shows every core word while five of them are also reachable
   * without opening anything.
   *
   * There is one document per card in MongoDB either way -- this is two
   * references to the same card, never a copy. That is what makes editing one
   * update both places.
   */
  const basicWords = []

  for (const card of allCards) {
    if (card.coreWord) {
      basicWords.push(card)
    }

    // A card in no folder, or whose folder was deleted, has nowhere to go.
    // Skipping rather than crashing is belt-and-braces: the backend moves
    // orphaned cards out of a deleted folder itself.
    if (cardsByCategory.has(card.category)) {
      cardsByCategory.get(card.category).push(card)
    }
  }

  /*
   * `categories`    - the folder TILES the home board draws (no Core Words)
   * `allCategories` - every folder including Core Words, for Edit Words,
   *                   which must still be able to browse and edit them
   */
  return { basicWords, categories, allCategories, cardsByCategory }
}

/*
 * Shared handling for a JSON request that changes something.
 *
 * Every write goes through here so they cannot drift apart: the session
 * cookie is always sent, the backend's own message is always preferred over a
 * generic one, and a failure always throws rather than returning something
 * that could be mistaken for success.
 */
async function sendJson(pathname, method, body) {
  let response

  try {
    response = await fetch(`${API_BASE_URL}${pathname}`, {
      method,
      /*
       * A DELETE carries no body, so it declares no Content-Type either --
       * announcing JSON and sending nothing is the kind of small
       * inconsistency that later confuses a proxy or a log.
       */
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      // The session cookie. childProfileId is never sent -- the backend
      // derives it, which is what stops one family reaching another's card.
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (networkError) {
    /*
     * fetch() rejects only when the request never COMPLETED: the machine is
     * offline, the server is down -- or the browser refused to send it,
     * which is what a CORS failure looks like from here.
     *
     * The rejection carries no status and no message worth showing, so the
     * caregiver still sees the plain sentence below. But the original error
     * is logged and attached, because the three causes are indistinguishable
     * in the UI and only the console can tell them apart. A missing PATCH in
     * Access-Control-Allow-Methods presented exactly as "the server is
     * unreachable" while the server was running fine; keeping the cause makes
     * that diagnosable next time instead of a guess.
     */
    console.log(`${method} ${pathname} did not complete:`, networkError)

    const error = new Error(
      'Could not reach the server. Please check your connection and try again.',
    )
    error.cause = networkError
    throw error
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    /* Some errors carry no JSON body. */
  }

  if (!response.ok || !data?.success) {
    const error = new Error(data?.message || 'Could not save your changes. Please try again.')
    error.status = response.status
    // The backend names the offending field, so the form can point at it.
    error.field = data?.field
    throw error
  }

  return data
}

/*
 * Uploads one file and returns the URL to store on a card.
 *
 * Uploading is a SEPARATE step from saving: this returns a url, and the
 * caller only writes it into a card when the caregiver presses Save. So
 * choosing a picture, seeing it, and then cancelling leaves the card exactly
 * as it was.
 *
 * FormData is used rather than JSON because a file is bytes, and base64 in a
 * JSON body would inflate it by a third for no benefit. The browser sets the
 * multipart Content-Type (including its boundary) itself -- setting it by
 * hand here would omit the boundary and the server could not parse the body.
 */
async function uploadFile(kind, file) {
  const body = new FormData()
  body.append('file', file)

  let response

  try {
    response = await fetch(`${API_BASE_URL}/api/uploads/${kind}`, {
      method: 'POST',
      credentials: 'include',
      body,
    })
  } catch (networkError) {
    console.log(`upload ${kind} did not complete:`, networkError)
    throw new Error('Could not reach the server. Please check your connection and try again.')
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    /* Some errors carry no JSON body. */
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || 'Could not upload that file. Please try again.')
  }

  /* Returned for immediate PREVIEW, so it needs the same origin treatment
     as a stored one -- the preview is an <img> on this page. */
  return toMediaUrl(data.url)
}

export const uploadImage = (file) => uploadFile('image', file)
export const uploadAudio = (file) => uploadFile('audio', file)

/*
 * Creates a card, or a folder.
 *
 * childProfileId is never sent: the backend derives it from the session, so
 * a caller cannot create something on another family's board.
 */
export async function createCard(fields) {
  const data = await sendJson('/api/cards', 'POST', fields)
  return data.card
}

export async function createFolder(fields) {
  const data = await sendJson('/api/folders', 'POST', fields)
  return data.folder
}

/* Renames or re-icons an existing folder. Its _id, childProfileId and order
   are untouched -- only the fields passed here change. */
export async function updateFolder(folderId, changes) {
  const data = await sendJson(`/api/folders/${folderId}`, 'PATCH', changes)
  return data.folder
}

/*
 * Deletes one card, or one folder and everything inside it.
 *
 * Both THROW on failure, which is what keeps the UI honest: the caller only
 * removes anything from view after the server has confirmed, so a failed
 * delete leaves the item exactly where it was. No optimistic removal.
 *
 * No childProfileId is sent -- the backend derives it from the session, so
 * one family cannot delete another's card by guessing an id.
 */
export async function deleteCard(cardId) {
  return sendJson(`/api/cards/${cardId}`, 'DELETE')
}

export async function deleteFolder(folderId) {
  return sendJson(`/api/folders/${folderId}`, 'DELETE')
}

/*
 * Saves changes to one card.
 *
 * `changes` carries only the fields being changed -- the backend's PATCH
 * treats an absent field as "leave it alone", so this never overwrites
 * something the caregiver did not touch. In particular `order` is not sent,
 * which is what preserves the card's position.
 *
 * The card's id is the one from MongoDB. No childProfileId is sent, and the
 * backend scopes the update to the signed-in user's child, so a card
 * belonging to another family simply is not found.
 */
export async function updateCard(cardId, changes) {
  const data = await sendJson(`/api/cards/${cardId}`, 'PATCH', changes)
  return data.card
}

/*
 * The pictures a caregiver may choose from.
 *
 * TEMPORARY: today the backend lists the images shipped with the app. The
 * shape returned -- { url, folder, name } -- is what a real gallery will
 * return too, so replacing this later does not change the picker.
 *
 * Returns [] rather than throwing when the list cannot be loaded: not being
 * able to CHANGE a picture should not stop a caregiver fixing a typo in a
 * word, so the rest of the form stays usable.
 */
export async function fetchCardImages({ signal } = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/card-images`, {
      credentials: 'include',
      signal,
    })

    if (!response.ok) return []

    const data = await response.json()
    return Array.isArray(data?.images) ? data.images : []
  } catch (error) {
    if (error.name === 'AbortError') throw error
    return []
  }
}

/*
 * Saves a rearranged card order for the signed-in child.
 *
 * `ids` is the card ids in their new display order. childProfileId is not
 * sent -- the backend derives it from the session, which is what keeps one
 * child's arrangement off another child's board.
 */
export async function saveCardOrder(ids) {
  return sendJson('/api/cards/order', 'PUT', { ids })
}

/* Forgets this child's arrangement, returning them to the default order.
   Only the `order` field changes; no card is deleted. */
export async function resetCardOrder() {
  return sendJson('/api/cards/order', 'DELETE')
}

/*
 * Saves a board setting against the signed-in child's profile.
 *
 * Settings that belong to the CHILD rather than the device go here, so they
 * follow that child to any browser and never leak to a sibling. childProfileId
 * is not sent -- the backend derives it from the session.
 */
export async function saveChildSettings(settings) {
  return sendJson('/api/child-profile/settings', 'PATCH', settings)
}

/*
 * Saves a rearranged FOLDER order for the signed-in child.
 *
 * `ids` is the folder database ids in their new display order -- the
 * `folderId` on each category, not the palette key the tile is rendered with.
 * childProfileId is not sent: the backend derives it from the session.
 */
export async function saveFolderOrder(ids) {
  return sendJson('/api/folders/order', 'PUT', { ids })
}

/* Forgets this child's folder arrangement, restoring the default order.
   No folder is deleted and no card moves. */
export async function resetFolderOrder() {
  return sendJson('/api/folders/order', 'DELETE')
}

/*
 * Saves the HOME SCREEN's mixed card+folder layout for the signed-in child.
 *
 * `items` is [{ type: 'card' | 'folder', id }, ...] in display order. This is
 * the only ordering that can interleave the two, because a card's `order` and
 * a folder's `order` are separate sequences with no shared axis.
 */
export async function saveHomeOrder(items) {
  return sendJson('/api/child-profile/home-order', 'PUT', { items })
}

/* Forgets the mixed layout, returning the home screen to its default
   arrangement. No card or folder is changed. */
export async function resetHomeOrder() {
  return sendJson('/api/child-profile/home-order', 'DELETE')
}

/*
 * SETTINGS PASSWORD
 *
 * A second password, separate from the account login password, that locks
 * the Settings panel. Every call here goes through sendJson, same as every
 * other write above: the session cookie is sent, never the childProfileId,
 * and a failure always throws with the backend's own message so the lock
 * screen can show e.g. "Incorrect Settings Password." rather than a generic
 * error.
 */

/* Whether this account has ever set a Settings Password. */
export async function fetchSettingsPasswordStatus() {
  const data = await sendJson('/api/settings-password/status', 'GET')
  return Boolean(data.exists)
}

/* The lock screen's "Unlock" action. Throws (with the backend's message) on
   a wrong password -- it does not itself remember anything between calls. */
export async function verifySettingsPassword(password) {
  return sendJson('/api/settings-password/verify', 'POST', { password })
}

/* First-time creation, when no Settings Password exists yet. */
export async function setSettingsPassword(password, confirmPassword) {
  return sendJson('/api/settings-password/set', 'POST', { password, confirmPassword })
}

/* Replaces an existing Settings Password; requires the current one. */
export async function changeSettingsPassword(currentPassword, password, confirmPassword) {
  return sendJson('/api/settings-password/change', 'POST', { currentPassword, password, confirmPassword })
}

/* Step 1 of "Forgot Settings Password?" -- returns { captcha } to display. */
export async function requestSettingsPasswordRecoveryChallenge() {
  return sendJson('/api/settings-password/recovery/challenge', 'POST')
}

/* Step 2: checks the CAPTCHA answer. Throws on a wrong/expired code. */
export async function verifySettingsPasswordRecoveryCaptcha(captcha) {
  return sendJson('/api/settings-password/recovery/verify', 'POST', { captcha })
}

/* Step 3: creates the new Settings Password after a successful CAPTCHA. */
export async function resetSettingsPasswordViaRecovery(password, confirmPassword) {
  return sendJson('/api/settings-password/recovery/reset', 'POST', { password, confirmPassword })
}
