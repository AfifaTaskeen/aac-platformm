/*
 * boardData.js
 * ------------
 * The starting board every new child profile is given, and the code that
 * copies it into MongoDB.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The frontend's cardData.js used to BE the board: the screen imported it and
 * rendered it. That cannot survive a caregiver editing a word, because an
 * import is baked in at build time -- there is nowhere for a change to go.
 *
 * So the roles split:
 *
 *   the image library   the DEFAULT set. Scanned once per child, at seeding.
 *   MongoDB             the SOURCE OF TRUTH from that moment on.
 *   cardData.js         presentation only -- the colours a folder is drawn in.
 *
 * After a child is seeded, changing the image library does nothing for them,
 * which is correct: their board is theirs, and a later release must not
 * silently rewrite a board a family has customised.
 *
 * THE BOARD IS GENERATED, NOT LISTED
 * ----------------------------------
 * There is deliberately no hard-coded list of cards. The board is whatever
 * `frontend/public/cards/` actually contains: one card per image. Adding a
 * picture adds a card to the next child's board with no code change -- and,
 * more importantly, a list here could disagree with the files on disk, which
 * is exactly the breakage this replaced.
 *
 * CLASSIFICATION
 * --------------
 * The AAC taxonomy is FIXED (the eleven folders below), and is not simply
 * "whatever directories exist". A directory maps to a category, and a handful
 * of individual files are reassigned by the OVERRIDES table because their
 * source directory is wrong about what the picture actually shows -- each one
 * verified by looking at the image, not guessed from its name.
 *
 * WHAT IS *NOT* STORED PER CHILD
 * ------------------------------
 * Colours. A folder's tint/deep/accent are how the app DRAWS it, not facts
 * about the child. Copying hex values into every document would freeze
 * today's palette into the database and make re-theming a migration instead
 * of a CSS edit. Each folder stores a `colorKey` instead.
 *
 * IMAGES AND AUDIO
 * ----------------
 * Both are stored as REFERENCES (a path or URL), never as bytes. The same
 * field can hold `https://<bucket>/...` once uploads exist. Binary in a
 * document would bloat every read of the board and hit the 16MB ceiling.
 */

const fs = require("fs/promises");
const path = require("path");

/*
 * Where the shipped pictures live. Resolved from THIS file's location rather
 * than the working directory, so it does not matter what folder the server
 * was started from.
 */
const CARD_IMAGE_ROOT = path.join(__dirname, "..", "frontend", "public", "cards");

const IMAGE_PATTERN = /\.(jpe?g|png|webp|gif|svg)$/i;

/*
 * How ordering works.
 *
 * `order` is an integer, spaced by 10 rather than 1. Moving a card between
 * two neighbours is then a single write of one document (put it at 15), not a
 * renumbering of everything after it. The gaps are free and they save a
 * transaction later.
 */
const ORDER_STEP = 10;

/* ==========================================================================
   THE AAC TAXONOMY

   Eleven categories, fixed. This is the board's structure, independent of how
   the image files happen to be arranged on disk -- so a library that renames
   "body and health" to "Body" still produces the same board.
   ========================================================================== */
const CATEGORIES = [
    { key: "core-words", name: "Core Words", emoji: "💬", colorKey: "core" },
    { key: "actions", name: "Actions", emoji: "🏃", colorKey: "actions" },
    { key: "activities", name: "Activities", emoji: "🎨", colorKey: "activities" },
    { key: "body-health", name: "Body & Health", emoji: "🩺", colorKey: "body" },
    { key: "feelings", name: "Feelings", emoji: "😊", colorKey: "feelings" },
    { key: "food-drink", name: "Food & Drink", emoji: "🍎", colorKey: "food" },
    { key: "people", name: "People", emoji: "👨‍👩‍👧", colorKey: "people" },
    { key: "places", name: "Places", emoji: "🏠", colorKey: "places" },
    { key: "things-objects", name: "Things & Objects", emoji: "🎒", colorKey: "things" },
    { key: "letters", name: "Letters", emoji: "🔤", colorKey: "letters" },
    { key: "numbers", name: "Numbers", emoji: "🔢", colorKey: "numbers" }
];

/*
 * Which directory feeds which category.
 *
 * Matched case-insensitively against the directory name, so "body and
 * health", "Body And Health" and "Body & Health" all land in body-health.
 * A directory matching nothing is reported rather than silently dropped.
 */
