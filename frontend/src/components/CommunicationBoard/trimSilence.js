/*
 * trimSilence.js
 * --------------
 * Removes the quiet run at the START and END of a recording, so a card's
 * sound begins close to the child's voice instead of the pause before it.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * It is pure audio maths with no React in it: bytes in, bytes out. Keeping it
 * out of the recorder means the recorder's flow (record -> stop -> preview ->
 * save/discard) is untouched, and this can be tested and tuned on its own.
 *
 * WHY THE RESULT IS A WAV
 * -----------------------
 * A browser can DECODE webm/opus, mp4/aac and ogg, but it cannot re-encode
 * them: there is no encoder in the platform, and adding one would mean
 * shipping a large library into an app for children. Once samples have been
 * cut, the only container the platform can write without a dependency is WAV.
 *
 * That is safe here because the server already accepts audio/wav and verifies
 * it by its RIFF/WAVE magic number (see backend/uploads.js), so nothing on the
 * server changes. WAV is uncompressed, so a trimmed clip is larger per second
 * than the opus original -- but these are ONE WORD, and the numbers stay tiny:
 * a 2-second mono clip at 44.1kHz is about 170KB, far below the 8MB limit.
 * Trimming several seconds of silence usually makes the stored file smaller
 * than an untrimmed original would have been anyway.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It is not noise reduction. It finds where sound starts and stops and cuts
 * outside that; it never touches the middle, so a child who pauses between
 * syllables keeps their pause.
 */

/*
 * How quiet counts as silence, as RMS amplitude in the 0..1 range.
 *
 * 0.015 is roughly -36dBFS. Chosen to sit above the hiss of a typical tablet
 * microphone in a quiet room, and well below a child speaking at arm's length.
 * A threshold too low leaves the pause in; too high clips the soft start of a
 * word like "shh" or "finished".
 */
const SILENCE_RMS = 0.015

/*
 * The window RMS is measured over, in seconds.
 *
 * 20ms is short enough to locate the start of a word precisely, and long
 * enough that a single loud sample of noise cannot look like speech.
 */
const WINDOW_SECONDS = 0.02

/*
 * Kept either side of the detected speech.
 *
 * Without it, trimming lands exactly on the first sample that crossed the
 * threshold, which clips the attack of the word and sounds abrupt. 120ms of
 * lead-in preserves the consonant; 250ms at the end lets a word's tail decay
 * naturally rather than being cut off mid-breath.
 */
const PAD_START_SECONDS = 0.12
const PAD_END_SECONDS = 0.25

/*
 * A run of speech must be at least this long to count.
 *
 * Stops a cough, a knock on the table or a single click from being treated as
 * the start of the child's voice, which would defeat the whole trim.
 */
const MIN_SPEECH_SECONDS = 0.06

/*
 * Finds the first and last window that contain sound.
 *
 * Returns null when the whole recording is below the threshold -- the
 * "silence only" case, which the caller reports rather than saving.
 *
 * The loudest channel wins at each window, so a recording that arrives on one
 * side of a stereo microphone is not mistaken for silence.
 */
function findSpeechBounds(buffer) {
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate * WINDOW_SECONDS))
  const windows = Math.ceil(buffer.length / windowSize)
  const minWindows = Math.max(1, Math.round(MIN_SPEECH_SECONDS / WINDOW_SECONDS))

  /* Read every channel once rather than per window -- getChannelData copies
     a reference, but indexing it repeatedly across channels is the hot path. */
  const channels = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))

  const loud = new Array(windows).fill(false)

  for (let w = 0; w < windows; w++) {
    const start = w * windowSize
    const end = Math.min(start + windowSize, buffer.length)
    let peakRms = 0

    for (const data of channels) {
      let sum = 0
      for (let i = start; i < end; i++) {
        const sample = data[i]
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / Math.max(1, end - start))
      if (rms > peakRms) peakRms = rms
    }

    loud[w] = peakRms >= SILENCE_RMS
  }

  /*
   * The first window that begins a long-enough RUN of sound, and the last
   * window that ends one. Requiring a run is what filters out isolated
   * clicks; a single loud window surrounded by silence is not speech.
   */
  let firstLoud = -1
  for (let w = 0; w + minWindows <= windows; w++) {
    let all = true
    for (let k = 0; k < minWindows; k++) {
      if (!loud[w + k]) { all = false; break }
    }
    if (all) { firstLoud = w; break }
  }

  if (firstLoud === -1) return null

  let lastLoud = -1
  for (let w = windows - minWindows; w >= 0; w--) {
    let all = true
    for (let k = 0; k < minWindows; k++) {
      if (!loud[w + k]) { all = false; break }
    }
    if (all) { lastLoud = w + minWindows - 1; break }
  }

  if (lastLoud < firstLoud) lastLoud = firstLoud

  return {
    start: firstLoud * windowSize,
    end: Math.min(buffer.length, (lastLoud + 1) * windowSize),
  }
}

/*
 * Writes an AudioBuffer slice as a 16-bit PCM MONO WAV.
 *
 * WHY MONO.
 *
 * A card holds one spoken word, which carries no stereo information -- and
 * WAV is uncompressed, so keeping a second identical channel doubles the file
 * for nothing. That matters twice over on a phone: it is the caregiver's
 * mobile data on upload, and it is the headroom against the server's 8MB
 * limit. A 30-second clip (the recorder's cap) is ~5.0MB in stereo at 44.1kHz
 * but ~2.5MB in mono -- and on an Android device that records at 48kHz,
 * stereo would reach ~5.5MB while mono stays comfortably clear.
 *
 * Channels are AVERAGED rather than one being dropped, so a device that
 * happens to feed the microphone into only one side is not reduced to silence.
 */
