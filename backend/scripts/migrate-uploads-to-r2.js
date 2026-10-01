/*
 * migrate-uploads-to-r2.js
 * -------------------------
 * One-time, manual migration of EXISTING local-disk uploads into R2, once
 * R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME are set
 * in backend/.env.
 *
 * DOES NOT RUN AUTOMATICALLY -- nobody has executed it, and it is not called
 * from server.js or any route. Per the explicit instruction that came with
 * it, images are not migrated blindly.
 *
 * WHAT IT DOES
 * ------------
 * Walks backend/uploads/<childProfileId>/<file>, uploads each file to R2 at
 * the SAME key shape storage.js already uses (<childProfileId>/<file>), and
 * verifies the upload before doing anything else. It does NOT delete the
 * local copies -- see --delete-local below -- and does NOT touch MongoDB:
 * every card's imageUrl/audioUrl is already the root-relative
 * "/uploads/<childProfileId>/<file>" form, which resolves through the SAME
 * GET /uploads/... route whether the bytes are on disk or in R2. No document
 * needs to change.
 *
 * USAGE
 *   node scripts/migrate-uploads-to-r2.js --dry-run     list what would move
 *   node scripts/migrate-uploads-to-r2.js                copy to R2, keep local
 *   node scripts/migrate-uploads-to-r2.js --delete-local  copy, then remove
 *                                                          the local copy
 *                                                          ONLY after a
 *                                                          verified upload
 */
require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");

const storage = require("../storage");
/* sniff() is the SAME magic-byte check every live upload already goes
   through (see uploads.js's own handleUpload()) -- reused here rather than
   guessing a MIME type from the file's extension, which is what this
   script used to do and got wrong (e.g. "png" instead of "image/png"). */
const { sniff } = require("../uploads");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

function parseArgs(argv) {
    return {
        dryRun: argv.includes("--dry-run"),
        deleteLocal: argv.includes("--delete-local")
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.dryRun && !storage.isConfigured()) {
        console.error(
            "R2 is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/" +
            "R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME must all be set in " +
            "backend/.env). Nothing to migrate to."
        );
        process.exitCode = 1;
        return;
    }

    let childDirs;
    try {
        childDirs = (await fs.readdir(UPLOAD_ROOT, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch (error) {
        if (error.code === "ENOENT") {
            console.log("No backend/uploads/ directory exists -- nothing to migrate.");
            return;
        }
        throw error;
    }

    let totalFiles = 0;
    let migrated = 0;
    let failed = 0;

    for (const childProfileId of childDirs) {
        const dir = path.join(UPLOAD_ROOT, childProfileId);
        const files = await fs.readdir(dir);

        for (const filename of files) {
            totalFiles++;

            if (args.dryRun) {
                /*
                 * Read and sniff even in dry-run, so the printed Content-Type
                 * is the REAL value a live run would send -- not a guess --
                 * letting this be checked before anything is actually
                 * written to R2.
                 */
                const data = await fs.readFile(path.join(dir, filename));
                const contentType = sniff(data) || "application/octet-stream";
                console.log(`would migrate: ${childProfileId}/${filename}  (Content-Type: ${contentType})`);
                continue;
            }

            try {
                const data = await fs.readFile(path.join(dir, filename));

                /*
                 * The REAL MIME type, from the file's own bytes -- exactly
                 * what handleUpload() already does for every live upload.
                 * A file this script cannot recognise (sniff() returns null)
                 * falls back to a generic binary type rather than aborting
                 * the whole migration over one unexpected file; R2 will
                 * still store and serve it correctly, just without a precise
                 * Content-Type.
                 */
                const contentType = sniff(data) || "application/octet-stream";

                await storage.put(childProfileId, filename, data, contentType);

                /* Verify by reading it back before trusting the copy. */
                const verify = await storage.get(childProfileId, filename);
                if (!verify || verify.data.length !== data.length) {
                    throw new Error("verification read did not match the original file size");
                }

                if (args.deleteLocal) {
                    await fs.unlink(path.join(dir, filename));
                }

                migrated++;
                console.log(`OK   ${childProfileId}/${filename}  (${data.length} bytes)`);
            } catch (error) {
                failed++;
                console.log(`FAIL ${childProfileId}/${filename}: ${error.message}`);
            }
        }
    }

    console.log("");
    console.log(
        args.dryRun
            ? `Dry run only -- ${totalFiles} file(s) found, nothing written.`
            : `Done. ${migrated} migrated, ${failed} failed, out of ${totalFiles} file(s).`
    );

    if (failed) process.exitCode = 1;
}

main();
