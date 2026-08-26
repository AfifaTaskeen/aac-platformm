/*
 * authConfig.js
 * -------------
 * Values shared by every account-related screen: sign up, sign in, forgot
 * password and reset password.
 *
 * These live in their own file rather than in AccountScreen.jsx because a file
 * that exports BOTH a component and plain constants breaks Vite's fast refresh
 * (editing a constant would force a full page reload instead of a hot update).
 *
 * Keeping them here also means the password rules exist in exactly ONE place on
 * the frontend, so the sign-up form and the reset form can never drift apart.
 * The backend enforces an identical list in server.js -- a browser can always
 * be bypassed, so the server repeats every check itself.
 */

/*
 * Where the Express backend lives.
 *
 * Read from the environment, falling back to the local dev server. Vite
 * replaces import.meta.env.VITE_API_URL at BUILD time, so a deployment sets
 * it in the build environment and the same source produces a build that
 * points at the real API -- no code edit, and no localhost baked into a
 * production bundle.
 *
 * Only the base URL lives here. It is a public address, not a secret: it ends
 * up in the JavaScript the browser downloads either way. Nothing sensitive --
 * no MongoDB URI, no Google client secret, no SMTP credential -- is ever read
 * on the frontend; those stay in backend/.env, which the browser never sees.
 *
 * The fallback keeps `npm run dev` working with no .env file at all, which is
 * how the project has run until now.
 */
/*
 * Where the API lives.
 *
 *   1. VITE_API_URL, if set -- an explicit setting always wins.
 *   2. DEVELOPMENT ONLY: when the page is being served from a private-network
 *      address (a phone on the same Wi-Fi opening http://192.168.0.106:5173),
 *      "localhost" would mean the PHONE, not this laptop, and every request
 *      would fail. So the API is addressed at the same host the page came
 *      from, on the backend's port.
 *   3. localhost:5000 -- unchanged for normal desktop development.
 *
 * Case 2 only ever triggers for RFC-1918 addresses, so a deployed build on a
 * public domain still falls through to the explicit VITE_API_URL it is given.
 */
const BACKEND_PORT = 5000

function inferApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  if (typeof window === 'undefined') return `http://localhost:${BACKEND_PORT}`

  const host = window.location.hostname
  const isPrivateLan =
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)

  if (isPrivateLan) return `http://${host}:${BACKEND_PORT}`

  /*
   * PRODUCTION SAFETY NET.
   *
   * Falling back to localhost is correct for development and wrong -- and
   * silently wrong -- for a deployed site: every visitor's browser would try
   * to reach an API on THEIR OWN machine, so the whole app fails with network
   * errors that look like the server being down.
   *
   * A production build with no VITE_API_URL is a misconfiguration, so it is
   * reported loudly at startup instead of shipping a site that cannot work.
   * Same origin is used as the fallback, which is correct whenever the API is
   * served behind the same domain (a reverse proxy or a single host) and is a
   * far better guess than localhost in every other case.
   */
  if (import.meta.env.PROD) {
    console.error(
      'VITE_API_URL is not set. Falling back to this page own origin. ' +
        'Set VITE_API_URL at build time to the public API URL.',
    )
    return window.location.origin
  }

  return `http://localhost:${BACKEND_PORT}`
}

export const API_BASE_URL = inferApiBase()

/*
 * A deliberately forgiving email check: something, an @, something, a dot,
 * something. Real address validation is the backend's job -- the frontend's
 * job is only to catch obvious typos before the user waits for a round trip.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MIN_PASSWORD_LENGTH = 8

/*
 * The password rules, written once as data. Each has a `label` and a `test`
 * function returning true when that rule is satisfied.
 */
export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: 'uppercase', label: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lowercase', label: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'number', label: 'One number', test: (p) => /[0-9]/.test(p) },
  {
    id: 'special',
    label: 'One special character',
    // Anything that is not a letter, a number, or a space.
    test: (p) => /[^A-Za-z0-9\s]/.test(p),
  },
]

/* True only when every rule passes. */
export function passwordMeetsAllRules(password) {
  return PASSWORD_RULES.every((rule) => rule.test(password))
}

/*
 * The single sentence shown under a password field, on both the sign-up form
 * and the reset form. If the rules change, both screens change together.
 */
export const PASSWORD_HELP_TEXT =
  '8+ characters, including uppercase, lowercase, number & special character.'
