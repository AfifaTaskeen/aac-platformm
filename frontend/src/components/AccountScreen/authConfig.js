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
 * Kept as a named constant rather than typed inline, because it changes when
 * the app is deployed. Later this can read an environment variable
 * (import.meta.env.VITE_API_URL) so development and production differ without
 * editing the code.
 */
export const API_BASE_URL = 'http://localhost:5000'

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
