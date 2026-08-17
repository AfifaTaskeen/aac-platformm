/*
 * tts.js
 * ------
 * Google Cloud Text-to-Speech.
 *
 * Kept in its own module rather than added to server.js, which is already
 * long. It exports three things: whether TTS is configured, the voice map,
 * and a synthesize() function.
 *
 * SECURITY
 * --------
 * Credentials never reach this file as literals. The Google client reads
 * them from the environment via Application Default Credentials -- either
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON file, or
 * the ambient credentials of a Google Cloud host. Nothing here is ever sent
 * to the browser: the frontend asks for "male" or "female" and receives
 * audio bytes, never a key, a project id or a Google voice name.
 */
const textToSpeech = require("@google-cloud/text-to-speech");

/*
 * THE VOICE MAP -- the single place the app's two preferences are turned
 * into real Google voices.
 *
 * This indirection is the point: the frontend and the child profile only
 * ever say "male" or "female". Swapping in a different Google voice later,
 * or adding a language, is a change to this object alone.
 *
 * en-IN (English, India) as specified. The Wavenet voices are the higher
 * quality tier and sound markedly more natural than the Standard ones,
 * which matters when the listener is a child learning the words.
 */
const VOICES = {
    female: {
        languageCode: "en-IN",
        name: "en-IN-Wavenet-A",
        ssmlGender: "FEMALE"
    },
    male: {
        languageCode: "en-IN",
        name: "en-IN-Wavenet-B",
        ssmlGender: "MALE"
    }
};

/* The only values the API accepts, so the frontend contract stays tiny. */
const ALLOWED_VOICES = Object.keys(VOICES);

/* A generous ceiling: card labels are one or two words, and short sentences
   are all this endpoint is for. It also bounds what one request can cost. */
const MAX_TEXT_LENGTH = 200;

/*
 * The client is created lazily, on the first successful request.
 *
 * Constructing it eagerly at startup would throw when no credentials are
 * configured, which would stop the whole server -- and sign-in, child
 * profiles and password resets have nothing to do with TTS. This way an
 * unconfigured TTS setup degrades to one failing endpoint.
 */
let client = null;
let clientError = null;

function getClient() {
    if (client) return client;
    if (clientError) throw clientError;

    try {
        client = new textToSpeech.TextToSpeechClient();
        return client;
    } catch (error) {
        clientError = error;
        throw error;
    }
}

/*
 * Whether TTS looks configured. This checks only that SOMETHING is present
 * to authenticate with -- it cannot confirm the credentials actually work,
 * which only a real request can.
 */
function isConfigured() {
    return Boolean(
        process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.GOOGLE_TTS_CREDENTIALS ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT
    );
}

/*
 * Turns text into MP3 audio.
 *
 * MP3 rather than LINEAR16: every browser plays it from a blob or a data
 * URL with no decoding work, and it is a fraction of the size over the wire.
 *
 * Returns a Buffer. Throws on failure -- the route decides what the client
 * is told, so no Google error text leaks into a response.
 */
async function synthesize(text, voiceKey) {
    const voice = VOICES[voiceKey];
    if (!voice) {
        throw new Error(`Unknown voice: ${voiceKey}`);
    }

    const [response] = await getClient().synthesizeSpeech({
        input: { text },
        voice: {
            languageCode: voice.languageCode,
            name: voice.name,
            ssmlGender: voice.ssmlGender
        },
        audioConfig: {
            audioEncoding: "MP3",
            /*
             * Slightly slower than natural, matching the browser-speech
             * fallback already in the frontend. A measured pace is easier to
             * follow for a child still learning these words.
             */
            speakingRate: 0.95,
            pitch: 0
        }
    });

    if (!response.audioContent) {
        throw new Error("Google returned no audio content");
    }

    return Buffer.from(response.audioContent, "base64");
}

module.exports = {
    VOICES,
    ALLOWED_VOICES,
    MAX_TEXT_LENGTH,
    isConfigured,
    synthesize
};
