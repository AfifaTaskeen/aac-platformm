/*
 * speech.js
 * ---------
 * Text-to-speech, and the short alert beep.
 *
 * Both use browser APIs directly. No library, no network request, no audio
 * file to load -- which also means the board still speaks with no internet
 * connection.
 */

/*
 * Browsers load their voice list ASYNCHRONOUSLY. Called too early,
 * getVoices() returns an empty array, which is the usual reason a voice
 * preference "does not work" -- the code asked before the list existed.
 *
 * So we ask once, and also listen for the event that fires when the list
 * arrives. By the time the child presses Speak, the list is ready.
 */
let cachedVoices = []

function refreshVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  cachedVoices = window.speechSynthesis.getVoices() || []
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
}

/*
 * Names that reliably indicate a voice's gender.
 *
 * There is no standard field for this: the Web Speech API exposes a name and
 * a language, nothing more. Matching on known voice names is the only method
 * available, so it is a best effort by design -- hence the fallback below.
 */
const FEMALE_HINTS = ['female', 'zira', 'susan', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona', 'hazel', 'catherine', 'linda', 'heera', 'aria', 'jenny', 'michelle', 'eva', 'sonia']
const MALE_HINTS = ['male', 'david', 'mark', 'george', 'james', 'daniel', 'alex', 'fred', 'ravi', 'guy', 'brian', 'christopher', 'eric', 'roger', 'thomas']

function looksLike(voice, hints) {
  const name = (voice.name || '').toLowerCase()
  /*
   * "female" contains "male" as a substring, so a plain includes() check
   * would label every female voice male. Checked explicitly.
   */
  if (hints === MALE_HINTS && name.includes('female')) return false
  return hints.some((hint) => name.includes(hint))
}

/*
 * Picks the best available voice for the child's saved preference.
 *
 * Preference order:
 *   1. an English voice matching the requested gender
 *   2. any voice matching the requested gender
 *   3. any English voice
 *   4. whatever the browser offers first
 *
 * It never returns nothing when voices exist: an unavailable preference
 * degrades to a working voice rather than to silence.
 */
export function pickVoice(preference) {
  if (!cachedVoices.length) refreshVoices()
  if (!cachedVoices.length) return null

  const hints = preference === 'male' ? MALE_HINTS : FEMALE_HINTS
  const english = cachedVoices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'))

  /*
   * ENGLISH ONLY -- never fall back to a voice in another language.
   *
   * This previously ended `... || english[0] || cachedVoices[0]`, and that
   * last term is a real bug on Android. Many Indian phones ship a TTS engine
   * whose voice list is led by a regional language (hi-IN, bn-IN, ta-IN). If
   * no English voice was installed, cachedVoices[0] returned that voice, and
   * -- because speakText() copies `voice.lang` onto the utterance -- the
   * board then asked a Hindi engine to read English words. A single letter
   * like "I" comes out as an unrelated-sounding word, which is exactly the
   * "Happy July" symptom.
   *
   * Returning null instead is the honest answer: the browser then uses its
   * own default for the utterance's language rather than being actively
   * pointed at the wrong one. speakText() leaves `lang` unset in that case
   * and sets it to en-US, so the request is still explicitly English.
   *
   * A voice matching the requested GENDER is still preferred, but only ever
   * among English voices -- a male/female match in the wrong language is
   * worse than an English voice of the other gender.
   */
  if (!english.length) return null

  return english.find((v) => looksLike(v, hints)) || english[0]
}

/*
 * The shortest gap between two AUTOMATIC card words. Roughly how long a
 * single short word takes to say, so a deliberate tap-listen-tap rhythm is
 * never blocked, while a fast burst speaks once instead of ten times.
 *
 * Only the automatic word is throttled. Pressing Speak is always honoured.
 */
const MIN_GAP_MS = 900
let lastSpokeAt = 0

/*
 * Is text-to-speech available at all in this browser?
 *
 * Exported so a caller can ask BEFORE speaking -- used to decide whether an
 * automatic, unprompted utterance is even worth attempting, without having
 * to attempt one and inspect the result.
 */
export function canSpeak() {
  return typeof window !== 'undefined' && !!window.speechSynthesis
}

/* ==========================================================================
   THE ONE ENTRY POINT

   Everything that wants to say something calls speakText(). It is the whole
   public surface of this module for speech, deliberately:

     speakText(text, options) -> boolean

   The Web Speech API below is an IMPLEMENTATION DETAIL. Swapping in a
   network voice (ElevenLabs, Google, Azure) means rewriting the body of this
   one function -- fetch the audio, play it through an <audio> element or the
   Web Audio API -- and touching nothing else. No component, no card data, no
   sentence-building logic and no backend route knows which engine is
   speaking, because none of them import anything but this function.

   Returns true if speech started, false if the browser cannot speak, so the
   caller can say so rather than appearing to do nothing.
   ========================================================================== */
export function speakText(text, options = {}) {
  if (!canSpeak()) return false

  const trimmed = (text || '').trim()
  if (!trimmed) return false

  const { voicePreference, interrupt = true } = options

  /*
   * INTERRUPT, OR WAIT YOUR TURN.
   *
   * `interrupt: true` (the default, and what the Speak button uses) stops
   * whatever is playing first. Without it, repeated presses queue up and the
   * child waits through several sentences to hear the newest one.
   *
   * `interrupt: false` is for the automatic word spoken when a card is
   * tapped. It must NOT cut off a sentence the child deliberately asked to
   * hear -- reaching for the next card while the sentence plays is normal,
   * and silencing the sentence for it would punish that. So when something
   * is already speaking, the tapped word is simply skipped: the card still
   * lands in the sentence, which is the part that matters.
   *
   * Skipping rather than queueing is also what keeps rapid tapping sane. A
   * child who taps eight cards quickly gets the first word and a responsive
   * board -- not eight words playing back over the next twenty seconds while
   * the board appears stuck.
   */
  if (interrupt) {
    window.speechSynthesis.cancel()
    lastSpokeAt = Date.now()
  } else {
    /*
     * Two independent guards, because either one alone has a hole:
     *
     *   speaking/pending  - the engine's own answer. Authoritative when it
     *                       works, but it is not updated synchronously in
     *                       every browser, so several taps inside one frame
     *                       can all read `false` and all queue.
     *
     *   a time floor      - our own answer, updated the instant we hand an
     *                       utterance over. This is what actually stops a
     *                       burst of taps, and it does not depend on the
     *                       engine reporting its state promptly.
     *
     * Whichever says "busy" wins. The word is dropped, not queued: the card
     * is already in the sentence, and Speak will read the whole thing back.
     */
    const engineBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending
    const tooSoon = Date.now() - lastSpokeAt < MIN_GAP_MS
    if (engineBusy || tooSoon) return false
    lastSpokeAt = Date.now()
  }

  /*
   * SPOKEN AS A WORD, NEVER SPELLED OUT.
   *
   * Some engines read a lone capital letter as the LETTER's name rather than
   * the word: "I" becomes "eye" only by luck, and "A" is read "ay" instead of
   * the article. The board has 26 single-letter cards in Letters/, plus the
   * core word "I", so this is a real case and not a hypothetical one.
   *
   * Appending a full stop makes the engine treat the character as a one-word
   * SENTENCE, which is exactly what it is. The punctuation is not spoken; it
   * only tells the synthesiser how to parse what it was given, so nothing the
   * child sees or hears changes except that it now sounds like a word.
   *
   * Applied only to a single alphabetic character. Anything longer already
   * parses as a word, and adding punctuation to it would risk an unwanted
   * pause at the end of a sentence the child built.
   */
  const spoken = /^[A-Za-z]$/.test(trimmed) ? `${trimmed}.` : trimmed

  const utterance = new window.SpeechSynthesisUtterance(spoken)

  /*
   * The language is stated ALWAYS, whether or not a voice object was found.
   *
   * Without this, an utterance with no `voice` inherits the document's or the
   * engine's default language, which on a phone set to a regional locale is
   * not English -- the same mispronunciation the voice fallback caused. Being
   * explicit means the request is "read this as English" even when the board
   * cannot name a specific voice to do it.
   *
   * A matched voice overrides it with its own exact tag (en-GB, en-IN, ...),
   * which is more precise than the generic default.
   */
  utterance.lang = 'en-US'

  const voice = pickVoice(voicePreference)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }

  /*
   * Slightly slower than default. These sentences are short and the listener
   * may be still learning the words, so a measured pace is easier to follow.
   */
  utterance.rate = 0.95
  utterance.pitch = 1

  /*
   * A failed utterance must never reach the console as an unhandled error or
   * leave the engine wedged. "interrupted" and "canceled" are not faults --
   * they are what cancel() above is SUPPOSED to cause -- so they are ignored
   * rather than reported.
   */
  utterance.onerror = (event) => {
    const reason = event?.error
    if (reason === 'interrupted' || reason === 'canceled') return
    console.warn('Speech failed:', reason || 'unknown reason')
  }

  try {
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    /* Some browsers throw instead of firing onerror. Either way the board
       keeps working; only the sound is lost. */
    return false
  }
}

