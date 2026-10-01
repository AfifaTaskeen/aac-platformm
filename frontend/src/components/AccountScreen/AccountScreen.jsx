import { useState, useRef, useEffect } from 'react'
import BuddyLogo from '../BuddyLogo'
import TextField from './TextField'
import {
  API_BASE_URL,
  EMAIL_PATTERN,
  PASSWORD_HELP_TEXT,
  passwordMeetsAllRules,
} from './authConfig'
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
 * Google's public Client ID, read from frontend/.env.local at build time.
 *
 * This is NOT a secret -- it identifies the app to Google and is visible to
 * anyone who views the page source. The Client SECRET is a different value and
 * must never appear in frontend code; it stays in backend/.env only.
 *
 * Vite only exposes variables whose name starts with VITE_.
 */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

/* Google's official sign-in library. */
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

/*
 * Loads Google's script once and remembers the promise, so several calls all
 * wait on the same load rather than adding the tag repeatedly.
 */
let googleScriptPromise = null

function loadGoogleScript() {
  if (googleScriptPromise) return googleScriptPromise

  googleScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = GOOGLE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later attempt retry instead of failing forever.
      googleScriptPromise = null
      reject(new Error('Could not load Google sign-in.'))
    }
    document.head.appendChild(script)
  })

  return googleScriptPromise
}


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
      /*
       * The strength rules apply to SIGN-UP only. Sign-in must accept whatever
       * an existing account was created with, or anyone who registered before
       * these rules existed would be locked out of their own account.
       */
      if (mode === 'signup' && !passwordMeetsAllRules(values.password)) {
        return 'Please meet all the password requirements below.'
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

/*
 * Props:
 *   onAuthenticated - called with the user object once sign-up or sign-in
 *                     succeeds. App.jsx decides what happens next; this
 *                     component only owns the form.
 */
function AccountScreen({ onAuthenticated, onForgotPassword }) {
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
  // True while a request is in flight, so the button can show progress and
  // refuse a second press.
  const [isSubmitting, setIsSubmitting] = useState(false)

  /*
   * When Google sign-in is refused because the user pressed the wrong button,
   * this holds which mode they should be in ('signup' or 'signin') so we can
   * offer a button that takes them there. '' means no offer showing.
   */
  const [googleOffer, setGoogleOffer] = useState('')

  const isSignup = mode === 'signup'

  /*
   * A ref is a way to reach a real DOM element. We use it to move keyboard
   * focus to the heading after switching views, so someone using a screen
   * reader hears that the form changed instead of being left where they were.
   */
  const headingRef = useRef(null)
  const hasSwitchedRef = useRef(false)
  /*
   * Where Google renders its own (visually hidden) sign-in button. See
   * handleGoogleClick for why this indirection is needed.
   */
  const googleHostRef = useRef(null)

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

  /*
   * `async` lets this function pause on `await` while the network request is
   * in flight, without freezing the page. React re-renders normally the whole
   * time, so the button can show "Creating account..." while we wait.
   */
  async function handleSubmit(event) {
    // Stops the browser doing its own page-reloading form submit.
    event.preventDefault()

    // Ignore a second press while the first request is still running.
    if (isSubmitting) return

    // Check every field that belongs to the current view. For sign-up this
    // includes confirmPassword, whose rule is "must match password" -- so the
    // passwords are confirmed to match before anything is sent.
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
      /*
       * A mismatched confirm-password is treated specially: both password
       * fields are cleared rather than left showing a value that is now
       * known to be wrong (or a typo of it), so the person retypes both
       * rather than fixing just one against a guess of what the other said.
       */
      if (firstBroken === 'confirmPassword') {
        setValues((current) => ({ ...current, password: '', confirmPassword: '' }))
        setShowPassword(false)
        setShowConfirmPassword(false)
        document.getElementById('password')?.focus()
        setStatus('')
        return
      }

      // Send focus to the first problem so keyboard users are not hunting.
      document.getElementById(firstBroken)?.focus()
      setStatus('')
      return
    }

    setStatus('')
    setIsSubmitting(true)

    try {
      /*
       * Both views post to the same backend, just to different routes with
       * different fields:
       *   sign up -> /api/auth/register with name, email, password
       *   sign in -> /api/auth/login    with email, password
       *
       * confirmPassword never leaves the browser in either case -- it exists
       * purely to catch a typo, and the server has no use for it.
       */
      const endpoint = isSignup ? '/api/auth/register' : '/api/auth/login'
      const payload = isSignup
        ? { name: values.name, email: values.email, password: values.password }
        : { email: values.email, password: values.password }

      /*
       * fetch() sends the HTTP request. It returns a Promise, so `await` waits
       * for the server to answer before the next line runs.
       */
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * Lets the browser keep the httpOnly session cookie the backend sends
         * back on a successful sign-in. Without this the cookie is silently
         * discarded and the user would not stay signed in.
         */
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      // The reply arrives as JSON text; this turns it back into an object.
      // Wrapped in case the server ever answers with something that is not
      // JSON, which would otherwise throw a confusing parse error.
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      /*
        ---- Success ----
        201 Created  = the account now exists in MongoDB (sign up)
        200 OK       = the credentials were correct (sign in)
      */
      if (response.status === 201 || response.status === 200) {
        setStatus(
          data?.message || (isSignup ? 'Account created successfully.' : 'Signed in successfully.'),
        )
        // Clear the form so the password is not left sitting on screen.
        setValues(EMPTY_VALUES)
        setErrors({})
        setTouched({})
        setShowPassword(false)
        setShowConfirmPassword(false)

        /*
         * Hand the signed-in user up to App.jsx, which owns what comes next.
         * Doing it through a prop keeps this component responsible only for
         * the form -- it does not need to know what the next screen is.
         */
        if (onAuthenticated && data?.user) {
          /*
           * 201 means the account was just created, so there cannot be a child
           * profile yet. Flagging it lets App skip the lookup and go straight
           * to profile setup -- and means a new user is never asked to sign in
           * again after registering.
           */
          onAuthenticated({ ...data.user, isNewAccount: response.status === 201 })
        }
        return
      }

      /*
        ---- 401 Unauthorized: wrong email or password (sign in) ----
        Shown under the Sign in button rather than on a field, because the
        server deliberately does not say WHICH of the two was wrong -- naming
        the field would leak whether that email has an account here.

        The password is cleared (email is left alone) so a wrong guess is
        never sitting in the field for someone else to see, and so the next
        attempt cannot be submitted by accident without being retyped.
      */
      if (response.status === 401) {
        setStatus(data?.message || 'Invalid email or password.')
        setValues((current) => ({ ...current, password: '' }))
        setShowPassword(false)
        document.getElementById('password')?.focus()
        return
      }

      /* ---- 409 Conflict: that email is already registered ---- */
      if (response.status === 409) {
        const message = data?.message || 'An account with this email already exists.'
        setErrors({ email: message })
        setTouched({ ...nextTouched, email: true })
        document.getElementById('email')?.focus()
        return
      }

      /* ---- 400 Bad Request: the server rejected a field ---- */
      if (response.status === 400) {
        const message = data?.message || 'Please check your details and try again.'
        /*
         * The server names which field was wrong, so the message can be shown
         * on that field rather than as a vague banner. If it does not, fall
         * back to the status line.
         */
        if (data?.field && FIELDS_BY_MODE[mode].includes(data.field)) {
          setErrors({ [data.field]: message })
          setTouched({ ...nextTouched, [data.field]: true })
          document.getElementById(data.field)?.focus()
        } else {
          setStatus(message)
        }
        return
      }

      /* ---- anything else (500, and any status not handled above) ---- */
      setStatus(data?.message || 'Something went wrong. Please try again.')
    } catch (error) {
      /*
       * fetch() only throws when the request could not be made at all --
       * the server is down, the address is wrong, or the network dropped.
       * An HTTP error like 400 or 409 is a normal, successful response and
       * lands in the code above, not here.
       */
      console.log('Registration request failed:', error)
      setStatus('Could not reach the server. Please check it is running and try again.')
    } finally {
      // Runs whether the request succeeded or failed, so the button can never
      // get stuck saying "Creating account...".
      setIsSubmitting(false)
    }
  }

  /*
   * Called by Google once the user has picked an account and consented.
   * `response.credential` is the ID token: a signed JWT describing who they
   * are. The browser does not trust it or read it -- it forwards it to our
   * backend, which verifies Google's signature before believing anything.
   */
  async function handleGoogleCredential(response) {
    setStatus('')
    setGoogleOffer('')
    setIsSubmitting(true)

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * Lets the browser store the httpOnly session cookie the backend
         * sends back. Without this the cookie is silently discarded and the
         * user would not stay signed in.
         */
        credentials: 'include',
        /*
         * Only the token. Google is for signing IN to an account that already
         * exists, on both views, so there is nothing else to tell the backend
         * -- and deliberately no field that could ask it to create an account.
         */
        body: JSON.stringify({ credential: response.credential }),
      })

      let data = null
      try {
        data = await res.json()
      } catch {
        data = null
      }

      if (res.ok) {
        setStatus(
          data?.user?.name
            ? `Signed in as ${data.user.name}.`
            : data?.message || 'Signed in with Google.',
        )

        /*
         * Hand the user up to App, which runs the same child-profile check a
         * password sign-in runs -- and, for a brand-new Google account, skips
         * straight to Child Profile instead, exactly as a fresh password
         * sign-up does. `isNewAccount` lives on `data`, not `data.user`, so it
         * has to be merged onto the object App actually reads.
         */
        if (onAuthenticated && data?.user) {
          onAuthenticated({ ...data.user, isNewAccount: Boolean(data.isNewAccount) })
        }
        return
      }

      /*
       * No Buddy Talk account for this Google identity. Show the message and
       * offer the Sign up view, which is the only place an account is made.
       */
      if (data?.code === 'NO_ACCOUNT') {
        setStatus(data.message)
        setGoogleOffer('signup')
        return
      }

      setStatus(data?.message || 'Google sign-in failed. Please try again.')
    } catch (error) {
      console.log('Google sign-in request failed:', error)
      setStatus('Could not reach the server. Please check it is running and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  /*
   * Runs when the user presses "Continue with Google".
   * Loads Google's library, then opens its account-picker popup.
   */
  async function handleGoogleClick() {
    if (isSubmitting) return

    if (!GOOGLE_CLIENT_ID) {
      setStatus('Google sign-in is not configured yet. Add VITE_GOOGLE_CLIENT_ID to frontend/.env.local.')
      return
    }

    setStatus('')

    try {
      await loadGoogleScript()

      /*
       * Google will not let a site render its sign-in flow into an arbitrary
       * button, so the reliable pattern for a CUSTOM-styled button is to have
       * Google render its own real button into a hidden container and click
       * that. The user sees only your Buddy Talk button; Google sees a genuine
       * click on its own element, which is what its popup requires.
       *
       * The alternative, google.accounts.id.prompt(), is the "One Tap" bar --
       * it is dismissible, rate-limited, and often silently suppressed, so it
       * is not dependable as a button action.
       */
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        ux_mode: 'popup',
      })

      const host = googleHostRef.current
      if (!host) return

      // Render once, then reuse on later clicks.
      if (!host.hasChildNodes()) {
        window.google.accounts.id.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
        })
      }

      const realGoogleButton = host.querySelector('div[role="button"], button')
      if (realGoogleButton) {
        realGoogleButton.click()
      } else {
        setStatus('Could not start Google sign-in. Please try again.')
      }
    } catch (error) {
      console.log('Google sign-in could not start:', error)
      setStatus('Could not load Google sign-in. Please check your connection and try again.')
    }
  }

  /*
   * Goes to the Sign up view specifically (not a toggle), used by the offer
   * shown when a Google account has no Buddy Talk account yet.
   */
  function goToSignUp() {
    setMode('signup')
    setErrors({})
    setTouched({})
    setStatus('')
    setGoogleOffer('')
    setIsSubmitting(false)
  }

  /*
   * Flips between the two views without navigating anywhere.
   *
   * Clears every field, not just the messages: a password typed on one view
   * must never still be sitting in the field on the other, and Sign In in
   * particular must always open with empty email/password (see the incoming
   * requirement this now satisfies -- registration state must not carry
   * over to Sign In).
   */
  function switchMode() {
    setMode(isSignup ? 'signin' : 'signup')
    setValues(EMPTY_VALUES)
    setErrors({})
    setTouched({})
    setStatus('')
    setGoogleOffer('')
    setShowPassword(false)
    setShowConfirmPassword(false)
    setIsSubmitting(false)
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

              {/*
                The Password field and its helper text are wrapped together in
                ONE element on purpose.

                .account__fields is a grid that becomes two columns on wider
                screens. Previously the field and the <p> were siblings, so the
                grid treated them as two separate cells and placed the helper
                text in the column BESIDE the password rather than under it.
                Wrapping them makes the pair a single grid cell, so the text
                always sits directly below the input and shares its left edge.
              */}
              <div className="account__password-group">
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
                  /* Ties the helper text below to this field for screen readers. */
                  describedBy={isSignup ? 'password-help' : ''}
                />

                {/*
                  The rules themselves are unchanged -- PASSWORD_RULES still
                  drives validateField(), so submission is blocked exactly as
                  before. This text only describes them.

                  id="password-help" is referenced by the Password field's
                  aria-describedby, so a screen reader reads the requirement
                  when the field is focused rather than it being orphaned.
                */}
                {isSignup && (
                  <p className="account__password-help" id="password-help">
                    {PASSWORD_HELP_TEXT}
                  </p>
                )}
              </div>

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
                <button type="button" className="account__link" onClick={onForgotPassword}>
                  Forgot password?
                </button>
              </div>
            )}

            {/*
              Disabled only while a request is actually in flight -- never
              because fields are empty. A button that is dead before you have
              typed explains nothing; this one can always be pressed, and the
              form then tells you what is missing.
            */}
            <button type="submit" className="account__primary" disabled={isSubmitting}>
              {isSubmitting
                ? isSignup
                  ? 'Creating account…'
                  : 'Signing in…'
                : isSignup
                  ? 'Create account'
                  : 'Sign in'}
            </button>

            {/*
              aria-live means a screen reader announces this message when it
              appears, without the user having to go looking for it.
            */}
            <p className="account__status" role="status" aria-live="polite">
              {status}
            </p>

            {/*
              Shown only when Google sign-in was refused because the wrong
              Google account has no Buddy Talk account yet. It goes to the Sign
              up view, which is the only place an account is created.

              It sets the mode DIRECTLY rather than calling switchMode(): the
              refusal can happen on either view, and a toggle would send
              someone already on Sign up to the wrong place.

              Reuses the existing switch-button styling -- no new visual
              language.
            */}
            {googleOffer && (
              <p className="account__switch">
                <button type="button" className="account__switch-button" onClick={goToSignUp}>
                  Create an account
                </button>
              </p>
            )}
          </form>

          <div className="account__divider" aria-hidden="true">
            <span>or</span>
          </div>

          {/*
            Google sign-in. The styling is untouched -- the only additions are
            the click handler and the disabled state while a request runs.
          */}
          <button
            type="button"
            className="account__google"
            onClick={handleGoogleClick}
            disabled={isSubmitting}
          >
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
            Google renders its own button in here. It is visually hidden but
            NOT display:none -- Google refuses to work inside a hidden element.
            aria-hidden and tabIndex keep it out of the accessibility tree and
            the tab order, so screen-reader and keyboard users only ever meet
            the real Buddy Talk button above.
          */}
          <div
            ref={googleHostRef}
            className="account__google-host"
            aria-hidden="true"
            tabIndex={-1}
          />

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
