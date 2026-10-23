/*
 * storage.js
 * ----------
 * Where an uploaded file's BYTES actually live, as one small abstraction with
 * three implementations: local disk (the original behaviour, and the
 * default whenever neither cloud option is configured), AWS S3, and
 * Cloudflare R2 (both S3-compatible object storage, for a real deployment).
 *
 * uploads.js is UNCHANGED in what it does -- multipart parsing, magic-byte
 * sniffing, size limits, filename generation -- all of that stays exactly as
 * it was. Only the two lines that used to call fs.writeFile/fs.unlink now
 * call this module's put()/remove() instead, so the rest of the app (every
 * route, every card, every card's imageUrl) is unaffected by which one is
 * active.
 *
 * WHY A FALLBACK TO LOCAL DISK RATHER THAN REQUIRING CLOUD STORAGE
 * ------------------------------------------------------------------
 * `npm run dev` must keep working with no setup for anyone who has not
 * created a bucket yet -- exactly like Gemini/ElevenLabs/etc. already
 * degrade gracefully rather than crash when unconfigured. isConfigured()
 * below is checked once at module load; nothing here throws for a missing
 * credential, it simply serves from disk instead.
 *
 * WHY S3 TAKES PRIORITY OVER R2
 * -------------------------------
 * This project's built-in card picture library already lives in AWS S3
 * (CARD_IMAGE_BASE_URL in boardData.js), so when AWS credentials are present
 * caregiver uploads join that same cloud rather than splitting storage
 * across two providers for no reason. R2 is checked second, purely so an
 * existing R2 setup from before this project standardised on AWS keeps
 * working without anyone having to remove it.
 *
 * WHAT DOES NOT CHANGE
 * ---------------------
 * The URL shape stored on a card (`imageUrl`/`audioUrl`) is UNCHANGED:
 * still root-relative, e.g. "/uploads/<childProfileId>/<file>". Whether that
 * path is actually served from local disk, S3, or R2 is decided entirely by
 * THIS module and the GET /uploads/... route in server.js -- nothing in
 * MongoDB, boardApi.js, or any card document needs to know or change. That
 * is what makes this swap possible without touching existing cards (see the
 * CANNOT-MIGRATE-BLINDLY note in server.js's upload routes).
 */

const fs = require("fs/promises");
const path = require("path");

const UPLOAD_ROOT = path.join(__dirname, "uploads");

/*
 * AWS S3 CONFIGURATION
 * ----------------------
 * All three must be set for S3 to be used; any missing one falls through to
 * R2, then to local disk (see activeProvider() below).
 *
 *   AWS_ACCESS_KEY_ID       IAM user's access key id
 *   AWS_SECRET_ACCESS_KEY   IAM user's secret access key
 *   AWS_S3_UPLOADS_BUCKET   the bucket caregiver uploads are written to --
 *                           deliberately a SEPARATE variable from
 *                           CARD_IMAGE_BASE_URL (boardData.js), since that
 *                           one names a public read-only URL for the
 *                           built-in library, not a bucket this process can
 *                           write to.
 *   AWS_REGION              defaults to the same region the existing S3
 *                           library already uses, since both are
 *                           realistically the same AWS account/region
 */
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_UPLOADS_BUCKET = process.env.AWS_S3_UPLOADS_BUCKET;
const AWS_REGION = process.env.AWS_REGION || "ap-south-1";

function isS3Configured() {
    return Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && AWS_S3_UPLOADS_BUCKET);
}

/*
 * R2 CONFIGURATION
 * -----------------
 * All four must be set for R2 to be used; any missing one falls back to
 * local disk (see activeProvider() below). Read once at module load, exactly
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

function isR2Configured() {
    return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}

/*
 * Which cloud provider (if any) is actually configured, checked once per
 * call rather than cached, so the answer can never go stale across the
 * retried-client pattern below. "s3" wins when both happen to be set -- see
 * the file-level comment for why.
 */
function activeProvider() {
    if (isS3Configured()) return "s3";
    if (isR2Configured()) return "r2";
    return null;
}

/* Kept for external callers (server.js logs at startup) that only need to
   know whether SOME cloud backend is active, not which one. */
function isConfigured() {
    return activeProvider() !== null;
}

/*
 * The S3-compatible client is created lazily, and only once PER PROVIDER, so
 * requiring this module never touches the network and never fails just
 * because @aws-sdk/client-s3 is present but neither provider is configured
 * (e.g. local dev with no cloud env vars at all).
 */
let s3Client = null;
let r2Client = null;

function getS3Client() {
    if (s3Client) return s3Client;
    const { S3Client } = require("@aws-sdk/client-s3");
    s3Client = new S3Client({
        region: AWS_REGION,
        credentials: {
            accessKeyId: AWS_ACCESS_KEY_ID,
            secretAccessKey: AWS_SECRET_ACCESS_KEY
        }
    });
    return s3Client;
}

function getR2Client() {
    if (r2Client) return r2Client;
    const { S3Client } = require("@aws-sdk/client-s3");
    r2Client = new S3Client({
        region: "auto",
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY
        }
    });
    return r2Client;
}

/* Resolves which client + bucket a cloud call should use, for whichever
   provider is currently active. Throws if called with neither configured --
   every call site below only reaches this after checking activeProvider(). */
function getClientAndBucket(provider) {
    return provider === "s3"
        ? { client: getS3Client(), bucket: AWS_S3_UPLOADS_BUCKET }
        : { client: getR2Client(), bucket: R2_BUCKET_NAME };
}

/*
 * The cloud object key for a given upload. Mirrors the local-disk relative
 * path exactly (`<childProfileId>/<filename>`), so all three backends are
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
    const provider = activeProvider();

    if (provider) {
        const { PutObjectCommand } = require("@aws-sdk/client-s3");
        const { client, bucket } = getClientAndBucket(provider);
        await client.send(
            new PutObjectCommand({
                Bucket: bucket,
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
    const provider = activeProvider();

    if (provider) {
        const { GetObjectCommand } = require("@aws-sdk/client-s3");
        const { client, bucket } = getClientAndBucket(provider);
        try {
            const result = await client.send(
                new GetObjectCommand({ Bucket: bucket, Key: keyFor(childProfileId, filename) })
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
    const provider = activeProvider();

    if (provider) {
        const { DeleteObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
        const { client, bucket } = getClientAndBucket(provider);
        const key = keyFor(childProfileId, filename);

        /*
         * S3's/R2's DeleteObject both succeed whether or not the key
         * existed, so a HEAD check first is what lets this report true/false
         * the same way the local-disk branch does -- callers (server.js's
         * card-delete route) use this to count how many files were actually
         * removed.
         */
        try {
            await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        } catch (error) {
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) return false;
            throw error;
        }

        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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

/* Human-readable label for the startup log -- "AWS S3" or "Cloudflare R2",
   matching whichever provider activeProvider() actually picked. */
function activeProviderName() {
    const provider = activeProvider();
    if (provider === "s3") return "AWS S3";
    if (provider === "r2") return "Cloudflare R2";
    return "none";
}

module.exports = {
    isConfigured,
    activeProviderName,
    put,
    get,
    remove
};
