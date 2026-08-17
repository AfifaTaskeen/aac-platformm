/*
 * test-tts.js
 * -----------
 * Verifies the Google Cloud Text-to-Speech integration WITHOUT touching the
 * AAC board.
 *
 *   node test-tts.js              -> speaks "Rice" in both voices
 *   node test-tts.js "Dosa"       -> speaks "Dosa" in both voices
 *
 * It writes two playable MP3 files next to this script:
 *
 *   tts-test-female.mp3
 *   tts-test-male.mp3
 *
 * Double-click either to hear it.
 *
 * The server must be running (node server.js) -- this exercises the real
 * /api/tts endpoint, not the Google library directly, so it tests the whole
 * path the browser will use.
 *
 * It never prints a credential: only whether one is present, and the shape
 * of what came back.
 */
const fs = require("fs");
const path = require("path");

require("dotenv").config({ quiet: true });

const API = `http://localhost:${process.env.PORT || 5000}/api/tts`;
const TEXT = process.argv[2] || "Rice";

async function tryVoice(voice) {
    const outFile = path.join(__dirname, `tts-test-${voice}.mp3`);

    process.stdout.write(`  ${voice.padEnd(7)} "${TEXT}" ... `);

    let response;
    try {
        response = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: TEXT, voice })
        });
    } catch (error) {
        console.log("FAILED -- could not reach the server.");
        console.log(`           Is it running? (node server.js)  [${error.message}]`);
        return false;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
        let detail = "";
        try {
            const body = await response.json();
            detail = body.message || JSON.stringify(body);
        } catch {
            detail = `HTTP ${response.status}`;
        }
        console.log(`FAILED -- ${response.status}: ${detail}`);
        return false;
    }

    if (!contentType.includes("audio")) {
        console.log(`FAILED -- expected audio, got ${contentType}`);
        return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    /* An MP3 begins with an ID3 tag or an MPEG frame sync (0xFF 0xFB/0xF3).
       Checking this proves we received real audio, not an error page. */
    const looksLikeMp3 =
        buffer.slice(0, 3).toString() === "ID3" ||
        (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);

    fs.writeFileSync(outFile, buffer);

    console.log(
        `OK -- ${buffer.length.toLocaleString()} bytes, ` +
        `${looksLikeMp3 ? "valid MP3" : "NOT recognisable as MP3"}`
    );
    console.log(`           saved: ${outFile}`);

    return looksLikeMp3;
}

async function main() {
    console.log("");
    console.log("Google Cloud Text-to-Speech test");
    console.log("================================");
    console.log(`  endpoint: ${API}`);
    console.log(
        "  credentials: " +
        (process.env.GOOGLE_APPLICATION_CREDENTIALS
            ? "GOOGLE_APPLICATION_CREDENTIALS is set"
            : "NOT SET -- see the setup steps")
    );
    console.log("");

    const femaleOk = await tryVoice("female");
    const maleOk = await tryVoice("male");

    console.log("");
    console.log("--- validation (these SHOULD fail) ---");

    for (const [label, body] of [
        ["missing text  ", { voice: "female" }],
        ["empty text    ", { text: "   ", voice: "female" }],
        ["bad voice     ", { text: "Rice", voice: "robot" }],
        ["missing voice ", { text: "Rice" }]
    ]) {
        try {
            const r = await fetch(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
            const d = await r.json().catch(() => ({}));
            console.log(
                `  ${label} -> ${r.status} ${r.status === 400 ? "OK" : "UNEXPECTED"}` +
                `  ${d.message || ""}`
            );
        } catch {
            console.log(`  ${label} -> could not reach the server`);
        }
    }

    console.log("");
    if (femaleOk && maleOk) {
        console.log("BOTH VOICES WORK. Play the two .mp3 files above to hear them.");
        process.exit(0);
    } else {
        console.log("TTS is not working yet -- see the messages above.");
        process.exit(1);
    }
}

main();
