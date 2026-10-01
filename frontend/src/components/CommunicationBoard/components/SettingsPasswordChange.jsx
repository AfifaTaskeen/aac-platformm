import { useRef, useState, useEffect } from 'react'
import { setSettingsPassword, changeSettingsPassword } from '../boardApi'

/* Matches SETTINGS_PASSWORD_LENGTH in backend/server.js -- see
   SettingsPasswordLock.jsx for why this is a short PIN, not an account
   password: the backend is the real enforcement point either way. */
const SETTINGS_PASSWORD_LENGTH = 4
const SETTINGS_PASSWORD_HINT = `Settings Password must be exactly ${SETTINGS_PASSWORD_LENGTH} characters.`

/*
 * SettingsPasswordChange.jsx
 * --------------------------
 * The Account -> "Set/Change Settings Password" form.
 *
 * Which fields show depends only on `hasSettingsPassword` (a prop, fetched
 * once by CommunicationBoard): no account yet asks for new+confirm only;
 * one that already exists additionally asks for the CURRENT Settings
 * Password first, and the backend independently re-checks that current
 * password server-side regardless of what this form sends.
 *
 * Props:
 *   hasSettingsPassword - whether one already exists
 *   onDone              - called after a successful save
 *   onCancel            - back to the Account screen without saving
 */
function SettingsPasswordChange({ hasSettingsPassword, onDone, onCancel }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const firstFieldRef = useRef(null)
  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (busy) return

    if (hasSettingsPassword && !currentPassword) {
      setError('Please enter your current Settings Password.')
      return
    }

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
      if (hasSettingsPassword) {
        await changeSettingsPassword(currentPassword, newPassword, confirmPassword)
      } else {
        await setSettingsPassword(newPassword, confirmPassword)
      }
      onDone()
    } catch (err) {
      setError(err.message || 'Could not save that password. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="cslock__form" onSubmit={handleSubmit}>
      <p className="cslock__intro">
        {hasSettingsPassword
          ? 'Enter your current Settings Password, then choose a new one.'
          : 'Create a Settings Password to lock the Settings panel. This is separate from your account login password.'}
      </p>

      {hasSettingsPassword && (
        <label className="cedit__field">
          <span className="cedit__label">Current Settings Password</span>
          <input
            ref={firstFieldRef}
            className="cedit__input"
            type="password"
            autoComplete="off"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value)
              if (error) setError('')
            }}
          />
        </label>
      )}

      <label className="cedit__field">
        <span className="cedit__label">New Settings Password</span>
        <input
          ref={hasSettingsPassword ? null : firstFieldRef}
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
        <span className="cedit__label">Confirm New Settings Password</span>
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
        <button type="button" className="cedit__btn cedit__btn--cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="cedit__btn cedit__btn--save" disabled={busy}>
          {busy ? 'Saving…' : hasSettingsPassword ? 'Change Password' : 'Set Password'}
        </button>
      </div>
    </form>
  )
}

export default SettingsPasswordChange
