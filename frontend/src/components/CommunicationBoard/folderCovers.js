/*
 * folderCovers.js
 * ---------------
 * The built-in cover picture for each board folder.
 *
 * These are permanent APPLICATION ASSETS, not data:
 *
 *   - they ship inside the app, in frontend/public/cards/
 *   - they are not stored in MongoDB, uploaded, or fetched from the network
 *   - they work offline, on first run, before a caregiver has customised
 *     anything, and in an Android package
 *
 * WHY A LOOKUP RATHER THAN A DATABASE FIELD
 * -----------------------------------------
 * A folder's DEFAULT picture is a property of what the folder IS, not of
 * this particular child's board. Writing it into every folder document would
 * copy the same eleven paths into every family's data, and changing a cover
 * in a later release would then need a migration instead of replacing a file.
 *
 * So MongoDB stores only a CUSTOM cover, when the caregiver has chosen one.
 * `imageUrl: null` means "no custom picture", and the default below is used.
 * That is what makes the priority order work without a schema change.
 *
 * KEYED ON colorKey, NOT THE FOLDER NAME
 * --------------------------------------
 * The name is the caregiver's to change -- one of these folders is currently
 * called "Food & Drnk" after a typo, and renaming it must not silently strip
 * its cover. colorKey is the stable identity assigned at seeding.
 */

/*
 * URLs are built the same way the seeder builds card paths: root-relative,
 * with each segment percent-encoded so spaces and "&" survive.
 *
 * encodeURI rather than encodeURIComponent, deliberately -- the same reason
 * as boardData.js: encodeURIComponent escapes "&" to "%26", and a static
 * file server decodes the path before matching, so "%26" becomes a literal
 * "&" that its parser reads as the start of a query string. The file is then
 * not found and the SPA fallback is served instead, which an <img> renders
 * as nothing. encodeURI leaves "&" alone, which is correct inside a path.
 */
function coverUrl(fileName) {
  return `/cards/${encodeURI(fileName)}`
}

/*
 * colorKey -> the file that ships with the app.
 *
 * Two of these are not named after their folder, because the supplied art is
 * named after what it DEPICTS:
 *
 *   Places          -> Home.jpg  (a house)
 *   Things & Objects -> Bag.jpg  (a backpack)
 *
 * Core Words is deliberately absent: it is not a board tile, and giving it a
 * cover would imply it should be one.
 */
const COVERS = {
  actions: 'Actions.jpg',
  activities: 'Activities.jpg',
  body: 'Body and Health.jpg',
  feelings: 'Feelings.jpg',
  /* The folder is "Food & Drink"; the artwork is simply named Food.jpg. */
  food: 'Food.jpg',
  people: 'People.jpg',
  places: 'Home.jpg',
  things: 'Bag.jpg',
  letters: 'Letters.jpg',
  numbers: 'Numbers.jpg',
}

/*
 * The picture a folder tile should show, in priority order:
 *
 *   1. the caregiver's own image, if they have customised this folder
 *   2. the built-in cover for this folder
 *   3. null -- the caller falls back to the emoji
 *
 * `category` is the object boardApi produces: { id, label, imageUrl, ... }
 * where `id` is the colorKey and `imageUrl` is already origin-corrected for
 * display.
 */
export function folderCoverUrl(category) {
  if (!category) return null

  /* A custom image always wins. It is only ever set when the caregiver has
     actually chosen one, so its presence IS the signal. */
  if (category.imageUrl) return category.imageUrl

  const file = COVERS[category.id]
  return file ? coverUrl(file) : null
}

/* Exported for the verification script, so the test checks the same table
   the app uses rather than a copy of it. */
export const BUILT_IN_COVERS = COVERS
