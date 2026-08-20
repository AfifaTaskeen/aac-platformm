/*
 * syncDefaultCards.js
 * -------------------
 * Brings an EXISTING board back in line with the bundled image library.
 *
 * WHY THIS EXISTS, SEPARATELY FROM THE SEEDER
 * -------------------------------------------
 * seedBoardForChild only ever runs for a child with NO board at all. That is
 * deliberate and correct -- it is what stops a second copy of the board
 * appearing on every login. But it means a child who signed up before an
 * image was added to the library never receives that image, and a card whose
 * picture file was later removed keeps pointing at a file that is no longer
 * there. The card still renders; its picture is simply blank, which on an AAC
 * board is worse than the card being absent, because the child taps a symbol
 * they cannot see and gets no confirmation of what they said.
 *
 * WHY IT IS NOT reseedBoard.js
 * ----------------------------
 * reseedBoard deletes the board and builds it again. That is the right tool
 * for a developer resetting a test account, and the wrong one for a real
 * family: it destroys every edit they have made -- renamed cards, uploaded
 * photographs, their own folders. This tool never deletes anything a person
 * chose.
 *
 * WHAT IT WILL AND WILL NOT TOUCH
 * -------------------------------
 * ADDS     a default card for a library image that has no card yet.
 * REMOVES  a card ONLY when all three are true:
 *            - isDefault is true            (the app created it, not the user)
 *            - its imageUrl is under /cards/ (a bundled asset, not an upload)
 *            - that file no longer exists on disk
 * NEVER    touches a card the caregiver created, renamed, or gave their own
 *          picture to; never deletes an image file; never touches uploads;
 *          never reorders or rewrites a card that is already correct.
 *
 * A renamed default card is left alone on purpose. `word` is the caregiver's
 * to change, and re-imposing the filename's version of it would quietly undo
 * their work every time this ran.
 *
 * IDEMPOTENT: running it twice changes nothing the second time. The report
 * printed on a second run is all zeroes, and that is the check.
 *
 * USAGE
 *   node syncDefaultCards.js --dry-run --all    show what would change
 *   node syncDefaultCards.js --all              apply to every child
 *   node syncDefaultCards.js --child <id>       apply to one child
 */

require("dotenv").config();
const path = require("path");
const fsSync = require("fs");
const { MongoClient } = require("mongodb");

const {
    scanImageLibrary,
    slugify,
    ORDER_STEP,
    CARD_IMAGE_ROOT
} = require("./boardData");

/* ==========================================================================
   ASSET EXISTENCE -- CASE-SENSITIVELY

   fs.existsSync answers the question Windows asks, not the one the browser
   asks. Windows matches file names case-INsensitively, so it happily reports
   that "Emergency/Toilet.jpg" exists when the file is "toilet.jpg". A static
   file server matches case-SENSITIVELY and would return the SPA's index.html
   instead, which an <img> renders as nothing.

   So each path segment is compared against the real directory listing. This
   is the difference between "the check passed" and "the picture appears".
   ========================================================================== */
function existsExact(root, relativePath) {
    const segments = relativePath.split("/").filter(Boolean);
    let current = root;

    for (const segment of segments) {
        let entries;
        try {
            entries = fsSync.readdirSync(current);
        } catch {
            return false;
        }
        if (!entries.includes(segment)) return false;
        current = path.join(current, segment);
    }
    return true;
}

/*
 * The imageUrl stored on a card is a URL, so its segments are
 * percent-encoded ("call%20mom.jpeg"). The filesystem knows nothing about
 * that, so each segment is decoded before it is compared to a real name.
 */
function urlToRelativePath(imageUrl) {
    if (!imageUrl || !imageUrl.startsWith("/cards/")) return null;
    return imageUrl
        .slice("/cards/".length)
        .split("/")
        .map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                /* A malformed escape means this was never a valid path;
                   returning it undecoded lets the existence check fail
                   honestly rather than throwing. */
                return segment;
            }
        })
        .join("/");
}

/* ==========================================================================
   THE SYNC
   ========================================================================== */

