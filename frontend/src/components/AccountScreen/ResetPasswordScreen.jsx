import { useState, useEffect } from 'react'
import BuddyLogo from '../BuddyLogo'
import TextField from './TextField'
import { API_BASE_URL, PASSWORD_HELP_TEXT, passwordMeetsAllRules } from './authConfig'
import './AccountScreen.css'

/*
 * ResetPasswordScreen.jsx
 * -----------------------
 * Step 2 of the password reset: choose a new password.
 *
 * Opened from the emailed link, which carries the token as a query parameter:
 *   http://localhost:5174/reset-password?token=...
 *
 * Reuses AccountScreen.css, TextField, and the SAME password rules the sign-up
 * form uses -- imported rather than copied, so the two can never disagree.
 *
 * Props:
 *   token          - the raw token taken from the URL
 *   onBackToSignIn - returns to the Sign in view
 */
function ResetPasswordScreen({ token, onBackToSignIn }) {
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDone, setIsDone] = useState(false)

  /*
   * CHECKING THE LINK BEFORE EVER SHOWING THE FORM.
   *
   * 'checking' - just opened; asking the backend whether this token is
   *              still usable. Nothing is shown yet but the logo/heading,
   *              so a second click on an already-used email link is never
   *              walked through a form that was always going to fail.
   * 'valid'    - the form is shown.
   * 'invalid'  - the token has expired, was already used, or is missing/
   *              malformed. The form is never shown; only the message and
   *              a way back to Sign in.
   *
   * A check that could not be COMPLETED (network/server error) is treated
   * as 'valid' rather than 'invalid' -- the form still opens, and a genuinely
   * dead token is caught the same way it always was, when Reset is pressed.
   * Claiming a link is dead because this one extra request failed would be
   * worse than the inconvenience of finding out on submit instead.
   */
  const [linkState, setLinkState] = useState(token ? 'checking' : 'invalid')

  useEffect(() => {
    if (!token) {
      setLinkState('invalid')
      return
    }

    let cancelled = false

    async function checkValidity() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/auth/reset-password/validity?token=${encodeURIComponent(token)}`,
          { method: 'GET' },
        )

        if (cancelled) return

        if (!response.ok) {
          // Could not complete the check -- fall through to the form.
          setLinkState('valid')
          return
        }

        const data = await response.json().catch(() => null)

        if (data?.success === false) {
          setLinkState('valid')
          return
        }

        setLinkState(data?.valid ? 'valid' : 'invalid')
      } catch (error) {
        if (cancelled) return
        console.log('Could not check the reset link:', error)
        // Network failure -- same reasoning as above: let the form open.
        setLinkState('valid')
      }
    }

    checkValidity()

    return () => {
      cancelled = true
    }
  }, [token])

  function validateField(fieldName, nextValues) {
    if (fieldName === 'password') {
      if (!nextValues.password) return 'Please enter a new password.'
      if (!passwordMeetsAllRules(nextValues.password)) {
        return 'Please meet all the password requirements below.'
      }
      return ''
    }

    if (fieldName === 'confirmPassword') {
      if (!nextValues.confirmPassword) return 'Please confirm your new password.'
      if (nextValues.confirmPassword !== nextValues.password) return 'Passwords do not match.'
      return ''
    }

    return ''
  }

  /*
   * VALIDATION TIMING ON THIS SCREEN, SPECIFICALLY: neither typing nor
   * leaving a field (blur) shows an error -- only an actual Reset Password
   * press does, and once shown, it disappears the moment the field becomes
   * valid. This is a deliberate difference from the Sign-Up form (which does
   * validate on blur): scoped to this screen only, by explicit request.
   */
  function handleChange(fieldName, nextValue) {
    const nextValues = { ...values, [fieldName]: nextValue }
    setValues(nextValues)
    setStatus('')

    // Only re-check a field that is already showing an error, so the message
    // clears as soon as it is fixed without nagging mid-word.
    if (errors[fieldName]) {
      setErrors({ ...errors, [fieldName]: validateField(fieldName, nextValues) })
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const fields = ['password', 'confirmPassword']
    const nextErrors = {}
    const nextTouched = {}
    fields.forEach((fieldName) => {
      nextErrors[fieldName] = validateField(fieldName, values)
      nextTouched[fieldName] = true
    })

    setErrors(nextErrors)
    setTouched(nextTouched)

    const firstBroken = fields.find((fieldName) => nextErrors[fieldName])
    if (firstBroken) {
      document.getElementById(firstBroken)?.focus()
      return
    }

    setStatus('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // confirmPassword stays in the browser -- the server has no use for it.
        body: JSON.stringify({ token, password: values.password }),
      })

      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (response.ok) {
        setIsDone(true)
        setStatus(data?.message || 'Password reset successfully.')
        // Do not leave the new password sitting in state or on screen.
        setValues({ password: '', confirmPassword: '' })
        return
      }

      if (data?.field === 'password') {
        setErrors({ password: data.message })
        setTouched({ ...nextTouched, password: true })
        document.getElementById('password')?.focus()
        return
      }

      /*
       * The token died between the on-load check and this submit -- a real
       * but narrow race (the link's own 30-minute window ran out, or it was
       * used in another tab, while this tab sat open on the form). Switching
       * to the same 'invalid' state the on-load check would have shown keeps
       * the experience identical either way, rather than leaving a status
       * message under a form that can now never succeed.
       */
      setLinkState('invalid')
    } catch (requestError) {
      console.log('Reset password request failed:', requestError)
      setStatus('Could not reach the server. Please check it is running and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function errorFor(fieldName) {
    return touched[fieldName] ? errors[fieldName] || '' : ''
  }

  return (
    <div className="account">
      <div className="account__glow" aria-hidden="true" />

      <header className="account__brand">
        <BuddyLogo className="account__logo" title="Buddy Talk" />
        <span className="account__brand-name">Buddy Talk</span>
      </header>

      <div className="account__body">
        <div className="account__panel account__panel--signin">
          <div className="account__intro">
            <h1 className="account__heading">
              {linkState === 'invalid'
                ? 'This link is no longer valid'
                : isDone
                  ? 'All done!'
                  : 'Reset your password'}
            </h1>
            {linkState === 'valid' && !isDone && (
              <p className="account__subheading">Choose a new password for your account.</p>
            )}
          </div>

          {linkState === 'checking' ? (
            /*
             * Nothing to do yet but wait for the one quick GET above --
             * deliberately no form, no button, so there is nothing to press
             * before the link is known to actually be usable.
             */
            <p className="account__status" role="status" aria-live="polite">
              Checking your link…
            </p>
          ) : linkState === 'invalid' ? (
            <>
              <p className="account__status" role="status" aria-live="polite">
                This password reset link has expired or has already been used.
                Please request a new reset link.
              </p>
              <button type="button" className="account__primary" onClick={onBackToSignIn}>
                Back to Sign in
              </button>
            </>
          ) : isDone ? (
            <>
              <p className="account__status" role="status" aria-live="polite">
                {status}
              </p>
              <button type="button" className="account__primary" onClick={onBackToSignIn}>
                Back to Sign in
              </button>
            </>
          ) : (
            <>
              <form className="account__form" onSubmit={handleSubmit} noValidate>
                <div className="account__fields">
                  {/* Field + helper text wrapped as ONE grid cell, so the text
                      sits directly below the input rather than beside it. */}
                  <div className="account__password-group">
                    <TextField
                      id="password"
                      label="New password"
                      type="password"
                      value={values.password}
                      onChange={(next) => handleChange('password', next)}
                      error={errorFor('password')}
                      autoComplete="new-password"
                      canReveal
                      isRevealed={showPassword}
                      onToggleReveal={() => setShowPassword(!showPassword)}
                      describedBy="reset-password-help"
                    />
                    <p className="account__password-help" id="reset-password-help">
                      {PASSWORD_HELP_TEXT}
                    </p>
                  </div>

                  <TextField
                    id="confirmPassword"
                    label="Confirm new password"
                    type="password"
                    value={values.confirmPassword}
                    onChange={(next) => handleChange('confirmPassword', next)}
                    error={errorFor('confirmPassword')}
                    autoComplete="new-password"
                    canReveal
                    isRevealed={showConfirmPassword}
                    onToggleReveal={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                </div>

                <button type="submit" className="account__primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Resetting…' : 'Reset password'}
                </button>

                <p className="account__status" role="status" aria-live="polite">
                  {status}
                </p>
              </form>

              <p className="account__switch">
                <button type="button" className="account__switch-button" onClick={onBackToSignIn}>
                  Back to Sign in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ResetPasswordScreen
