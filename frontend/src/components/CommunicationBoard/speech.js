/*
 * speech.js
 * ---------
 * Text-to-speech, and the short alert beep.
 *
 * speakText() (the browser's own voice, via the Web Speech API) and
 * playAlert() use browser APIs directly -- no library, no network request, no
 * audio file to load, no API key, no quota. This is the ONLY text-to-speech
 * mechanism currently used by the application; there is no cloud/network
 * fallback.
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
 *   1. an en-IN voice matching the requested gender
 *   2. any other English voice matching the requested gender
 *   3. any en-IN voice (any gender)
 *   4. any English voice at all
 *
 * en-IN is preferred first, per BuddyTalk's Indian-English requirement --
 * checked using the voice's own `lang` property (e.g. "en-IN"), never
 * guessed from its name. Whether an en-IN voice actually exists is entirely
 * up to the browser/OS's installed voice list: NOT ALL DEVICES SHIP ONE.
 * getAvailableLangs() below lets a caller check this directly.
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

  /*
   * en-IN FIRST, then any other English.
   *
   * Checked via the voice's own `lang` tag (e.g. "en-IN"), which is the only
   * locale signal the Web Speech API actually exposes -- never the voice's
   * name. A male/female match of a DIFFERENT English accent is still
   * preferred over an en-IN voice of the wrong gender: the child asked for a
   * male or female voice, and accent is the smaller compromise. So gender is
   * the outer preference and locale the tie-break inside it.
   *
   * Both lists are searched before giving up on the request, and only then
   * does it fall back to any English voice at all -- so a device with no
   * en-IN voice, or no matching gender, still speaks rather than falling
   * silent.
   */
  const enIN = english.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith('en-in'))
  const enOther = english.filter((v) => !enIN.includes(v))

  return (
    enIN.find((v) => looksLike(v, hints)) ||
    enOther.find((v) => looksLike(v, hints)) ||
    enIN[0] ||
    english[0]
  )
}

/*
 * Whether an en-IN voice is actually available on this device/browser,
 * checked via each voice's own `lang` property -- never assumed. Exported so
 * a caller (e.g. a settings screen) can tell the truth about it rather than
 * claiming Indian English is guaranteed, per BuddyTalk's requirement that
 * this never be assumed.
 */
export function hasIndianEnglishVoice() {
  if (!cachedVoices.length) refreshVoices()
  return cachedVoices.some((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith('en-in'))
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
   * Slower than default, because the listener may still be learning these
   * words and a measured pace is easier to follow.
   *
   * 0.85 rather than the previous 0.95: noticeably calmer, while staying well
   * clear of the drawl that sets in below about 0.7, where the synthesiser
   * stretches vowels and words start to sound slurred rather than clear.
   *
   * Set here, in the one place every utterance passes through, so the pace is
   * identical for card words, whole sentences, and the spoken control labels.
   * Pitch is deliberately left at its natural 1.
   */
  utterance.rate = 0.85
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

/* ==========================================================================
   A CARD'S OWN RECORDED VOICE

   A caregiver can record a card in a voice the child knows -- a parent, a
   sibling, the child themselves. When a card has one, it is played INSTEAD of
   the synthetic voice; cards without one are untouched and still speak
   through speakText().

   The recording is a file on the server, referenced by the card's audioUrl.
   Nothing is cached here beyond the element currently playing: these are
   one-word clips, and the browser's own HTTP cache already avoids re-fetching
   them.
   ========================================================================== */

/*
 * The clip currently playing, so the next tap can stop it.
 *
 * ONE element at a time, for the same reason speakText interrupts itself: a
 * child tapping several cards quickly should hear the newest word, not all of
 * them layered on top of one another.
 */
let currentClip = null

function stopCurrentClip() {
  if (!currentClip) return
  try {
    currentClip.pause()
    currentClip.currentTime = 0
  } catch {
    /* Already torn down by the browser -- nothing to stop. */
  }
  currentClip = null
}

/*
 * Plays a card's recorded audio.
 *
 * Returns a Promise for whether it actually started. It resolves FALSE rather
 * than rejecting when playback is impossible -- a missing file, a codec the
 * device cannot decode, or autoplay being blocked -- so the caller can fall
 * back to text-to-speech and the child still hears the word. A recording that
 * will not play must never leave a card silent.
 */
export function playRecording(url, options = {}) {
  if (typeof window === 'undefined' || !url) return Promise.resolve(false)

  const { interrupt = true } = options

  /*
   * The synthetic voice and a recording must never overlap. Whichever is
   * asked for second wins, exactly as two spoken words already do.
   */
  if (interrupt) {
    stopCurrentClip()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
  } else if (currentClip && !currentClip.ended) {
    /* Something is already playing and the caller asked not to cut it off. */
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let audio
    try {
      audio = new Audio(url)
    } catch {
      resolve(false)
      return
    }

    currentClip = audio

    /* Cleared on the way out so a later tap does not try to pause a finished
       clip, and so nothing holds a reference to it. */
    const release = () => {
      if (currentClip === audio) currentClip = null
    }

    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener(
      'error',
      () => {
        release()
        resolve(false)
      },
      { once: true },
    )

    /*
     * play() rejects when the browser blocks autoplay, which happens on a
     * page that has not been interacted with yet. A card TAP is an
     * interaction, so this succeeds in the case that matters -- but it is
     * caught regardless, because a rejected promise here would otherwise be
     * an unhandled rejection in the console.
     */
    const started = audio.play()

    if (started && typeof started.then === 'function') {
      started.then(
        () => resolve(true),
        () => {
          release()
          resolve(false)
        },
      )
    } else {
      /* Older browsers return undefined from play(). */
      resolve(true)
    }
  })
}

/* Stops any recording that is playing. Used when the board needs silence --
   the same job speechSynthesis.cancel() does for the synthetic voice. */
export function stopRecording() {
  stopCurrentClip()
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