const DIRECTORY_TO_CATEGORY = [
    [/^core\s*words?$/i, "core-words"],
    [/^actions?$/i, "actions"],
    [/^activit(y|ies)$/i, "activities"],
    [/^body\s*(and|&)?\s*health$/i, "body-health"],
    [/^feelings?$/i, "feelings"],
    [/^food\s*(and|&)?\s*drinks?$/i, "food-drink"],
    [/^people$/i, "people"],
    [/^places?$/i, "places"],
    [/^things?\s*(and|&)?\s*objects?$/i, "things-objects"],
    [/^letters?$/i, "letters"],
    [/^numbers?$/i, "numbers"]
];

/* ==========================================================================
   PER-FILE OVERRIDES

   A few images sit in the wrong directory. Each entry below was decided by
   OPENING the image and looking at it -- never by reading its filename, which
   is exactly what would have got these wrong.

   Keyed on "<directory>/<file>" so an override is unambiguous, and applied
   only when that exact file exists. If the library is corrected upstream, a
   stale entry here simply never matches.
   ========================================================================== */
const OVERRIDES = {
    /*
     * A photograph of a human ear. Filed under Feelings, but it is a body
     * part -- and "body-health" already holds 03_ears.jpg, so this is the
     * second ear image, not the only one.
     */
    "Feelings/ears.jpg": { category: "body-health", word: "Ear" },

    /*
     * A child holding an injured, bleeding knee. An injury belongs with
     * health, not with the emotions.
     */
    "Feelings/hurt.jpg": { category: "body-health", word: "Hurt" },

    /*
     * A person making an "OK" gesture -- the sign for YES. That is core
     * vocabulary, not an emotion. Core Words already has 08_yes.jpg, so this
     * one is given a distinct word to keep the two tellable apart.
     */
    "Feelings/yes.jpg": { category: "core-words", word: "Yes (OK sign)" },

    /*
     * Genuinely a feeling (a person overheating), so the category is right --
     * but it duplicates 14_hot.jpg. Renamed so the two cards are
     * distinguishable rather than two identical-looking "Hot"s.
     */
    "Feelings/hot.jpg": { word: "Feeling hot" }
};

/* ==========================================================================
   LABELS
   ========================================================================== */

/*
 * Words that need a specific label the generic rules cannot produce:
 * apostrophes, capitalisation, or a name the filename mangles.
 *
 * Keyed on the file's stem, lower-cased and stripped of its numeric prefix.
 */
const WORD_OVERRIDES = {
    dont_like: "Don't like",
    doctor_s_office: "Doctor's office",
    "doctor_s office": "Doctor's office",
    icecream: "Ice cream",
    bro: "Brother",
    dad: "Dad",
    mom: "Mom",
    tv: "TV",
    i: "I"
};

/*
 * Turns a file name into the word shown on the card.
 *
 *   "01_i.jpg"              -> "I"
 *   "07_dont_like.jpg"      -> "Don't like"
 *   "wake up.jpeg"          -> "Wake up"
 *   "Go to Playground.jpeg" -> "Go to Playground"
 *   "A.jpeg"                -> "A"
 *
 * A sensible default only -- Edit Words exists for the ones this gets
 * slightly wrong.
 */
