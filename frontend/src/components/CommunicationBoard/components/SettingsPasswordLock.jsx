import { useEffect, useRef, useState } from 'react'
import {
  verifySettingsPassword,
  setSettingsPassword,
  requestSettingsPasswordRecoveryChallenge,
  verifySettingsPasswordRecoveryCaptcha,
  resetSettingsPasswordViaRecovery,
} from '../boardApi'

/*
 * The Settings Password is a short PIN, not an account password: exactly 4
 * characters, digits expected, no composition rules. Matches
 * SETTINGS_PASSWORD_LENGTH in backend/server.js -- the backend is what
 * actually enforces this (anyone can bypass a browser check), this constant
 * only lets the form give the same answer instantly instead of waiting on a
 * round trip for a rule this simple.
 */
const SETTINGS_PASSWORD_LENGTH = 4
const SETTINGS_PASSWORD_HINT = `Settings Password must be exactly ${SETTINGS_PASSWORD_LENGTH} characters.`

/*
 * SettingsPasswordLock.jsx
 * ------------------------
 * The lock screen shown every single time Settings is opened. It sits IN
 * FRONT of SettingsDialog rather than inside it: CommunicationBoard renders
 * this first, and only mounts SettingsDialog once `onUnlocked` has fired.
 *
 * WHY THIS IS A SEPARATE COMPONENT, MOUNTED/UNMOUNTED RATHER THAN HIDDEN
 * -----------------------------------------------------------------------
 * The spec requires the unlock to be purely temporary: closing Settings, or
 * returning to the board, must re-lock it so the next open asks again. The
 * simplest way to guarantee that is to never let an "unlocked" boolean
 * survive at all -- this component holds no such flag itself, and the
 * PARENT (CommunicationBoard) only ever renders the real SettingsDialog
 * while its own `isSettingsUnlocked` state is true. The moment Settings
 * closes, the parent resets that state to false and this lock remounts
 * fresh next time, with no memory of the previous unlock. Nothing here
 * touches localStorage/sessionStorage, by design.
 *
 * THREE STAGES, all driven by the backend (never decided client-side):
 *   'checking' - briefly, while GET /api/settings-password/status loads
 *   'create'   - no Settings Password exists yet; first-time creation only
 *   'locked'   - one exists; show the password field (default) or, via
 *                "Forgot Settings Password?", the CAPTCHA recovery flow
 *
 * Props:
 *   hasSettingsPassword - whether one already exists (status already
 *                         fetched by the parent, so this does not re-fetch)
 *   onUnlocked          - called once the correct password was entered, or
 *                         a first-time password was just created
 *   onClose             - the X / Escape action, same meaning as Settings'
 *                         own close
 */
