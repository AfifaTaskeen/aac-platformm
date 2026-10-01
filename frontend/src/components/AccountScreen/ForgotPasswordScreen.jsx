import { useState } from 'react'
import BuddyLogo from '../BuddyLogo'
import TextField from './TextField'
import './AccountScreen.css'

/*
 * ForgotPasswordScreen.jsx
 * ------------------------
 * Step 1 of the password reset: ask for the email address.
 *
 * Reuses the existing AccountScreen.css and the TextField component, so this
 * screen is visually identical to Sign in -- same cream, same glow, same
 * chunky ink borders, same coral button. Nothing new was designed.
 *
 * Props:
 *   onBackToSignIn - returns to the Sign in view
 */
function ForgotPasswordScreen({ onBackToSignIn, apiBaseUrl, emailPattern }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Once the request succeeds the form is replaced by the confirmation, so the
  // user is not invited to submit the same address over and over.
  const [isSent, setIsSent] = useState(false)

  function validate(value) {
    if (!value.trim()) return 'Please enter your email address.'
    if (!emailPattern.test(value.trim())) return 'Please enter a valid email address.'
    return ''
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const problem = validate(email)
    setError(problem)
    setTouched(true)

    if (problem) {
      document.getElementById('forgot-email')?.focus()
      return
    }

    setStatus('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (response.ok) {
        /*
         * The heading/subheading above (driven by isSent) now show the fixed
         * confirmation wording directly -- nothing here needs to hold the
         * backend's own message for display.
         */
        setIsSent(true)
        return
      }

      if (data?.field === 'email') {
        setError(data.message)
        setTouched(true)
        document.getElementById('forgot-email')?.focus()
        return
      }

      setStatus(data?.message || 'Something went wrong. Please try again.')
    } catch (requestError) {
      console.log('Forgot password request failed:', requestError)
      setStatus('Could not reach the server. Please check it is running and try again.')
    } finally {
      setIsSubmitting(false)
    }
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
          {/*
            The heading itself changes once the link has been sent -- "Forgot
            your password?" and its instructions no longer apply, and must not
            keep showing above the confirmation (the email has already been
            entered and submitted; asking again visually would contradict the
            "do not ask for the email again" requirement even though the form
            below it is already gone).
          */}
          <div className="account__intro">
            <h1 className="account__heading">
              {isSent ? 'Password reset link sent' : 'Forgot your password?'}
            </h1>
            <p className="account__subheading">
              {isSent
                ? 'If an account exists for this email, check your inbox for the password reset link.'
                : "Enter your email address and we’ll send you a link to reset your password."}
            </p>
          </div>

          {/*
            Once the link has been sent the form is replaced by the
            confirmation. Conditional rendering, the same pattern the account
            screen uses to switch between its two views.
          */}
          {isSent ? (
            <button type="button" className="account__primary" onClick={onBackToSignIn}>
              Back to Sign in
            </button>
          ) : (
            <>
              <form className="account__form" onSubmit={handleSubmit} noValidate>
                <div className="account__fields">
                  <TextField
                    id="forgot-email"
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(next) => {
                      setEmail(next)
                      // Clear the message as soon as it is being fixed.
                      if (error) setError(validate(next))
                    }}
                    onBlur={() => {
                      setTouched(true)
                      setError(validate(email))
                    }}
                    error={touched ? error : ''}
                    autoComplete="email"
                  />
                </div>

                <button type="submit" className="account__primary" disabled={isSubmitting}>
                  {isSubmitting ? 'Sending…' : 'Send reset link'}
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

export default ForgotPasswordScreen