function encodeWav(buffer, startSample, endSample) {
  const sourceChannels = buffer.numberOfChannels
  const channelCount = 1
  const frames = endSample - startSample
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const dataBytes = frames * blockAlign

  const out = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(out)

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) /* PCM header length */
  view.setUint16(20, 1, true) /* format 1 = PCM */
  view.setUint16(22, channelCount, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) /* bits per sample */
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  const channels = []
  for (let c = 0; c < sourceChannels; c++) channels.push(buffer.getChannelData(c))

  let offset = 44
  for (let i = startSample; i < endSample; i++) {
    /* Average every source channel into the one output channel. */
    let mixed = 0
    for (let c = 0; c < sourceChannels; c++) mixed += channels[c][i]
    mixed /= sourceChannels

    /* Clamp before scaling: a sample slightly outside -1..1 would otherwise
       wrap around and become a loud click. */
    const sample = Math.max(-1, Math.min(1, mixed))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return new Blob([out], { type: 'audio/wav' })
}

/*
 * Trims a recorded blob.
 *
 * Returns:
 *   { blob, type, trimmed: true }   the trimmed clip
 *   { blob, type, trimmed: false }  the ORIGINAL, when trimming was not
 *                                   possible or would not help
 *   { silent: true }                the whole recording was below threshold
 *
 * The original is returned rather than an error whenever anything goes wrong
 * -- an unsupported codec, a decode failure, no AudioContext. A recording the
 * child actually made must never be lost because the tidy-up step failed;
 * an untrimmed clip is a far better outcome than none.
 */
export async function trimSilence(blob) {
  if (typeof window === 'undefined') return { blob, type: blob.type, trimmed: false }

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx || !blob || blob.size === 0) {
    return { blob, type: blob?.type, trimmed: false }
  }

  let context = null

  try {
    const bytes = await blob.arrayBuffer()

    context = new AudioCtx()

    /*
     * decodeAudioData handles every container MediaRecorder produces here --
     * webm/opus, mp4/aac, ogg -- because the browser decoding it is the same
     * one that recorded it.
     *
     * TWO ANDROID-SPECIFIC GUARDS:
     *
     * 1. Older Android Chrome only supports the CALLBACK form and returns
     *    undefined instead of a promise, so `await` on it resolves instantly
     *    to undefined and the next line throws on `.length`. Wrapping both
     *    forms in one promise covers old and current browsers alike.
     *
     * 2. A decode that never settles would leave the recorder stuck on
     *    "Tidying up…" with no way out -- the clip is already made, so
     *    hanging there would lose it. The timeout rejects instead, and the
     *    catch below returns the UNTRIMMED original, which is the right
     *    trade: an untrimmed recording beats no recording.
     */
    const buffer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DECODE_TIMEOUT')), 10000)

      let maybePromise
      try {
        maybePromise = context.decodeAudioData(
          bytes,
          (decoded) => { clearTimeout(timer); resolve(decoded) },
          (err) => { clearTimeout(timer); reject(err || new Error('DECODE_FAILED')) },
        )
      } catch (syncError) {
        clearTimeout(timer)
        reject(syncError)
        return
      }

      /* The modern promise form -- whichever settles first wins; the
         callbacks above are simply never called on such a browser. */
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(
          (decoded) => { clearTimeout(timer); resolve(decoded) },
          (err) => { clearTimeout(timer); reject(err) },
        )
      }
    })

    if (!buffer || !buffer.length) {
      return { blob, type: blob.type, trimmed: false }
    }

    const bounds = findSpeechBounds(buffer)

    if (!bounds) return { silent: true }

    const padStart = Math.round(PAD_START_SECONDS * buffer.sampleRate)
    const padEnd = Math.round(PAD_END_SECONDS * buffer.sampleRate)

    const start = Math.max(0, bounds.start - padStart)
    const end = Math.min(buffer.length, bounds.end + padEnd)

    if (end <= start) return { silent: true }

    /*
     * Nothing worth cutting: re-encoding here would turn a small compressed
     * clip into a larger WAV for no benefit, so the original is kept.
     * A tenth of a second is below what anyone would notice.
     */
    const savedSamples = buffer.length - (end - start)
    if (savedSamples < buffer.sampleRate * 0.1) {
      return { blob, type: blob.type, trimmed: false }
    }

    const trimmedBlob = encodeWav(buffer, start, end)
    return { blob: trimmedBlob, type: 'audio/wav', trimmed: true }
  } catch (error) {
    /* Decoding or encoding failed -- keep what the child recorded. */
    console.log('Could not trim the recording; keeping it as it is:', error)
    return { blob, type: blob.type, trimmed: false }
  } finally {
    /* An AudioContext is a real audio device handle; browsers cap how many a
       page may hold, so each one is closed as soon as it has been used. */
    if (context && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        /* Already closed. */
      }
    }
  }
}

/* Exported so a test or a future settings screen can reason about the
   thresholds without duplicating the numbers. */
export const SILENCE_SETTINGS = {
  SILENCE_RMS,
  WINDOW_SECONDS,
  PAD_START_SECONDS,
  PAD_END_SECONDS,
  MIN_SPEECH_SECONDS,
}