function wordFromFileName(fileName) {
    const stem = fileName.replace(IMAGE_PATTERN, "");

    /* Strip a leading "01_" style ordering prefix, which is library
       bookkeeping rather than part of the word. */
    const withoutPrefix = stem.replace(/^\d+[_\-\s]*/, "");

    const lookupKey = withoutPrefix.toLowerCase().replace(/\s+/g, "_");
    if (WORD_OVERRIDES[lookupKey]) {
        return WORD_OVERRIDES[lookupKey];
    }

    const spaced = withoutPrefix.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();

    if (!spaced) {
        return stem;
    }

    /*
     * A single character (a letter card) keeps its own case, upper-cased --
     * "c.png" is the letter C. Everything else gets a capital first letter
     * and keeps the rest as written, so "Watch TV" and "Go to Playground"
     * survive intact.
     */
    if (spaced.length === 1) {
        return spaced.toUpperCase();
    }

    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/*
 * A stable, safe key: lower case, no spaces, no ampersands, no apostrophes.
 * Used by the unique (childProfileId, key) index.
 */
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/'/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/*
 * Builds the URL stored in `imageUrl`.
 *
 * ROOT-RELATIVE, so the browser resolves it against whatever origin serves
 * the app -- the same value works on Vite's dev server and on the deployed
 * domain. Hard-coding an origin would break on deployment and would be
 * written into every document, where it would be a migration to undo.
 *
 * WHY NOT encodeURIComponent
 * --------------------------
 * encodeURIComponent escapes "&" to "%26", and that breaks the picture.
 *
 * A static file server decodes the path BEFORE matching it against the disk.
 * "%26" decodes to a literal "&", which its path parser then reads as the
 * start of a query string -- so "/cards/Food%20%26%20Drink/rice.jpeg" is
 * truncated to "/cards/Food " , matches no file, and falls through to the SPA
 * fallback. The <img> receives an HTML page with status 200 and shows a
 * broken icon. Measured against Vite: %26 returned 1148 bytes of text/html,
 * the raw "&" returned 50913 bytes of image/jpeg.
 *
 * encodeURI is the right tool: it escapes spaces, quotes and other unsafe
 * characters but leaves the sub-delimiters that are legal inside a PATH --
 * including "&" -- alone. Slashes survive too, so the whole relative path can
 * be encoded in one call.
 *
 * "#" and "?" are the two characters that genuinely must not survive in a
 * path, because they really do end it. encodeURI leaves both, so they are
 * escaped explicitly afterwards.
 */
function toImageUrl(directoryName, fileName) {
    const relative = `${directoryName}/${fileName}`;

    return (
        "/cards/" +
        encodeURI(relative)
            .replace(/#/g, "%23")
            .replace(/\?/g, "%3F")
    );
}

/* ==========================================================================
   CORE WORDS

   Core words appear in TWO places, from ONE document each:

     - the home screen, as quick-access cards beside the folder tiles
     - inside the Core Words folder, with all the others

   That is why they are ordinary cards with a real folderId, marked by the
   `isCoreWord` flag rather than by having no folder. A card flagged true is
   rendered in both places; the flag is a display hint, not a second copy.
   Editing such a card changes it everywhere, because there is only one of it.
   ========================================================================== */

/*
 * The five words shown on the home screen, by WORD rather than by filename --
 * so the choice survives the library renaming its files, and reads as the
 * decision it is.
 */
const HOME_SCREEN_WORDS = ["I", "You", "Want", "Need", "Like"];

/* ==========================================================================
   SCANNING THE IMAGE LIBRARY
   ========================================================================== */

/*
 * Reads the library and classifies every image.
 *
 * Returns { categories, unclassified, duplicates } where `categories` is the
 * eleven-entry taxonomy, each with the files assigned to it.
 *
 * Only the TOP level is treated as folders, and only files directly inside
 * them become cards -- the board has one level of folders, so a nested
 * directory has nowhere to render. Any such file is reported as unclassified
 * rather than silently flattened into its parent.
 */
async function scanImageLibrary(root = CARD_IMAGE_ROOT) {
    let entries;

    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
        const wrapped = new Error(`Could not read the image library at ${root}: ${error.message}`);
        wrapped.code = "NO_IMAGE_LIBRARY";
        throw wrapped;
    }

    /* One bucket per category, in taxonomy order. */
    const buckets = new Map(CATEGORIES.map((category) => [category.key, []]));
    const unclassified = [];
    const seenPaths = new Map();
    const duplicates = [];

    const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    for (const directoryName of directories) {
        const match = DIRECTORY_TO_CATEGORY.find(([pattern]) => pattern.test(directoryName.trim()));
        const directoryCategory = match ? match[1] : null;

        const files = (await fs.readdir(path.join(root, directoryName), { withFileTypes: true }))
            .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        for (const fileName of files) {
            const relativePath = `${directoryName}/${fileName}`;

            /* One card per image file, always. */
            if (seenPaths.has(relativePath)) {
                duplicates.push(relativePath);
                continue;
            }
            seenPaths.set(relativePath, true);

            const override = OVERRIDES[relativePath] || {};
            const category = override.category || directoryCategory;

            if (!category) {
                unclassified.push({
                    path: relativePath,
                    reason: `directory "${directoryName}" matches no AAC category`
                });
                continue;
            }

            buckets.get(category).push({
                directoryName,
                fileName,
                relativePath,
                word: override.word || wordFromFileName(fileName),
                imageUrl: toImageUrl(directoryName, fileName),
                /* Recorded so the report can show what was reassigned. */
                movedFrom: override.category ? directoryName : null
            });
        }
    }

    const categories = CATEGORIES.map((category) => ({
        ...category,
        files: buckets.get(category.key)
    }));

    return { categories, unclassified, duplicates };
}

/* ==========================================================================
   SEEDING
   ========================================================================== */

/*
 * Gives one child their starting board.
 *
 * SAFETY -- this is the part that matters, because a bug here duplicates or
 * destroys a family's board:
 *
 *   1. It NEVER touches an existing board. The caller has already checked,
 *      and the unique index on (childProfileId, key) is the database itself
 *      refusing a second copy if two requests race. A duplicate-key error is
 *      therefore not a failure: it means another request seeded first, which
 *      is exactly the outcome we wanted.
 *
 *   2. It only ever INSERTS. There is no update and no delete here, so it
 *      cannot overwrite an edited card even if called by mistake.
 *
 *   3. Folders are inserted first, because each card stores the ObjectId of
 *      its folder. Referring to the folder by its real _id -- rather than by
 *      name -- is what lets a caregiver rename a folder without every card
 *      inside it becoming an orphan.
 *
 * Returns { folders, cards, unclassified, duplicates }.
 */
async function seedBoardForChild(collections, childProfileId, options = {}) {
    const { folders, cards } = collections;
    const now = new Date();

    const { categories, unclassified, duplicates } = await scanImageLibrary(
        options.root || CARD_IMAGE_ROOT
    );

    const totalFiles = categories.reduce((sum, category) => sum + category.files.length, 0);

    if (totalFiles === 0) {
        const error = new Error("The image library contains no usable images.");
        error.code = "NO_IMAGE_LIBRARY";
        throw error;
    }

    /* ---- 1. Folders ---- */
    /* Empty categories are still created: the taxonomy is the board's
       structure, and a missing folder would be more surprising than an empty
       one -- which is also where a caregiver's own cards would go. */
    const folderDocs = categories.map((category, index) => ({
        childProfileId,
        key: category.key,
        name: category.name,
        emoji: category.emoji,
        colorKey: category.colorKey,
        /*
         * The folder TILE's own picture. Deliberately null: a folder image is
         * a separate choice from the cards inside it, and borrowing one of
         * them would misrepresent the folder. The emoji is the tile until a
         * real folder image is chosen.
         */
        imageUrl: null,
        order: index * ORDER_STEP,
        isDefault: true,
        createdAt: now,
        updatedAt: now
    }));

    await folders.insertMany(folderDocs, { ordered: true });

    /* ---- 2. Cards ---- */
    const cardDocs = [];

    categories.forEach((category, categoryIndex) => {
        const folderId = folderDocs[categoryIndex]._id;

        category.files.forEach((file, fileIndex) => {
            /*
             * Home-screen words are matched on the WORD, and only within the
             * core-words folder -- so "Go" in Actions is never mistaken for
             * the core word "Go".
             */
            const isHomeScreenWord =
                category.key === "core-words" && HOME_SCREEN_WORDS.includes(file.word);

            cardDocs.push({
                childProfileId,
                key: `${category.key}-${slugify(file.fileName.replace(IMAGE_PATTERN, ""))}`,
                word: file.word,
                /* Every card belongs to a real folder, INCLUDING core words --
                   which is what lets the Core Words folder open and show all
                   of them, while the flag puts five on the home screen too. */
                folderId,
                imageUrl: file.imageUrl,
                /* The picture is the symbol; there is no per-card emoji in
                   this library. The field stays for a future fallback. */
                emoji: null,
                /* Reserved for a caregiver's own recording. Nothing writes it
                   yet; it exists so adding recording later is a route, not a
                   schema change plus a backfill. */
                audioUrl: null,
                order: fileIndex * ORDER_STEP,
                isCoreWord: isHomeScreenWord,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            });
        });
    });

    await cards.insertMany(cardDocs, { ordered: true });

    return { folders: folderDocs, cards: cardDocs, unclassified, duplicates };
}

module.exports = {
    CARD_IMAGE_ROOT,
    CATEGORIES,
    ORDER_STEP,
    HOME_SCREEN_WORDS,
    OVERRIDES,
    scanImageLibrary,
    wordFromFileName,
    slugify,
    toImageUrl,
    seedBoardForChild
};