async function syncChild(collections, childProfileId, library, options = {}) {
    const { folders, cards } = collections;
    const { dryRun = false } = options;
    const now = new Date();

    const report = { added: [], removed: [], skipped: [] };

    const folderDocs = await folders.find({ childProfileId }).toArray();
    const cardDocs = await cards.find({ childProfileId }).toArray();

    const folderByKey = new Map(folderDocs.map((f) => [f.key, f]));
    const cardByKey = new Map(cardDocs.map((c) => [c.key, c]));

    /* ---- 1. Add cards for library images that have none ---- */
    for (const category of library.categories) {
        const folder = folderByKey.get(category.key);

        /*
         * No folder for this category on this board. That happens if the
         * taxonomy gained a category after this child signed up. Creating the
         * folder here is out of scope -- this tool syncs CARDS -- so it is
         * reported rather than silently skipped, and the operator can reseed
         * that account or add the folder deliberately.
         */
        if (!folder) {
            report.skipped.push({
                reason: "no folder for category",
                category: category.key,
                files: category.files.length
            });
            continue;
        }

        /* Continue the folder's existing order sequence rather than starting
           from zero, so a new card lands at the END of the folder instead of
           on top of the card the child already knows sits first. */
        const existingInFolder = cardDocs.filter(
            (c) => String(c.folderId) === String(folder._id)
        );
        let nextOrder = existingInFolder.length
            ? Math.max(...existingInFolder.map((c) => c.order || 0)) + ORDER_STEP
            : 0;

        for (const file of category.files) {
            const key = `${category.key}-${slugify(file.fileName)}`;
            if (cardByKey.has(key)) continue;

            const doc = {
                childProfileId,
                key,
                word: file.word,
                folderId: folder._id,
                imageUrl: file.imageUrl,
                emoji: null,
                audioUrl: null,
                order: nextOrder,
                /* Home-screen flags are a core-words concern and are already
                   correct on existing boards; a newly added image is never
                   promoted to the home screen automatically. */
                isCoreWord: false,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            };

            nextOrder += ORDER_STEP;
            report.added.push({ key, word: file.word, folder: category.key });

            if (!dryRun) {
                try {
                    await cards.insertOne(doc);
                } catch (error) {
                    /* Another process inserted the same key first. The end
                       state is the one we wanted, so this is not a failure. */
                    if (error.code !== 11000) throw error;
                    report.added.pop();
                }
            }
        }
    }

    /* ---- 2. Remove default cards whose bundled image is gone ---- */
    for (const card of cardDocs) {
        if (!card.isDefault) continue;

        const relative = urlToRelativePath(card.imageUrl);

        /* Not a bundled asset -- an upload, an absolute URL, or no picture at
           all. None of those are this tool's business. */
        if (!relative) continue;

        if (existsExact(CARD_IMAGE_ROOT, relative)) continue;

        report.removed.push({
            key: card.key,
            word: card.word,
            imageUrl: card.imageUrl
        });

        if (!dryRun) {
            /* Matched by _id, so this can only ever affect the one card
               inspected above. The image file itself is bundled application
               content and is never touched. */
            await cards.deleteOne({ _id: card._id });
        }
    }

    return report;
}

/* ==========================================================================
   CLI
   ========================================================================== */

async function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes("--dry-run");
    const all = argv.includes("--all");
    const childIndex = argv.indexOf("--child");
    const childArg = childIndex !== -1 ? argv[childIndex + 1] : null;

    if (!all && !childArg) {
        console.error(
            "Refusing to run without a target.\n\n" +
                "  node syncDefaultCards.js --dry-run --all\n" +
                "  node syncDefaultCards.js --all\n" +
                "  node syncDefaultCards.js --child <childProfileId>\n"
        );
        process.exit(1);
    }

    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();

    try {
        const db = client.db("BuddyTalk");
        const collections = {
            folders: db.collection("folders"),
            cards: db.collection("cards")
        };

        const library = await scanImageLibrary();

        const targets = all
            ? await collections.folders.distinct("childProfileId")
            : [childArg];

        console.log(
            `${dryRun ? "DRY RUN -- no changes written" : "APPLYING CHANGES"}\n` +
                `children: ${targets.length}\n`
        );

        for (const childProfileId of targets) {
            const report = await syncChild(collections, childProfileId, library, {
                dryRun
            });

            console.log(`child ${childProfileId}`);
            console.log(`  added   ${report.added.length}`);
            report.added.forEach((a) =>
                console.log(`     + ${a.folder}: ${JSON.stringify(a.word)}`)
            );
            console.log(`  removed ${report.removed.length}`);
            report.removed.forEach((r) =>
                console.log(`     - ${JSON.stringify(r.word)}  (${r.imageUrl})`)
            );
            report.skipped.forEach((s) =>
                console.log(`  skipped ${s.category}: ${s.reason}`)
            );
            console.log();
        }
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { syncChild, existsExact, urlToRelativePath };
