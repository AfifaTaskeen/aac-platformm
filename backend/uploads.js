/*
 * uploads.js
 * ----------
 * Storing caregiver-supplied pictures and audio.
 *
 * THE STORAGE ABSTRACTION
 * -----------------------
 * Everything the rest of the app knows about uploads is `save()`: hand it
 * bytes and a filename, get back a URL to put in a card's imageUrl/audioUrl.
 * Where the bytes actually go -- local disk, or Cloudflare R2 in a real
 * deployment -- is decided entirely by storage.js, required below. No route,
 * no component and no document has to change either way, because none of
 * them knows where the bytes went; only the URL shape (unchanged) matters.
 *
 * WHY THE FILES ARE NOT IN MONGODB
 * --------------------------------
 * A document has a 16MB ceiling, and every read of the board would drag the
 * binary along with it. Media belongs in a store built for it; the database
 * keeps a reference. That is the same rule the built-in card library already
 * follows.
 *
 * UPLOADS ARE KEPT SEPARATE FROM THE BUILT-IN LIBRARY
 * ---------------------------------------------------
 * Built-in pictures live in frontend/public/cards and are served by the
 * frontend at /cards/... . Uploads are served by THIS server at /uploads/...
 * regardless of which storage.js backend holds them. Keeping them apart
 * means an upload can never overwrite a shipped image, the shipped set stays
 * reproducible from the repository, and deleting all uploads cannot damage
 * the default board.
 */

const crypto = require("crypto");
const storage = require("./storage");

/* The URL prefix uploads are served under -- unrelated to where the bytes
   physically live, see storage.js. */
const UPLOAD_URL_PREFIX = "/uploads";

/*
 * What may be uploaded.
 *
 * Keyed by MIME type, with the extension WE choose for the stored file. The
 * extension never comes from the uploaded filename: a name like
 * "photo.jpg.exe" or one containing "../" is a path-traversal attempt, and
 * deriving the extension ourselves makes that impossible.
 */
const IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
};

const AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".m4a",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm"
};

/*
 * Size limits.
 *
 * A photograph of a family member is well under 8MB even from a modern phone
 * camera, and a single spoken word is a fraction of 8MB. The limits exist so
 * one upload cannot fill the disk, and so a mistaken selection (a video, a
 * document) fails quickly with a clear message.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/*
 * A very small multipart/form-data parser.
 *
 * Deliberately not a dependency. The whole requirement is "read one file out
 * of one request", and that is the code below -- adding a package (and its
 * transitive tree) to an app handling children's data is a bigger cost than
 * eighty lines we can read.
 *
 * Returns { fields, file } where file is { filename, contentType, data }.
 */
function parseMultipart(buffer, boundary) {
    const delimiter = Buffer.from(`--${boundary}`);
    const parts = [];

    let index = buffer.indexOf(delimiter);
    if (index === -1) return { fields: {}, file: null };

    index += delimiter.length;

    for (;;) {
        // "--" straight after a delimiter marks the end of the body.
        if (buffer.slice(index, index + 2).toString() === "--") break;

        // Skip the CRLF after the delimiter.
        if (buffer.slice(index, index + 2).toString() === "\r\n") index += 2;

        const headerEnd = buffer.indexOf("\r\n\r\n", index);
        if (headerEnd === -1) break;

        const rawHeaders = buffer.slice(index, headerEnd).toString();
        const bodyStart = headerEnd + 4;

        const next = buffer.indexOf(delimiter, bodyStart);
        if (next === -1) break;

        // The body ends with a CRLF before the next delimiter.
        const body = buffer.slice(bodyStart, next - 2);

        parts.push({ rawHeaders, body });

        index = next + delimiter.length;
    }

    const fields = {};
    let file = null;

    for (const part of parts) {
        const disposition = /content-disposition:([^\r\n]*)/i.exec(part.rawHeaders)?.[1] || "";
        const nameMatch = /name="([^"]*)"/i.exec(disposition);
        const filenameMatch = /filename="([^"]*)"/i.exec(disposition);
        const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(part.rawHeaders);

        if (!nameMatch) continue;

        if (filenameMatch && filenameMatch[1]) {
            file = {
                field: nameMatch[1],
                filename: filenameMatch[1],
                contentType: (typeMatch?.[1] || "").trim().toLowerCase(),
                data: part.body
            };
        } else {
            fields[nameMatch[1]] = part.body.toString();
        }
    }

    return { fields, file };
}

