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
 *   this file        the DEFAULT set. Read once per child, at seeding.
 *   MongoDB          the SOURCE OF TRUTH from that moment on.
 *   cardData.js      presentation only -- the colours a category is drawn in.
 *
 * After a child is seeded, editing this file changes nothing for them, which
 * is correct: their board is theirs, and a later release must not silently
 * rewrite a board a family has customised.
 *
 * WHAT IS *NOT* STORED PER CHILD
 * ------------------------------
 * Colours. A category's tint/deep/accent are how the app DRAWS a folder, not
 * facts about the child. Copying hex values into 25 documents per child would
 * freeze today's palette into the database and make re-theming a migration
 * instead of a CSS edit. Each folder stores a `colorKey` instead, and the
 * frontend maps that key to colours -- so the palette stays in one place.
 *
 * IMAGES AND AUDIO
 * ----------------
 * Both are stored as REFERENCES (a path or URL), never as bytes. `/cards/food/
 * rice.jpg` is served by Vite from frontend/public today; the same field can
 * hold `https://<bucket>/...` once uploads exist, and nothing else has to
 * change. Binary in a document would bloat every read of the board and hit the
 * 16MB document ceiling; that is what object storage is for.
 */

/* ==========================================================================
   THE DEFAULT BOARD
   ========================================================================== */

/*
 * The five categories.
 *
 * `colorKey` is the stable handle the frontend maps to a palette. It matches
 * the id today, but they are deliberately separate fields: a caregiver may
 * later rename a folder or add "Toys", and the colour it is drawn in is a
 * different decision from what it is called.
 */
const DEFAULT_FOLDERS = [
    { key: "food", name: "Food", emoji: "🍽️", colorKey: "food" },
    { key: "actions", name: "Actions", emoji: "🏃", colorKey: "actions" },
    { key: "feelings", name: "Feelings", emoji: "😊", colorKey: "feelings" },
    { key: "people", name: "People", emoji: "👨‍👩‍👧", colorKey: "people" },
    { key: "places", name: "Places", emoji: "🏠", colorKey: "places" }
];

/*
 * The eight core words.
 *
 * These have no image and no folder: they are abstract ("want", "more"), and
 * a photograph would not make them clearer. `folderKey: null` is what marks a
 * core word -- it belongs to no folder, and that is a fact about the word,
 * not a display choice.
 */
const DEFAULT_CORE_WORDS = [
    { key: "basic-i", text: "I", emoji: "🙋" },
    { key: "basic-you", text: "You", emoji: "👉" },
    { key: "basic-want", text: "Want", emoji: "🤲" },
    { key: "basic-need", text: "Need", emoji: "🙏" },
    { key: "basic-more", text: "More", emoji: "➕" },
    { key: "basic-like", text: "Like", emoji: "👍" },
    { key: "basic-no", text: "No", emoji: "🚫" },
    { key: "basic-yes", text: "Yes", emoji: "✅" }
];

/*
 * The 25 picture cards, five per folder.
 *
 * The tuple is [folderKey, fileName, text, emoji]. The emoji is a FALLBACK
 * only -- the photograph is what the child sees, and the emoji appears just
 * if that file fails to load, so a missing picture still leaves a
 * recognisable card rather than an empty frame.
 */
const DEFAULT_PICTURE_CARDS = [
    ["food", "rice", "Rice", "🍚"],
    ["food", "dosa", "Dosa", "🥞"],
    ["food", "idli", "Idli", "🍡"],
    ["food", "puri", "Puri", "🫓"],
    ["food", "bread", "Bread", "🍞"],

    ["actions", "eat", "Eat", "🍴"],
    ["actions", "drink", "Drink", "🥤"],
    ["actions", "go", "Go", "🚶"],
    ["actions", "play", "Play", "⚽"],
    ["actions", "sleep", "Sleep", "😴"],

    ["feelings", "happy", "Happy", "😀"],
    ["feelings", "sad", "Sad", "😢"],
    ["feelings", "angry", "Angry", "😠"],
    ["feelings", "scared", "Scared", "😨"],
    ["feelings", "tired", "Tired", "🥱"],

    ["people", "mother", "Mother", "👩"],
    ["people", "father", "Father", "👨"],
    ["people", "brother", "Brother", "👦"],
    ["people", "sister", "Sister", "👧"],
    ["people", "teacher", "Teacher", "🧑‍🏫"],

    ["places", "home", "Home", "🏠"],
    ["places", "school", "School", "🏫"],
    ["places", "park", "Park", "🌳"],
    ["places", "hospital", "Hospital", "🏥"],
    ["places", "bathroom", "Bathroom", "🚿"]
];

