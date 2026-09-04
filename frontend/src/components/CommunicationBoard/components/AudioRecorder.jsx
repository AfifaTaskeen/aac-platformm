import { useCallback, useEffect, useRef, useState } from 'react'
import { trimSilence } from '../trimSilence'

/*
 * AudioRecorder.jsx
 * -----------------
 * Records one short clip with the device microphone, for a caregiver who
 * wants a card to speak in a voice the child knows.
 *
 * WHY THIS SITS BESIDE "Choose Audio" RATHER THAN REPLACING IT
 * -----------------------------------------------------------
 * Picking an existing file already worked and still does. Recording is the
 * common case -- a parent saying one word into a tablet -- and asking them to
 * leave the app, find a voice-recorder, save a file and come back to select
 * it was the whole friction this removes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not upload. It hands the finished clip to `onRecorded` as a File
 * and lets the dialog put it through the SAME upload path a chosen file
 * takes, so there is one upload, one set of error messages, and one place
 * where a card's audioUrl is set. Nothing here knows the server exists.
 *
 * Props:
 *   onRecorded  - called with a File once a recording is finished
 *   onDiscarded - called when the caregiver throws the new take away
 *   hasSaved    - whether the card already has a saved recording, which
 *                 changes the wording: a first take is "Discard", and a take
 *                 replacing something is still "Discard" but the button
 *                 beside it says "Re-record" rather than "Record"
 *   disabled    - the dialog is busy (saving, or another upload is running)
 */

/*
 * The container to record into.
 *
 * webm/opus is what Chrome and Firefox produce, and it is on the server's
 * allowed list. Safari (including every browser on iOS) does not support it
 * and gives mp4/aac instead, which is also allowed. The first supported entry
 * wins, and passing nothing at all lets the browser choose its own default --
 * which is the correct last resort, since MediaRecorder always has one.
 */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
]

/* The extension to give the uploaded file, chosen from the MIME type the
   recorder actually used -- the server verifies bytes, but a sensible name
   keeps the stored file recognisable. */