/*
 * The previous name for speakText, kept so existing callers keep working.
 * New code should call speakText.
 */
export function speak(text, voicePreference) {
  return speakText(text, { voicePreference })
}

/*
 * A short, soft alert tone -- the child getting someone's attention.
 *
 * Synthesised with the Web Audio API rather than loaded from a file, so there
 * is no asset to ship and nothing to fail on a slow connection.
 *
 * Deliberately gentle: a sine wave (no harsh edges), a quiet peak of 0.18,
 * and an envelope that fades in and out instead of clicking on and off. It is
 * meant to be noticed, not startling -- this is for a child who may be
 * sensitive to sudden sound.
 */
let audioContext = null

export function playAlert() {
  if (typeof window === 'undefined') return false

  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return false

  try {
    // One context, reused. Browsers limit how many a page may create.
    if (!audioContext) audioContext = new AudioCtx()

    // A context created before the first tap starts suspended.
    if (audioContext.state === 'suspended') audioContext.resume()

    const now = audioContext.currentTime
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.type = 'sine'
    // Two soft notes rather than one flat beep: friendlier, and easier to
    // tell apart from other sounds in a classroom.
    oscillator.frequency.setValueAtTime(660, now)
    oscillator.frequency.setValueAtTime(880, now + 0.14)

    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)

    oscillator.connect(gain)
    gain.connect(audioContext.destination)

    oscillator.start(now)
    oscillator.stop(now + 0.45)
    return true
  } catch {
    return false
  }
}