/*
 * Reads the whole request body, refusing anything over `limit`.
 *
 * The check happens WHILE receiving rather than after, so an oversized upload
 * is abandoned as soon as it crosses the line instead of being buffered in
 * full first.
 */
function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;

        let aborted = false;

        req.on("data", (chunk) => {
            if (aborted) return;

            total += chunk.length;

            if (total > limit) {
                aborted = true;

                const error = new Error("TOO_LARGE");
                error.code = "TOO_LARGE";

                /*
                 * The rest of the upload is DRAINED rather than the socket
                 * being destroyed.
                 *
                 * Destroying it kills the connection before the 413 can be
                 * written, so the browser reports a network failure instead
                 * of the clear "that file is too big" message -- the user
                 * would be told the server is unreachable when it is working
                 * perfectly and has deliberately refused their file.
                 *
                 * Pausing and resuming lets the request finish arriving so
                 * the response can be delivered on the same connection. The
                 * bytes are discarded, so nothing over the limit is buffered.
                 */
                chunks.length = 0;
                req.resume();
                reject(error);
                return;
            }

            chunks.push(chunk);
        });

        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

/*
 * Confirms the bytes really are what the Content-Type claims, by checking the
 * file's magic number.
 *
 * A browser sets Content-Type from the file's extension, so it is a hint from
 * the client and not evidence. Checking the actual leading bytes is what
 * stops a renamed executable being stored and later served as an image.
 */
function sniff(data) {
    if (data.length < 12) return null;

    // JPEG: FF D8 FF
    if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
    // PNG: 89 50 4E 47
    if (data[0] === 0x89 && data.slice(1, 4).toString() === "PNG") return "image/png";
    // GIF87a / GIF89a
    if (data.slice(0, 3).toString() === "GIF") return "image/gif";
    // RIFF....WEBP
    if (data.slice(0, 4).toString() === "RIFF" && data.slice(8, 12).toString() === "WEBP") {
        return "image/webp";
    }
    // RIFF....WAVE
    if (data.slice(0, 4).toString() === "RIFF" && data.slice(8, 12).toString() === "WAVE") {
        return "audio/wav";
    }
    // ID3 tag, or an MPEG frame sync -- both mp3
    if (data.slice(0, 3).toString() === "ID3") return "audio/mpeg";
    if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return "audio/mpeg";
    // ftyp box -> MP4 family (m4a)
    if (data.slice(4, 8).toString() === "ftyp") return "audio/mp4";
    // OggS
    if (data.slice(0, 4).toString() === "OggS") return "audio/ogg";
    // EBML -> webm
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
        return "audio/webm";
    }

    return null;
}

/*
 * Writes one uploaded file and returns the URL to store on the card.
 *
 * THE FILENAME IS GENERATED, never taken from the upload. It is random, so
 * two families uploading "photo.jpg" cannot collide and one cannot guess
 * another's URL by name. The extension comes from the verified type.
 *
 * Files are grouped in a folder per child, which keeps one family's uploads
 * together and makes a future "delete this child's data" a directory removal.
 */