function extensionFor(mimeType) {
  /* wav first: a trimmed clip is re-encoded as WAV, so this is the common
     case now rather than an exception. */
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of PREFERRED_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

/*
 * A recording longer than this is almost certainly a forgotten Stop. Cards
 * hold one word, and an unbounded recording would sit on the microphone and
 * eventually be refused by the server's 8MB limit anyway.
 */
const MAX_SECONDS = 30

function AudioRecorder({ onRecorded, onDiscarded, hasSaved = false, disabled = false }) {
  /*
   * 'idle' | 'recording' | 'processing' | 'done' -- one at a time, so the
   * buttons on screen always match what the microphone is actually doing.
   *
   * 'processing' is the brief moment after Stop while the silence at each end
   * is trimmed. It is its own state so the controls cannot be pressed against
   * a clip that is still being prepared.
   */
  const [state, setState] = useState('idle')
  const [seconds, setSeconds] = useState(0)
  const [problem, setProblem] = useState('')

  /* The finished clip, kept for the caregiver to hear before saving. */
  const [previewUrl, setPreviewUrl] = useState(null)

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  /* The preview <audio>, so discarding can STOP it before freeing its URL. */
  const previewRef = useRef(null)

  /*
   * Releases the microphone.
   *
   * Every track has to be stopped explicitly: dropping the reference is not
   * enough, and a live track leaves the browser's recording indicator on --
   * which, on a tablet a child is holding, looks like the app is listening
   * when it is not.
   */
  const releaseMicrophone = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /* Leaving the dialog mid-recording must not leave the microphone open, and
     the object URL must not leak. */
  useEffect(() => {
    return () => {
      releaseMicrophone()
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        try {
          recorderRef.current.stop()
        } catch {
          /* Already stopped. */
        }
      }
    }
  }, [releaseMicrophone])

  /* The preview URL is revoked when it is replaced or the component goes, so
     the finished blobs do not accumulate for the life of the page. */
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function startRecording() {
    setProblem('')

    /*
     * Both of these are real on a phone: getUserMedia is undefined on a page
     * served over plain http (it requires a secure context), and MediaRecorder
     * is missing on some older Android browsers. Saying so plainly beats a
     * TypeError, and the caregiver can still use "Choose Audio".
     */
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setProblem(
        'Recording needs a secure (https) connection. You can still choose an audio file instead.',
      )
      return
    }

    if (typeof MediaRecorder === 'undefined') {
      setProblem('This browser cannot record audio. You can still choose an audio file instead.')
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      /*
       * MICROPHONE PERMISSION, HANDLED RATHER THAN CRASHING.
       *
       * The name tells us which case this is, and they need different advice:
       * a refusal is a decision the caregiver can reverse in the address bar,
       * whereas "no microphone found" is hardware and no amount of permission
       * will fix it.
       */
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        setProblem(
          'Microphone access was blocked. Allow it in your browser settings, or choose an audio file instead.',
        )
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        setProblem('No microphone was found on this device.')
      } else {
        setProblem('Could not start recording. You can choose an audio file instead.')
      }
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    const mimeType = pickMimeType()

    let recorder
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      releaseMicrophone()
      setProblem('This browser cannot record audio. You can still choose an audio file instead.')
      return
    }

    recorderRef.current = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
    })

    recorder.addEventListener('stop', async () => {
      releaseMicrophone()

      const type = recorder.mimeType || mimeType || 'audio/webm'
      const recorded = new Blob(chunksRef.current, { type })
      chunksRef.current = []

      /* A clip with no audio in it is a failed recording, not a valid one --
         uploading it would give the card a silent "voice". */
      if (recorded.size === 0) {
        setState('idle')
        setProblem('Nothing was recorded. Please try again.')
        return
      }

      /*
       * TRIM THE PAUSE BEFORE AND AFTER THE CHILD'S VOICE.
       *
       * A child often presses Record, gathers themselves, and then speaks --
       * so the raw clip starts with a pause that would play back every time
       * the card is tapped. This cuts the quiet run at each end and leaves
       * the middle alone, so a pause between syllables is preserved.
       *
       * It runs BEFORE the preview is built, so what the caregiver hears and
       * approves is exactly what will be saved -- there is no second version.
       *
       * trimSilence never throws: on an unsupported codec or a decode failure
       * it hands back the original, because losing a recording to a failed
       * tidy-up would be far worse than keeping an untrimmed one.
       */
      setState('processing')

      const result = await trimSilence(recorded)

      /*
       * The whole recording was below the speech threshold. Saving it would
       * give the card a silent voice, which is indistinguishable from a
       * broken card, so nothing is kept and the caregiver is told why.
       */
      if (result.silent) {
        setState('idle')
        setProblem('That recording was silent. Please try again and speak after pressing Record.')
        return
      }

      const finalBlob = result.blob
      const finalType = result.type || type

      /*
       * A File, not a bare Blob: the dialog hands this straight to the same
       * uploadAudio() a chosen file uses, and that path names the part after
       * the file. The server generates its own stored filename regardless.
       */
      const file = new File([finalBlob], `recording.${extensionFor(finalType)}`, {
        type: finalType,
      })

      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(finalBlob)
      })
      setState('done')
      onRecorded(file)
    })

    recorder.start()
    setState('recording')
    setSeconds(0)

    timerRef.current = setInterval(() => {
      setSeconds((n) => {
        const next = n + 1
        if (next >= MAX_SECONDS) stopRecording()
        return next
      })
    }, 1000)
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    try {
      recorder.stop()
    } catch {
      releaseMicrophone()
      setState('idle')
    }
  }

  /*
   * Throws away the take that has just been made.
   *
   * EVERYTHING the take created is released here, in one place:
   *
   *   - the <audio> element is paused first, so a preview that is mid-play
   *     does not carry on sounding after the caregiver has deleted it. That
   *     is the "deleted but still playing" case, and pausing before revoking
   *     is what prevents it -- revoking a URL that is still being played does
   *     not stop the playback.
   *   - the object URL is revoked, so the blob is freed rather than living
   *     until the page is closed.
   *   - the chunks are dropped.
   *
   * The microphone is already released by the 'stop' handler, so there is no
   * live track at this point.
   */
  function discardRecording() {
    const player = previewRef.current
    if (player) {
      try {
        player.pause()
        player.currentTime = 0
      } catch {
        /* Already detached. */
      }
    }

    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })

    chunksRef.current = []
    setState('idle')
    setProblem('')

    if (onDiscarded) onDiscarded()
  }

  return (
    <div className="crec">
      <div className="crec__controls">
        {state !== 'recording' ? (
          <button
            type="button"
            className="cedit__btn cedit__btn--soft crec__btn"
            onClick={startRecording}
            /* Not pressable while a clip is being trimmed: starting a new
               recording then would race the one still being prepared. */
            disabled={disabled || state === 'processing'}
          >
            <span className="crec__dot" aria-hidden="true" />
            {state === 'done' || hasSaved ? 'Re-record' : 'Record'}
          </button>
        ) : (
          <button
            type="button"
            className="cedit__btn cedit__btn--soft crec__btn crec__btn--stop"
            onClick={stopRecording}
          >
            <span className="crec__square" aria-hidden="true" />
            Stop
          </button>
        )}

        {/*
          Discard, offered only while there is an unsaved take to throw away.

          It sits beside Re-record rather than replacing it, because the two
          are different intentions: Re-record means "this one is wrong, let me
          try again", Discard means "forget the whole idea and keep what the
          card already had".
        */}
        {state === 'done' && (
          <button
            type="button"
            className="cedit__btn cedit__btn--soft crec__btn crec__btn--discard"
            onClick={discardRecording}
            disabled={disabled}
          >
            <span aria-hidden="true">🗑</span>
            Discard
          </button>
        )}

        {state === 'recording' && (
          <span className="crec__timer" role="status" aria-live="polite">
            Recording… {seconds}s
          </span>
        )}

        {/* The trim is fast -- well under a second for a one-word clip -- but
            it is not instant, and a silent gap with no feedback reads as a
            control that did not work. */}
        {state === 'processing' && (
          <span className="crec__timer" role="status" aria-live="polite">
            Tidying up…
          </span>
        )}
      </div>

      {/* The finished clip, so the caregiver can hear it BEFORE saving the
          card. Native controls: this is a caregiver screen, matching the
          existing audio preview beside it. */}
      {state === 'done' && previewUrl && (
        <>
          <audio
            ref={previewRef}
            className="cedit__audio"
            src={previewUrl}
            controls
            preload="none"
          />
          {/* Says plainly that this take is not kept yet, so "Discard" does
              not read as though it will delete the card's saved sound. */}
          <p className="crec__pending">
            {hasSaved
              ? 'New recording — not saved yet. Save to replace the current sound.'
              : 'New recording — not saved yet. Press Save to keep it.'}
          </p>
        </>
      )}

      {problem && (
        <p className="crec__problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

export default AudioRecorder