function SettingsPasswordLock({ hasSettingsPassword, onUnlocked, onClose }) {
  /*
   * 'password' - normal unlock entry (existing password)
   * 'create'   - first-time Settings Password creation (no password exists)
   * 'forgot-captcha' - recovery step 1/2: enter the shown CAPTCHA
   * 'forgot-create'  - recovery step 3: CAPTCHA passed, create a new password
   */
  const [mode, setMode] = useState(hasSettingsPassword ? 'password' : 'create')

  const [password, setPasswordValue] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [captchaText, setCaptchaText] = useState('')
  const [captchaInput, setCaptchaInput] = useState('')

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const firstFieldRef = useRef(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [mode])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function handleUnlock(event) {
    event.preventDefault()
    if (busy) return
    if (!password) {
      setError('Please enter the Settings Password.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await verifySettingsPassword(password)
      onUnlocked()
    } catch (err) {
      setError(err.message || 'Incorrect Settings Password.')
      setPasswordValue('')
    } finally {
      setBusy(false)
    }
  }

  /* Shared by first-time creation AND the post-recovery creation -- the two
     only differ in which endpoint ultimately gets called. */
  async function handleCreate(event, { viaRecovery }) {
    event.preventDefault()
    if (busy) return

    if (newPassword.length !== SETTINGS_PASSWORD_LENGTH) {
      setError(SETTINGS_PASSWORD_HINT)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (viaRecovery) {
        await resetSettingsPasswordViaRecovery(newPassword, confirmPassword)
      } else {
        await setSettingsPassword(newPassword, confirmPassword)
      }
      /*
       * Per the spec, creating/recovering a password does NOT itself unlock
       * Settings -- the caller must enter the new password, same as any
       * other lock-screen visit. Dropping back to 'password' mode (clearing
       * the fields) accomplishes that without a second round trip.
       */
      setNewPassword('')
      setConfirmPassword('')
      setPasswordValue('')
      setError('')
      setConfirmationNote(
        viaRecovery
          ? 'New Settings Password created. Please enter it to continue.'
          : 'Settings Password created. Please enter it to continue.',
      )
      setMode('password')
    } catch (err) {
      setError(err.message || 'Could not save that password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const [confirmationNote, setConfirmationNote] = useState('')

  async function startForgotFlow() {
    setBusy(true)
    setError('')
    setConfirmationNote('')
    try {
      const data = await requestSettingsPasswordRecoveryChallenge()
      setCaptchaText(data.captcha)
      setCaptchaInput('')
      setMode('forgot-captcha')
    } catch (err) {
      setError(err.message || 'Could not start recovery. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCaptchaSubmit(event) {
    event.preventDefault()
    if (busy) return
    if (!captchaInput.trim()) {
      setError('Please enter the characters shown.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await verifySettingsPasswordRecoveryCaptcha(captchaInput)
      setMode('forgot-create')
    } catch (err) {
      setError(err.message || 'That code was not correct. Please try a new one.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cpanel__backdrop" onClick={onClose}>
      <div
        className="cpanel cslock"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-lock-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cpanel__head">
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <h2 className="cpanel__title" id="settings-lock-title">
            {mode === 'create'
              ? 'Set Settings Password'
              : mode === 'forgot-captcha'
                ? "Verify it's you"
                : mode === 'forgot-create'
                  ? 'Create New Settings Password'
                  : 'Settings Locked'}
          </h2>
        </header>

        <div className="cpanel__body">
          <div className="cslock__icon" aria-hidden="true">
            🔒
          </div>

          {mode === 'password' && (
            <form className="cslock__form" onSubmit={handleUnlock}>
              <p className="cslock__intro">Enter the Settings Password to continue.</p>

              {confirmationNote && (
                <p className="cslock__note" role="status">
                  {confirmationNote}
                </p>
              )}

              <label className="cedit__field">
                <span className="cedit__label">Settings Password</span>
                <input
                  ref={firstFieldRef}
                  className="cedit__input"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => {
                    setPasswordValue(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              {error && <p className="cedit__error" role="alert">{error}</p>}

              <div className="cedit__actions">
                <button type="submit" className="cedit__btn cedit__btn--save" disabled={busy}>
                  {busy ? 'Checking…' : 'Unlock'}
                </button>
              </div>

              <button
                type="button"
                className="cslock__link"
                onClick={startForgotFlow}
                disabled={busy}
              >
                Forgot Settings Password?
              </button>
            </form>
          )}

          {mode === 'create' && (
            <form className="cslock__form" onSubmit={(event) => handleCreate(event, { viaRecovery: false })}>
              <p className="cslock__intro">
                Create a Settings Password to lock the Settings panel. This is separate from
                your account login password.
              </p>

              <label className="cedit__field">
                <span className="cedit__label">New Settings Password</span>
                <input
                  ref={firstFieldRef}
                  className="cedit__input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={SETTINGS_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              <label className="cedit__field">
                <span className="cedit__label">Confirm Settings Password</span>
                <input
                  className="cedit__input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={SETTINGS_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              <p className="cedit__hint">{SETTINGS_PASSWORD_HINT}</p>

              {error && <p className="cedit__error" role="alert">{error}</p>}

              <div className="cedit__actions">
                <button type="submit" className="cedit__btn cedit__btn--save" disabled={busy}>
                  {busy ? 'Saving…' : 'Set Password'}
                </button>
              </div>
            </form>
          )}

          {mode === 'forgot-captcha' && (
            <form className="cslock__form" onSubmit={handleCaptchaSubmit}>
              <p className="cslock__intro">Enter the characters shown below:</p>

              <p className="cslock__captcha" aria-label={`Verification code: ${captchaText}`}>
                {captchaText}
              </p>

              <label className="cedit__field">
                <span className="cedit__label">Verification code</span>
                <input
                  ref={firstFieldRef}
                  className="cedit__input"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={captchaInput}
                  onChange={(event) => {
                    setCaptchaInput(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              {error && <p className="cedit__error" role="alert">{error}</p>}

              <div className="cedit__actions">
                <button
                  type="button"
                  className="cedit__btn cedit__btn--cancel"
                  onClick={() => {
                    setMode('password')
                    setError('')
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button type="submit" className="cedit__btn cedit__btn--save" disabled={busy}>
                  {busy ? 'Checking…' : 'Verify'}
                </button>
              </div>

              <button
                type="button"
                className="cslock__link"
                onClick={startForgotFlow}
                disabled={busy}
              >
                Get a new code
              </button>
            </form>
          )}

          {mode === 'forgot-create' && (
            <form className="cslock__form" onSubmit={(event) => handleCreate(event, { viaRecovery: true })}>
              <p className="cslock__intro">Create a new Settings Password.</p>

              <label className="cedit__field">
                <span className="cedit__label">New Settings Password</span>
                <input
                  ref={firstFieldRef}
                  className="cedit__input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={SETTINGS_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              <label className="cedit__field">
                <span className="cedit__label">Confirm Settings Password</span>
                <input
                  className="cedit__input"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={SETTINGS_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value)
                    if (error) setError('')
                  }}
                />
              </label>

              <p className="cedit__hint">{SETTINGS_PASSWORD_HINT}</p>

              {error && <p className="cedit__error" role="alert">{error}</p>}

              <div className="cedit__actions">
                <button type="submit" className="cedit__btn cedit__btn--save" disabled={busy}>
                  {busy ? 'Saving…' : 'Create Password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPasswordLock
