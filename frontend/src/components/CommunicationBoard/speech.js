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

  return (
    english.find((v) => looksLike(v, hints)) ||
    cachedVoices.find((v) => looksLike(v, hints)) ||
    english[0] ||
    cachedVoices[0]
  )
}

/*
 * Speaks a sentence in the child's preferred voice.
 *
 * Returns true if speech started, false if the browser cannot speak at all,
 * so the caller can tell the user rather than appearing to do nothing.
 */
export function speak(text, voicePreference) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false

  const trimmed = (text || '').trim()
  if (!trimmed) return false

  /*
   * Stop anything already speaking. Without this, repeated presses queue up
   * and the child waits through several sentences to hear the newest one.
   */
  window.speechSynthesis.cancel()

  const utterance = new window.SpeechSynthesisUtterance(trimmed)

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

  window.speechSynthesis.speak(utterance)
  return true
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
