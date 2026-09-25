/*
 * storage.js
 * ----------
 * Where an uploaded file's BYTES actually live, as one small abstraction with
 * two implementations: local disk (the original behaviour, and the default
 * whenever cloud storage is not configured) and Cloudflare R2 (S3-compatible
 * object storage, for a real deployment).
 *
 * uploads.js is UNCHANGED in what it does -- multipart parsing, magic-byte
 * sniffing, size limits, filename generation -- all of that stays exactly as
 * it was. Only the two lines that used to call fs.writeFile/fs.unlink now
 * call this module's put()/remove() instead, so the rest of the app (every
 * route, every card, every card's imageUrl) is unaffected by which one is
 * active.
 *
 * WHY A FALLBACK TO LOCAL DISK RATHER THAN REQUIRING R2
 * ------------------------------------------------------
 * `npm run dev` must keep working with no setup for anyone who has not
 * created an R2 bucket yet -- exactly like Gemini/ElevenLabs/etc. already
 * degrade gracefully rather than crash when unconfigured. isConfigured()
 * below is checked once at module load; nothing here throws for a missing
 * credential, it simply serves from disk instead.
 *
 * WHAT DOES NOT CHANGE
 * ---------------------
 * The URL shape stored on a card (`imageUrl`/`audioUrl`) is UNCHANGED:
 * still root-relative, e.g. "/uploads/<childProfileId>/<file>". Whether that
 * path is actually served from local disk or proxied from R2 is decided
 * entirely by THIS module and the GET /uploads/... route in server.js --
 * nothing in MongoDB, boardApi.js, or any card document needs to know or
 * change. That is what makes this swap possible without touching existing
 * cards (see the CANNOT-MIGRATE-BLINDLY note in server.js's upload routes).
 */

const fs = require("fs/promises");
const path = require("path");

const UPLOAD_ROOT = path.join(__dirname, "uploads");

/*
 * R2 CONFIGURATION
 * -----------------
 * All four must be set for R2 to be used; any missing one falls back to
 * local disk (see isConfigured() below). Read once at module load, exactly
 * like geminiTts.js/tts.js read their own provider's env vars -- never
 * hard-coded, never sent to the frontend.
 *
 *   R2_ACCOUNT_ID          Cloudflare account id (part of the R2 endpoint URL)
 *   R2_ACCESS_KEY_ID       R2 API token's access key id
 *   R2_SECRET_ACCESS_KEY   R2 API token's secret access key
 *   R2_BUCKET_NAME         the bucket uploads are written to
 */
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

function isConfigured() {
    return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}

/*
 * The S3 client is created lazily, and only once, so requiring this module
 * never touches the network and never fails just because @aws-sdk/client-s3
 * is present but R2 is not configured (e.g. local dev with no .env values).
 */
let s3Client = null;

function getClient() {
    if (s3Client) return s3Client;

    /* Required only when actually needed -- keeps `npm run dev` with no R2
       env vars from ever loading the SDK at all. */
    const { S3Client } = require("@aws-sdk/client-s3");

    s3Client = new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY
        }
    });

    return s3Client;
}

/*
 * The R2/S3 object key for a given upload. Mirrors the local-disk relative
 * path exactly (`<childProfileId>/<filename>`), so the two backends are
 * interchangeable for the same stored URL.
 */
function keyFor(childProfileId, filename) {
    return `${childProfileId}/${filename}`;
}

/*
 * Writes one file's bytes to whichever backend is configured.
 *
 * Returns nothing -- the caller (uploads.js's save()) already knows the URL
 * to store, because the URL shape does not depend on where the bytes ended
 * up. Throws on failure, same as the fs call it replaces.
 */
async function put(childProfileId, filename, data, contentType) {
    if (isConfigured()) {
        const { PutObjectCommand } = require("@aws-sdk/client-s3");
        const client = getClient();
        await client.send(
            new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: keyFor(childProfileId, filename),
                Body: data,
                ContentType: contentType
            })
        );
        return;
    }

    const folder = path.join(UPLOAD_ROOT, String(childProfileId));
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, filename), data);
}

/*
 * Reads one file's bytes back, for the GET /uploads/... route to serve.
 *
 * Returns { data, contentType } or null when the object/file does not exist
 * -- never throws for a missing file, so the route can answer a plain 404
 * exactly as it did when this was a direct fs.readFile.
 */
async function get(childProfileId, filename) {
    if (isConfigured()) {
        const { GetObjectCommand } = require("@aws-sdk/client-s3");
        const client = getClient();
        try {
            const result = await client.send(
                new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: keyFor(childProfileId, filename) })
            );
            const chunks = [];
            for await (const chunk of result.Body) chunks.push(chunk);
            return { data: Buffer.concat(chunks), contentType: result.ContentType || null };
        } catch (error) {
            if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return null;
            throw error;
        }
    }

    try {
        const data = await fs.readFile(path.join(UPLOAD_ROOT, String(childProfileId), filename));
        return { data, contentType: null };
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

/*
 * Deletes one file. Not an error when it is already gone -- mirrors the
 * original fs.unlink call's ENOENT handling exactly, because a card whose
 * upload was already removed must still delete cleanly (see uploads.js's
 * deleteUploadedMedia, which depends on this).
 *
 * Returns true if something was actually removed, false if it was already
 * absent.
 */
async function remove(childProfileId, filename) {
    if (isConfigured()) {
        const { DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
        const client = getClient();
        const key = keyFor(childProfileId, filename);

        /*
         * R2's DeleteObject (like S3's) succeeds whether or not the key
         * existed, so a HEAD check first is what lets this report true/false
         * the same way the local-disk branch does -- callers (server.js's
         * card-delete route) use this to count how many files were actually
         * removed.
         */
        try {
            await client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
        } catch (error) {
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return false;
            throw error;
        }

        await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
        return true;
    }

    try {
        await fs.unlink(path.join(UPLOAD_ROOT, String(childProfileId), filename));
        return true;
    } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
    }
}

module.exports = {
    isConfigured,
    put,
    get,
    remove
};
