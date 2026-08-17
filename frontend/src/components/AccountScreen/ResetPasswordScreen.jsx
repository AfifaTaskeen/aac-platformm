import { useState } from 'react'
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

  function handleBlur(fieldName) {
    setTouched({ ...touched, [fieldName]: true })
    setErrors({ ...errors, [fieldName]: validateField(fieldName, values) })
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

      // An expired, reused or malformed token lands here.
      setStatus(data?.message || 'This reset link is not valid. Please request a new one.')
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
              {isDone ? 'All done!' : 'Reset your password'}
            </h1>
            {!isDone && (
              <p className="account__subheading">Choose a new password for your account.</p>
            )}
          </div>

          {isDone ? (
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
                      onBlur={() => handleBlur('password')}
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
                    onBlur={() => handleBlur('confirmPassword')}
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
