import { useState, useRef, useEffect } from 'react'
import BuddyLogo from '../BuddyLogo'
import TextField from './TextField'
import './AccountScreen.css'

/*
 * AccountScreen.jsx
 * -----------------
 * One screen with two views: Create account and Sign in.
 *
 * They are NOT separate pages. A single piece of state -- `mode` -- decides
 * which set of fields is on screen. The card, the background, the logo and the
 * illustration never move, which is what makes the two views feel like one
 * screen rather than two.
 *
 * ============================================================
 * AUTHENTICATION IS NOT CONNECTED YET.
 *
 * Everything here is frontend only. There is no backend, no database, no
 * Google OAuth. Submitting a valid form logs the values and shows a message
 * saying so -- it does NOT create an account or sign anyone in.
 *
 * When the backend exists, the only place that needs to change is
 * handleSubmit() below, plus the two onClick stubs marked TODO.
 * ============================================================
 */

/*
 * A deliberately forgiving email check: something, an @, something, a dot,
 * something. Real address validation is the backend's job -- the frontend's
 * job is only to catch obvious typos before the user waits for a round trip.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const MIN_PASSWORD_LENGTH = 8

/* Which fields belong to which view. */
const FIELDS_BY_MODE = {
  signup: ['name', 'email', 'password', 'confirmPassword'],
  signin: ['email', 'password'],
}

const EMPTY_VALUES = { name: '', email: '', password: '', confirmPassword: '' }

/*
 * Returns an error message for one field, or '' when it is fine.
 * Kept outside the component because it does not need state -- it is just a
 * plain function of its inputs, which also makes it easy to reason about.
 */
function validateField(fieldName, values, mode) {
  switch (fieldName) {
    case 'name':
      if (mode !== 'signup') return ''
      if (!values.name.trim()) return 'Please enter your name.'
      return ''

    case 'email':
      if (!values.email.trim()) return 'Please enter your email address.'
      if (!EMAIL_PATTERN.test(values.email.trim())) return 'Please enter a valid email address.'
      return ''

    case 'password':
      // Passwords are never trimmed -- a leading space may be intentional.
      if (!values.password) return 'Please enter your password.'
      if (mode === 'signup' && values.password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      }
      return ''

    case 'confirmPassword':
      if (mode !== 'signup') return ''
      if (!values.confirmPassword) return 'Please confirm your password.'
      if (values.confirmPassword !== values.password) return 'Passwords do not match.'
      return ''

    default:
      return ''
  }
}

