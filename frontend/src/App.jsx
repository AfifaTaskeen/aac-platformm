import { useState, useEffect } from 'react'
import SplashScreen from './components/SplashScreen'
import AccountScreen from './components/AccountScreen/AccountScreen'
import ForgotPasswordScreen from './components/AccountScreen/ForgotPasswordScreen'
import ResetPasswordScreen from './components/AccountScreen/ResetPasswordScreen'
import ChildProfileScreen from './components/ChildProfile/ChildProfileScreen'
import CommunicationBoard from './components/CommunicationBoard/CommunicationBoard'
import { API_BASE_URL, EMAIL_PATTERN } from './components/AccountScreen/authConfig'
import './App.css'

/*
 * How long the splash stays fully visible, and how long it takes to fade.
 * They live here as named constants so the timing is easy to find and tweak.
 */
const SPLASH_VISIBLE_MS = 2400
const SPLASH_FADE_MS = 400

/*
 * Reads ?token=... out of the address bar.
 *
 * The project has no router, and adding one just for this would be a large
 * change for a single link. Reading the query string directly is enough:
 * the emailed link is the only URL that carries a token.
 */
function getResetTokenFromUrl() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('token') || ''
}

function App() {
  /*
   * `phase` is a piece of STATE: a value React remembers between renders.
   * When we change it with setPhase(), React re-runs this function and
   * updates the screen to match. It moves in one direction only:
   *
   *   'splash'  -> the splash screen is showing
   *   'leaving' -> still showing, but fading out
   *   'done'    -> splash finished, next screen takes over
   */
  const [phase, setPhase] = useState('splash')

  /*
   * The signed-in user, or null when nobody is signed in yet. AccountScreen
   * calls setUser through its onAuthenticated prop once the backend confirms
   * a successful sign-up or sign-in.
   */
  const [user, setUser] = useState(null)

  /*
   * Which account screen is showing:
   *   'account' - sign up / sign in
   *   'forgot'  - ask for the email address
   *   'reset'   - choose a new password (opened from the emailed link)
   *
   * If the page was opened with ?token=... we start on 'reset', because the
   * user arrived here by clicking that link.
   */
  const [resetToken] = useState(getResetTokenFromUrl)
  const [authView, setAuthView] = useState(resetToken ? 'reset' : 'account')

  /*
   * Has the "are we already signed in?" question been answered yet?
   *
   * The session lives in an httpOnly cookie, which page JavaScript deliberately
   * CANNOT read. So on a fresh page load the app genuinely does not know
   * whether anyone is signed in until it asks the backend -- and until then,
   * `user` being null does not mean "signed out", it means "not asked yet".
   *
   * Rendering the sign-in form during that gap is what made every refresh look
   * like the session had ended: the cookie was valid the whole time, nothing
   * ever asked about it. This flag keeps the app on the splash/loading screen
   * for that one request instead of flashing a login form at someone who is
   * already signed in.
   */
  const [isRestoringSession, setIsRestoringSession] = useState(true)

  /*
   * Where a signed-in user goes next:
   *   'checking' - asking the backend whether a child profile exists
   *   'profile'  - no profile yet, or the user is editing one
   *   'board'    - a profile exists; the AAC board goes here
   */
  const [stage, setStage] = useState('checking')
  const [childProfile, setChildProfile] = useState(null)

  /*
   * Set when the profile check could not be completed -- the database is
   * unreachable, or the backend is down.
   *
   * This is deliberately NOT the same as "no profile yet". Treating a failed
   * check as "no profile" is what would send an existing family back to the
   * setup form to re-type details they had already saved. When this is set
   * the app says so and offers a retry, and the session is left untouched.
   */
  const [profileError, setProfileError] = useState(null)

  /* Bumped by "Try again" to re-run the profile check without touching the
     session or reloading the page. */
  const [profileCheckCount, setProfileCheckCount] = useState(0)

  /*
   * SESSION RESTORE -- runs once, before anything is shown.
   *
   * Asks the backend "who am I?", which is the only way to find out: the
   * session is an httpOnly cookie the browser attaches automatically and
   * JavaScript cannot inspect. `credentials: 'include'` is what makes the
   * browser send it, exactly as the other authenticated requests do.
   *
   * 200 means the cookie is valid -> restore the user, and the effect below
   * then loads their child profile, landing them back on the board.
   * 401 means no session (or an expired one) -> fall through to sign-in.
   *
   * Nothing is stored on the client: no token, no email, no password. The
   * cookie remains the single source of truth and stays unreadable to scripts.
   * A brand-new account is not affected -- registration sets `user` directly
   * and this has already finished by then.
   */
  useEffect(() => {
    let cancelled = false

    async function restoreSession() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          credentials: 'include',
        })

        if (cancelled) return

        if (response.ok) {
          const data = await response.json()
          if (!cancelled && data?.success && data.user) {
            setUser(data.user)
          }
        }
      } catch (error) {
        /*
         * The backend is unreachable. That is not the same as "signed out",
         * but there is nothing better to show than the sign-in screen, and
         * a failed restore must never leave the app stuck on "Loading…".
         */
        if (!cancelled) console.log('Could not restore the session:', error)
      } finally {
        if (!cancelled) setIsRestoringSession(false)
      }
    }

    restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  /*
   * Runs whenever someone becomes signed in.
   *
   * A brand-new account cannot have a profile, so signup skips the request
   * and goes straight to setup. Everyone else (email sign-in and Google
   * alike) is asked the same question: does this user already have a profile?
   * One check serves every sign-in path.
   */
  useEffect(() => {
    if (!user) return

    // `isNewAccount` is set by AccountScreen after a successful registration.
    if (user.isNewAccount) {
      setChildProfile(null)
      setStage('profile')
      return
    }

    let cancelled = false
    setStage('checking')
    setProfileError(null)

    async function loadChildProfile() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/child-profile`, {
          // Sends the session cookie so the backend knows who is asking.
          credentials: 'include',
        })

        if (cancelled) return

        /*
         * EACH FAILURE MEANS SOMETHING DIFFERENT.
         *
         * This used to be a single `if (!response.ok) setStage('profile')`,
         * which sent EVERY failure to the setup form -- so a database outage
         * asked an existing family to re-enter a profile they had already
         * saved, and an expired session silently showed the setup form
         * instead of asking them to sign in.
         */
        if (response.status === 401) {
          /* The session really is gone. Drop back to sign-in. */
          setUser(null)
          return
        }

        if (!response.ok) {
          /*
           * 503 (database down), 500, or anything else: the check could not
           * be completed. We do NOT know whether a profile exists, so we
           * must not guess -- guessing "no profile" is the harmful direction.
           * The session stays valid and the user is offered a retry.
           */
          const data = await response.json().catch(() => null)
          setProfileError(
            data?.message ||
              'Could not reach the server. Please check your connection and try again.',
          )
          setStage('error')
          return
        }

        const data = await response.json()
        if (cancelled) return

        if (data?.exists && data.profile) {
          setChildProfile(data.profile)
          setStage('board')
        } else {
          /* A genuine 200 saying this user has no profile yet. */
          setChildProfile(null)
          setStage('profile')
        }
      } catch (error) {
        if (cancelled) return
        /* Network failure -- again, not evidence that a profile is missing. */
        console.log('Could not load the child profile:', error)
        setProfileError('Could not reach the server. Please try again.')
        setStage('error')
      }
    }

    loadChildProfile()

    // Stops a slow response from updating state after signing out again.
    return () => {
      cancelled = true
    }
  }, [user, profileCheckCount])

  /*
   * Signs out for real.
   *
   * The server is asked FIRST, because it owns the session: only it can clear
   * the httpOnly cookie, which page JavaScript cannot touch. Clearing local
   * state alone would look signed-out while the cookie stayed valid, so the
   * next refresh would silently sign the user back in.
   *
   * Local state is cleared afterwards regardless of the server's answer. If
   * the request fails the cookie may survive, but leaving someone stuck on a
   * board they asked to leave is worse -- and the next /api/auth/me settles
   * the truth either way.
   */
  async function handleLogOut() {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch (error) {
      console.log('Sign-out request failed:', error)
    }

    setUser(null)
    setChildProfile(null)
    setProfileError(null)
    setStage('checking')
    setAuthView('account')
  }

  /*
   * Returns to Sign in and tidies the address bar, so a used reset link is not
   * left in the URL to be re-opened or shared.
   *
   * Also drops any `user` this tab already has in state. This matters
   * specifically for the password-reset path: a browser that was already
   * signed in at the moment of a reset keeps a perfectly VALID session
   * cookie throughout it (the reset does not touch the current tab's
   * cookie), so without this, pressing "Back to Sign in" would still find
   * `user` set and render the board instead -- the server-side fix
   * (requireAuth/api/auth/me now reject a token issued before the
   * account's last password change) is what makes that old cookie actually
   * stop working, but clearing `user` here too means the board is never
   * even attempted from this state, and the person always has to sign in
   * again deliberately, exactly as intended.
   */
  function backToSignIn() {
    /*
     * Clears the WHOLE path, not just the query string: a reset link now
     * opens at /reset-password?token=..., so leaving pathname alone would
     * strand the address bar on /reset-password with no token -- refreshing
     * that shows an empty reset form instead of sign-in.
     */
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/')
    } else if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
    setUser(null)
    setChildProfile(null)
    setProfileError(null)
    setStage('checking')
    setAuthView('account')
  }

  /*
   * useEffect runs code AFTER React has drawn the screen. It is the right
   * place for things that are not rendering -- here, two timers.
   *
   * The empty array [] at the end means "run this once, when the app first
   * appears", not on every render.
   *
   * The function we return is the CLEANUP. React calls it if the component
   * goes away before the timers fire, which cancels them. Without it a timer
   * could try to update a component that no longer exists. It also keeps
   * things correct in development, where React's StrictMode deliberately
   * mounts everything twice to help you catch exactly this kind of bug.
   */
  useEffect(() => {
    const fadeTimer = setTimeout(() => setPhase('leaving'), SPLASH_VISIBLE_MS)
    const doneTimer = setTimeout(() => setPhase('done'), SPLASH_VISIBLE_MS + SPLASH_FADE_MS)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [])

  if (phase !== 'done') {
    return <SplashScreen isLeaving={phase === 'leaving'} />
  }

  /*
   * The session check is still in flight. Holding the splash here rather than
   * rendering the sign-in form means an already-signed-in user never sees a
   * login screen flash before their board appears.
   *
   * In practice this is usually invisible: the request is answered long before
   * the splash finishes. It only shows on a genuinely slow connection.
   */
  if (isRestoringSession) {
    return <SplashScreen isLeaving={false} />
  }

  /*
   * A password-reset link always wins, even for someone already signed in.
   *
   * Checked BEFORE the signed-in branch below on purpose: if that ran first,
   * clicking a reset link while still signed in on this browser (the same
   * device the family usually uses) would show the AAC board instead of the
   * reset form -- the emailed link must open the reset screen regardless of
   * whatever session happens to exist here.
   */
  if (authView === 'reset') {
    return <ResetPasswordScreen token={resetToken} onBackToSignIn={backToSignIn} />
  }

  /* Signed in: decide between profile setup and the board. */
  if (user) {
    // Brief moment while the profile check is in flight.
    if (stage === 'checking') {
      return (
        <div className="app-placeholder">
          <p>Loading…</p>
        </div>
      )
    }

    /*
     * The profile check could not be completed -- almost always the database
     * being briefly unavailable.
     *
     * The user stays SIGNED IN: the cookie is untouched, and Try again simply
     * re-runs the check. Showing the setup form here instead would ask an
     * existing family to re-enter a profile they already have, and showing
     * the sign-in screen would claim a session had ended when it had not.
     */
    if (stage === 'error') {
      return (
        <div className="app-placeholder">
          <p>{profileError}</p>
          <button type="button" onClick={() => setProfileCheckCount((n) => n + 1)}>
            Try again
          </button>
        </div>
      )
    }

    if (stage === 'profile') {
      return (
        <ChildProfileScreen
          existingProfile={childProfile}
          onSaved={(savedProfile) => {
            setChildProfile(savedProfile)
            setStage('board')
          }}
        />
      )
    }

    /*
     * The communication board. It reads gridSize and voice from the saved
     * profile -- the caregiver's choices in Child Profile are what shape it,
     * so the board never asks again and never writes back.
     *
     * `user` is passed through so the board's Account section can show who
     * is signed in -- it is the SAME object /api/auth/me and sign-in already
     * populated, not a second fetch or a new piece of data.
     */
    return <CommunicationBoard childProfile={childProfile} user={user} onLogOut={handleLogOut} />
  }

  /* Step 1 of a password reset: ask for the email address. */
  if (authView === 'forgot') {
    return (
      <ForgotPasswordScreen
        onBackToSignIn={backToSignIn}
        apiBaseUrl={API_BASE_URL}
        emailPattern={EMAIL_PATTERN}
      />
    )
  }

  /*
   * Once the splash has finished, the Account screen takes over. It handles
   * its own Sign up / Sign in switching internally, so App does not need to
   * know which of the two views is showing -- it only needs to hear when
   * somebody has successfully signed in, or when they want to reset.
   */
  return (
    <AccountScreen onAuthenticated={setUser} onForgotPassword={() => setAuthView('forgot')} />
  )
}

export default App
