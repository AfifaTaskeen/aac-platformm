/*
 * reseedBoard.js
 * --------------
 * Rebuilds a child's board from the image library in frontend/public/cards.
 *
 * WHY THIS EXISTS
 * ---------------
 * Seeding normally happens once, lazily, the first time a child's board is
 * read -- and it deliberately never touches an existing board, so it cannot
 * overwrite a caregiver's edits. That is the right behaviour, and it means
 * there is no way to REPLACE a board that was seeded from an image library
 * which has since been replaced wholesale.
 *
 * This script is that missing operation, kept deliberately separate from the
 * server: it DESTROYS data, so it must be something a person runs on purpose,
 * never something a request can trigger.
 *
 *   node reseedBoard.js --list          show the child profiles
 *   node reseedBoard.js --dry-run       show what would change, change nothing
 *   node reseedBoard.js --child <id>    rebuild one child's board
 *   node reseedBoard.js --all           rebuild every child's board
 *
 * Nothing happens without --dry-run, --child or --all: running it bare prints
 * the usage and exits, so a stray invocation cannot wipe a board.
 */

require("dotenv").config();

const { MongoClient } = require("mongodb");
const { ObjectId } = require("mongodb");
const { scanImageLibrary, seedBoardForChild, CARD_IMAGE_ROOT } = require("./boardData");

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueOf = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1] || null;
};

function usage() {
    console.log(`
Rebuild a child's communication board from ${CARD_IMAGE_ROOT}

  node reseedBoard.js --list             list child profiles
  node reseedBoard.js --dry-run          show what would happen, change nothing
  node reseedBoard.js --child <id>       rebuild ONE child's board
  node reseedBoard.js --all              rebuild EVERY child's board

  --dry-run may be combined with --child or --all.

WARNING: without --dry-run this DELETES the child's existing folders and
cards, including any edits made through Edit Words, and replaces them with
the current image library.
`);
}

async function main() {
    if (args.length === 0) {
        usage();
        process.exit(0);
    }

    const dryRun = hasFlag("--dry-run");

    const client = new MongoClient(process.env.MONGODB_URI, { family: 4 });
    await client.connect();

    // The SAME database the server uses. This script never creates another.
    const db = client.db("BuddyTalk");
    const childProfiles = db.collection("childProfiles");
    const folders = db.collection("folders");
    const cards = db.collection("cards");

    try {
        /* ---- --list ---- */
        if (hasFlag("--list")) {
            const profiles = await childProfiles.find({}).toArray();
            console.log(`\n${profiles.length} child profile(s):\n`);
            for (const profile of profiles) {
                const folderCount = await folders.countDocuments({ childProfileId: profile._id });
                const cardCount = await cards.countDocuments({ childProfileId: profile._id });
                console.log(
                    `  ${profile._id}  ${(profile.childName || "(unnamed)").padEnd(16)}` +
                    `  ${folderCount} folders, ${cardCount} cards`
                );
            }
            console.log("");
            return;
        }

        /* ---- Which profiles are we rebuilding? ---- */
        let targets;

        if (hasFlag("--all")) {
            targets = await childProfiles.find({}).toArray();
        } else if (hasFlag("--child")) {
            const raw = valueOf("--child");
            if (!raw || !ObjectId.isValid(raw)) {
                console.log("--child needs a valid child profile id. Use --list to see them.");
                process.exitCode = 1;
                return;
            }
            const profile = await childProfiles.findOne({ _id: new ObjectId(raw) });
            if (!profile) {
                console.log(`No child profile with id ${raw}. Use --list to see them.`);
                process.exitCode = 1;
                return;
            }
            targets = [profile];
        } else if (dryRun) {
            targets = await childProfiles.find({}).toArray();
        } else {
            usage();
            return;
        }

        /* ---- What does the library hold? ---- */
        const { categories, unclassified, duplicates } = await scanImageLibrary();
        const totalImages = categories.reduce((sum, category) => sum + category.files.length, 0);

        console.log(`\nImage library: ${CARD_IMAGE_ROOT}`);
        console.log(`  ${categories.length} categories, ${totalImages} images classified\n`);
        for (const category of categories) {
            const moved = category.files.filter((f) => f.movedFrom);
            const note = moved.length
                ? `   (+${moved.length} moved from ${[...new Set(moved.map((m) => m.movedFrom))].join(", ")})`
                : "";
            console.log(
                `  ${category.name.padEnd(20)} ${String(category.files.length).padStart(3)} images${note}`
            );
        }

        if (duplicates.length) {
            console.log(`\n  DUPLICATE image paths (skipped): ${duplicates.length}`);
            duplicates.forEach((d) => console.log(`    ${d}`));
        }

        if (unclassified.length) {
            console.log(`\n  UNCLASSIFIED images: ${unclassified.length}`);
            unclassified.forEach((u) => console.log(`    ${u.path}  -- ${u.reason}`));
        }

        console.log(`\n${dryRun ? "DRY RUN -- nothing will be changed" : "REBUILDING"}\n`);

        for (const profile of targets) {
            const before = {
                folders: await folders.countDocuments({ childProfileId: profile._id }),
                cards: await cards.countDocuments({ childProfileId: profile._id })
            };

            console.log(`  ${profile.childName || "(unnamed)"}  (${profile._id})`);
            console.log(`    before: ${before.folders} folders, ${before.cards} cards`);

            if (dryRun) {
                console.log(`    after : ${categories.length} folders, ${totalImages} cards  [not applied]\n`);
                continue;
            }

            /*
             * Delete then insert, both scoped to THIS childProfileId -- so
             * another family's board is untouchable even by this script.
             *
             * Not a transaction: that would need a replica set, and the
             * failure mode is recoverable anyway. If the insert failed after
             * the delete, the board would simply be empty and the next read
             * would lazily re-seed it from the same library.
             */
            const deletedCards = await cards.deleteMany({ childProfileId: profile._id });
            const deletedFolders = await folders.deleteMany({ childProfileId: profile._id });

            const seeded = await seedBoardForChild({ folders, cards }, profile._id);

            console.log(
                `    deleted: ${deletedFolders.deletedCount} folders, ${deletedCards.deletedCount} cards`
            );
            console.log(
                `    created: ${seeded.folders.length} folders, ${seeded.cards.length} cards`
            );

            const coreWords = seeded.cards.filter((card) => card.isCoreWord);
            console.log(
                `    home-screen words: ${coreWords.map((c) => c.word).join(", ") || "(none)"}\n`
            );
        }

        console.log("Done.\n");

    } finally {
        await client.close();
    }
}

main().catch((error) => {
    console.error("Reseed failed:", error.message);
    process.exit(1);
});