/*
 * Where the default pictures live.
 *
 * A ROOT-RELATIVE path, not an absolute URL: the browser resolves it against
 * whatever origin is serving the app, so the same value works on Vite's dev
 * server and on the deployed domain with no rewriting. Hard-coding
 * "http://localhost:5173" here would break the moment the app is deployed --
 * and would be written into every seeded document, where it would be a
 * migration to undo.
 */
function defaultImagePath(folderKey, fileName) {
    return `/cards/${folderKey}/${fileName}.jpg`;
}

/*
 * How ordering works.
 *
 * `position` is an integer, spaced by 10 rather than 1. Moving a card between
 * two neighbours is then a single write of one document (put it at 15), not a
 * renumbering of everything after it. The gaps are free and they save a
 * transaction later.
 */
const POSITION_STEP = 10;

/* ==========================================================================
   SEEDING

   Called the first time a child's board is requested. Writes the default set
   into MongoDB, associated with that childProfileId.
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
 *   2. It only ever INSERTS. There is no update and no delete in this
 *      function, so it cannot overwrite an edited card even if called by
 *      mistake.
 *
 *   3. Folders are inserted first, because each card stores the ObjectId of
 *      its folder. Referring to the folder by its real _id -- rather than
 *      repeating the string "food" -- is what lets a caregiver rename a
 *      folder without every card inside it becoming an orphan.
 *
 * Returns { folders, cards } as they were written, so the caller can respond
 * without a second read.
 */
async function seedBoardForChild(collections, childProfileId) {
    const { folders, cards } = collections;
    const now = new Date();

    /* ---- 1. Folders ---- */
    const folderDocs = DEFAULT_FOLDERS.map((folder, index) => ({
        childProfileId,
        /*
         * `key` is the stable identity of a DEFAULT item, unique per child.
         * It is what makes seeding idempotent (the unique index below keys on
         * it) and what lets a future release recognise "this is still the
         * stock Food folder". A caregiver's own folder gets a generated key,
         * so the two never collide.
         */
        key: folder.key,
        name: folder.name,
        emoji: folder.emoji,
        colorKey: folder.colorKey,
        /* No custom icon image yet -- the emoji is the icon. The field exists
           now so an uploaded folder icon has somewhere to go. */
        imageUrl: null,
        position: index * POSITION_STEP,
        isDefault: true,
        createdAt: now,
        updatedAt: now
    }));

    await folders.insertMany(folderDocs, { ordered: true });

    /* Map each folder's key to the _id MongoDB just assigned, so the cards
       below can point at the real document. */
    const folderIdByKey = new Map(folderDocs.map((doc) => [doc.key, doc._id]));

    /* ---- 2. Core words ---- */
    const coreDocs = DEFAULT_CORE_WORDS.map((word, index) => ({
        childProfileId,
        key: word.key,
        text: word.text,
        /* Core words belong to no folder. null is the marker -- see the note
           on DEFAULT_CORE_WORDS above. */
        folderId: null,
        imageUrl: null,
        emoji: word.emoji,
        /* Reserved for a caregiver's own recording of this word. Nothing
           writes it yet; it exists so adding recording later is a route, not
           a schema change plus a backfill. */
        audioUrl: null,
        position: index * POSITION_STEP,
        isCoreWord: true,
        isDefault: true,
        createdAt: now,
        updatedAt: now
    }));

    /* ---- 3. Picture cards ---- */
    /* Position restarts at 0 inside each folder, so a card's position is its
       place among its siblings rather than a number that only makes sense
       against the whole board. */
    const positionInFolder = new Map();

    const pictureDocs = DEFAULT_PICTURE_CARDS.map(([folderKey, fileName, text, emoji]) => {
        const nextIndex = positionInFolder.get(folderKey) ?? 0;
        positionInFolder.set(folderKey, nextIndex + 1);

        return {
            childProfileId,
            key: `${folderKey}-${fileName}`,
            text,
            folderId: folderIdByKey.get(folderKey),
            imageUrl: defaultImagePath(folderKey, fileName),
            emoji,
            audioUrl: null,
            position: nextIndex * POSITION_STEP,
            isCoreWord: false,
            isDefault: true,
            createdAt: now,
            updatedAt: now
        };
    });

    const cardDocs = [...coreDocs, ...pictureDocs];
    await cards.insertMany(cardDocs, { ordered: true });

    return { folders: folderDocs, cards: cardDocs };
}

module.exports = {
    DEFAULT_FOLDERS,
    DEFAULT_CORE_WORDS,
    DEFAULT_PICTURE_CARDS,
    POSITION_STEP,
    seedBoardForChild
};