function AccountScreen() {
  /*
   * THE STATE
   *
   * mode      - which view is showing: 'signup' or 'signin'
   * values    - what is currently typed in each field
   * errors    - the current error message for each field ('' means valid)
   * touched   - which fields the user has finished with, so we only show an
   *             error once they have actually left the field
   * showPassword / showConfirmPassword - the Show/Hide toggles
   * status    - the temporary "form is valid" message (stands in for the
   *             real sign-up / sign-in call that does not exist yet)
   */
  const [mode, setMode] = useState('signup')
  const [values, setValues] = useState(EMPTY_VALUES)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [status, setStatus] = useState('')

  const isSignup = mode === 'signup'

  /*
   * A ref is a way to reach a real DOM element. We use it to move keyboard
   * focus to the heading after switching views, so someone using a screen
   * reader hears that the form changed instead of being left where they were.
   */
  const headingRef = useRef(null)
  const hasSwitchedRef = useRef(false)

  useEffect(() => {
    // Skip the very first render -- only move focus on an actual switch.
    if (hasSwitchedRef.current) {
      headingRef.current?.focus()
    } else {
      hasSwitchedRef.current = true
    }
  }, [mode])

  /* ---------------------------------------------------------------------
   * EVENT HANDLERS
   * ------------------------------------------------------------------- */

  function handleChange(fieldName, nextValue) {
    const nextValues = { ...values, [fieldName]: nextValue }
    setValues(nextValues)
    setStatus('')

    /*
     * Deliberately NOT validating on every keystroke -- that shouts at people
     * mid-word. The one exception: if the field is already showing an error,
     * re-check it so the message disappears the moment it is fixed.
     */
    if (errors[fieldName]) {
      setErrors({ ...errors, [fieldName]: validateField(fieldName, nextValues, mode) })
    }
  }

  function handleBlur(fieldName) {
    setTouched({ ...touched, [fieldName]: true })
    setErrors({ ...errors, [fieldName]: validateField(fieldName, values, mode) })
  }

  function handleSubmit(event) {
    // Stops the browser doing its own page-reloading form submit.
    event.preventDefault()

    // Check every field that belongs to the current view.
    const fields = FIELDS_BY_MODE[mode]
    const nextErrors = {}
    const nextTouched = {}
    fields.forEach((fieldName) => {
      nextErrors[fieldName] = validateField(fieldName, values, mode)
      nextTouched[fieldName] = true
    })

    setErrors(nextErrors)
    setTouched(nextTouched)

    const firstBroken = fields.find((fieldName) => nextErrors[fieldName])
    if (firstBroken) {
      // Send focus to the first problem so keyboard users are not hunting.
      document.getElementById(firstBroken)?.focus()
      setStatus('')
      return
    }

    /*
     * TODO: connect to the backend here.
     * For now this only proves the form works. Nothing is saved and nobody is
     * signed in.
     */
    console.log('Form is valid. Values would be sent to the backend:', values)
    setStatus(
      isSignup
        ? 'Your details look good. Creating accounts is not connected yet.'
        : 'Your details look good. Signing in is not connected yet.',
    )
  }

  /* Flips between the two views without navigating anywhere. */
  function switchMode() {
    setMode(isSignup ? 'signin' : 'signup')
    // Clear the messages, but keep what was typed so switching is not punishing.
    setErrors({})
    setTouched({})
    setStatus('')
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  /* Only show an error once the field has been left or the form submitted. */
  function errorFor(fieldName) {
    return touched[fieldName] ? errors[fieldName] || '' : ''
  }

  return (
    <div className="account">
      {/*
        The only decoration on this screen is the soft warm glow carried over
        from the splash. The children, speech bubbles and grass live on the
        splash screen; repeating them here cost the form more vertical space
        than the whole Google button, and pushed the bottom controls off the
        viewport. This screen earns its Buddy Talk identity from the logo,
        palette, typography and chunky rounded shapes instead.
      */}
      <div className="account__glow" aria-hidden="true" />

      <header className="account__brand">
        <BuddyLogo className="account__logo" title="Buddy Talk" />
        <span className="account__brand-name">Buddy Talk</span>
      </header>

      <div className="account__body">
        {/*
          A plain layout wrapper -- no border, no background, no shadow. The
          form sits directly on the cream. This element still earns its place
          by holding the max-width and by being the hook the two-column field
          rule needs on short screens.

          The modifier lets the CSS keep the two sign-in fields full width
          where sign-up puts its four in two columns.
        */}
        <div className={`account__panel ${isSignup ? '' : 'account__panel--signin'}`}>
          <div className="account__intro">
            {/*
              tabIndex={-1} lets us move focus here in code (after switching
              views) without adding the heading to the normal Tab order.
            */}
            <h1 className="account__heading" ref={headingRef} tabIndex={-1}>
              {isSignup ? 'Create your account' : 'Welcome back!'}
            </h1>
            {/* Sign-up has no subheading -- the heading says enough on its own. */}
            {!isSignup && <p className="account__subheading">Sign in to keep going</p>}
          </div>

          {/*
            A real <form>, so pressing Enter in any field submits it.
            noValidate turns off the browser's own popup messages, because we
            show our own that are larger and easier to read.

            key={mode} makes React build a fresh form when the view changes,
            which is what lets the fade animation replay each time.
          */}
          <form className="account__form" onSubmit={handleSubmit} noValidate key={mode}>
            {/*
              The fields sit in a CSS grid. In portrait it is a single column;
              on a short landscape screen the CSS switches it to two columns,
              which halves the height of the field stack. Same fields, same
              order, no JSX change -- the layout is entirely CSS's job.
            */}
            <div className="account__fields">
              {/* Conditional rendering: this field only exists in the sign-up view. */}
              {isSignup && (
                <TextField
                  id="name"
                  label="Name"
                  value={values.name}
                  onChange={(next) => handleChange('name', next)}
                  onBlur={() => handleBlur('name')}
                  error={errorFor('name')}
                  autoComplete="name"
                />
              )}

              <TextField
                id="email"
                label="Email"
                type="email"
                value={values.email}
                onChange={(next) => handleChange('email', next)}
                onBlur={() => handleBlur('email')}
                error={errorFor('email')}
                autoComplete="email"
              />

              <TextField
                id="password"
                label="Password"
                type="password"
                value={values.password}
                onChange={(next) => handleChange('password', next)}
                onBlur={() => handleBlur('password')}
                error={errorFor('password')}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                canReveal
                isRevealed={showPassword}
                onToggleReveal={() => setShowPassword(!showPassword)}
                /* Stating the rule up front, on the label row, rather than as
                   an error after the fact -- and it costs no extra height. */
                hint={isSignup ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
              />

              {isSignup && (
                <TextField
                  id="confirmPassword"
                  label="Confirm password"
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
              )}
            </div>

            {!isSignup && (
              <div className="account__forgot-row">
                {/* TODO: connect to password recovery once the backend exists. */}
                <button type="button" className="account__link">
                  Forgot password?
                </button>
              </div>
            )}

            <button type="submit" className="account__primary">
              {isSignup ? 'Create account' : 'Sign in'}
            </button>

            {/*
              aria-live means a screen reader announces this message when it
              appears, without the user having to go looking for it.
            */}
            <p className="account__status" role="status" aria-live="polite">
              {status}
            </p>
          </form>

          <div className="account__divider" aria-hidden="true">
            <span>or</span>
          </div>

          {/* TODO: connect real Google sign-in later. This button is UI only. */}
          <button type="button" className="account__google">
            <svg className="account__google-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.55-5.17 3.55-8.87Z"
                fill="#4285F4"
              />
              <path
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.13 0-5.78-2.11-6.73-4.96h-4v3.09A11.99 11.99 0 0 0 12 24Z"
                fill="#34A853"
              />
              <path d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62h-4a12 12 0 0 0 0 10.76l4-3.09Z" fill="#FBBC05" />
              <path
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A11.99 11.99 0 0 0 1.28 6.62l4 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>

          {/*
            Plain sentence on the cream background -- no box, oval or pill.
            Only the action word is a button, so only it is focusable and
            clickable. It stays a real <button> rather than a styled <span>
            so keyboard and screen-reader users still get a proper control.
          */}
          <p className="account__switch">
            {isSignup ? 'Already have an account?' : 'Don’t have an account?'}{' '}
            <button type="button" className="account__switch-button" onClick={switchMode}>
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default AccountScreen