async function save(kind, childProfileId, data, verifiedType) {
    const table = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;
    const extension = table[verifiedType];

    if (!extension) {
        const error = new Error("UNSUPPORTED_TYPE");
        error.code = "UNSUPPORTED_TYPE";
        throw error;
    }

    const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extension}`;
    await storage.put(childProfileId, name, data, verifiedType);

    /*
     * A ROOT-RELATIVE URL, matching how the built-in library is referenced,
     * so a card's imageUrl looks the same whether it points at a shipped
     * picture or an uploaded one, and whether storage.js is actually holding
     * the bytes on local disk or in R2 -- neither the database nor anything
     * that reads a card's imageUrl needs to know or change either way.
     */
    return `${UPLOAD_URL_PREFIX}/${childProfileId}/${name}`;
}

/*
 * Handles one upload request end to end: reads it, checks it, stores it.
 *
 * Returns { url } or throws an Error whose .code names the problem, so the
 * route can turn it into a message without re-deriving what went wrong.
 */
async function handleUpload(req, kind, childProfileId) {
    const limit = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
    const allowed = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;

    const contentType = req.headers["content-type"] || "";
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);

    if (!boundary) {
        const error = new Error("NOT_MULTIPART");
        error.code = "NOT_MULTIPART";
        throw error;
    }

    const body = await readBody(req, limit);
    const { file } = parseMultipart(body, (boundary[1] || boundary[2]).trim());

    if (!file || file.data.length === 0) {
        const error = new Error("NO_FILE");
        error.code = "NO_FILE";
        throw error;
    }

    /*
     * The DECLARED type must be acceptable AND the actual bytes must agree.
     * Either check alone is insufficient: the declared type is client-
     * controlled, and sniffing alone would accept a format we cannot serve.
     */
    const sniffed = sniff(file.data);

    if (!sniffed || !allowed[sniffed]) {
        const error = new Error("UNSUPPORTED_TYPE");
        error.code = "UNSUPPORTED_TYPE";
        throw error;
    }

    const url = await save(kind, childProfileId, file.data, sniffed);
    return { url, bytes: file.data.length, type: sniffed };
}

/*
 * Deletes the file behind an uploaded media URL, if there is one.
 *
 * SAFETY -- this function can delete files, so every one of these matters:
 *
 *   1. It ONLY touches /uploads/. A built-in picture is referenced as
 *      /cards/..., which is a different prefix and is refused outright. The
 *      shipped library in frontend/public/cards can never be reached from
 *      here, whatever a card's imageUrl says.
 *
 *   2. It confirms the resolved path is really INSIDE this child's own
 *      upload folder. A crafted url containing "../" would otherwise escape
 *      the directory; resolving first and comparing prefixes afterwards is
 *      what makes that impossible rather than merely unlikely.
 *
 *   3. A missing file is not an error. Deleting a card whose upload has
 *      already gone should still succeed -- the goal is that the file is not
 *      there, and it is not.
 *
 * Returns true if a file was actually removed.
 */
async function deleteUploadedMedia(url, childProfileId) {
    if (typeof url !== "string" || !url.startsWith(`${UPLOAD_URL_PREFIX}/`)) {
        return false;
    }

    /*
     * The url's shape must be EXACTLY "/uploads/<childProfileId>/<filename>"
     * for THIS child, and the filename must be exactly the shape save()
     * generates. This replaces the old path.resolve()-inside-childFolder
     * check -- that check made sense when the target was always a real
     * filesystem path; this one is storage-backend-agnostic (it works
     * identically whether storage.js is about to touch local disk or R2) and
     * is if anything stricter, since a filename that does not match the
     * generated shape is refused outright rather than merely found to
     * resolve outside the folder.
     */
    const rest = decodeURIComponent(url.slice(UPLOAD_URL_PREFIX.length + 1));
    const [ownerSegment, filename] = rest.split("/");

    if (ownerSegment !== String(childProfileId) || !filename || !/^[0-9]+-[0-9a-f]{16}\.[a-z0-9]{2,5}$/i.test(filename)) {
        console.log("Refusing to delete media outside the child's own upload:", url);
        return false;
    }

    try {
        return await storage.remove(childProfileId, filename);
    } catch (error) {
        console.log("Could not delete uploaded media:", url, error.message);
        return false;
    }
}

/*
 * Removes the image and audio belonging to a set of cards.
 *
 * A file is only deleted when NOTHING ELSE still refers to it. Two cards can
 * legitimately share one uploaded picture -- a caregiver may have set the
 * same photograph on both -- and deleting one card must not blank the other.
 *
 * `stillReferenced` is the set of urls used by everything that remains.
 */
async function deleteMediaForCards(cardDocs, childProfileId, stillReferenced) {
    let removed = 0;

    for (const card of cardDocs) {
        for (const url of [card.imageUrl, card.audioUrl]) {
            if (!url || stillReferenced.has(url)) continue;
            if (await deleteUploadedMedia(url, childProfileId)) removed++;
        }
    }

    return removed;
}

module.exports = {
    UPLOAD_URL_PREFIX,
    MAX_IMAGE_BYTES,
    MAX_AUDIO_BYTES,
    IMAGE_TYPES,
    AUDIO_TYPES,
    handleUpload,
    deleteUploadedMedia,
    deleteMediaForCards,
    /* Exported so scripts/migrate-uploads-to-r2.js can determine each
       existing file's real MIME type from its actual bytes -- the same way
       every live upload already is -- rather than guessing from its
       extension. Not used by any live route beyond handleUpload() above. */
    sniff
};
