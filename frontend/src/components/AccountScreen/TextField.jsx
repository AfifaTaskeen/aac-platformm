/*
 * TextField.jsx
 * -------------
 * One labelled form field. The Account screen uses it five times (Name, Email,
 * Password, Confirm password, and Email/Password again in Sign in), so it is
 * written once and configured through PROPS.
 *
 * That is the core React idea on display here: a component is a function that
 * takes props and returns some UI. Change the props, get a different field --
 * no copy-pasting.
 *
 * Props:
 *   id           - unique id. Ties the <label> to the <input> and the error
 *                  message to both.
 *   label        - the visible label text. Always visible, never a placeholder
 *                  standing in for a label.
 *   type         - 'text' | 'email' | 'password'
 *   value        - the current text (this is a CONTROLLED input: React owns
 *                  the value, and onChange is how it gets updated)
 *   onChange     - called with the new value
 *   onBlur       - called when the field loses focus, so we can validate then
 *                  instead of nagging on every keystroke
 *   error        - error message string, or '' when the field is fine
 *   hint         - optional rule shown on the label row (e.g. the password
 *                  length), so the user is told BEFORE they get it wrong
 *   autoComplete - helps browsers and password managers fill the form
 *   canReveal    - true for password fields: shows the Show/Hide button
 *   isRevealed   - whether the password is currently visible as plain text
 *   onToggleReveal - called when Show/Hide is pressed
 */

function TextField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  error = '',
  hint = '',
  // Optional id of separate help text sitting outside this component, so a
  // screen reader announces it when the field is focused.
  describedBy = '',
  autoComplete,
  canReveal = false,
  isRevealed = false,
  onToggleReveal,
}) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const hasError = Boolean(error)

  /*
   * A password field becomes a plain text field when the user presses "Show".
   * That is the whole trick behind show/hide -- just swapping the input type.
   */
  const inputType = canReveal && isRevealed ? 'text' : type

  return (
    <div className="field">
      {/* Label and hint share one row, so the rule costs no extra height. */}
      <div className="field__labelrow">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {hint && (
          <span className="field__hint" id={hintId}>
            {hint}
          </span>
        )}
      </div>

      {/* The box is a wrapper so the border and focus ring can surround both
          the input and the Show/Hide button as one control. */}
      <div className={`field__box ${hasError ? 'field__box--error' : ''}`}>
        <input
          className="field__input"
          id={id}
          name={id}
          type={inputType}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          /* Tells assistive technology this field is wrong, and points it at
             the message that explains why. */
          aria-invalid={hasError}
          /* Point at the error when there is one, otherwise at the help text
             or hint, so a screen reader hears the rule before typing. */
          aria-describedby={
            hasError ? errorId : describedBy || (hint ? hintId : undefined)
          }
          /* Tablet keyboards like to capitalise the first letter, which
             silently breaks email addresses. */
          autoCapitalize={type === 'email' ? 'none' : 'sentences'}
          spellCheck={type === 'email' || canReveal ? false : undefined}
        />

        {canReveal && (
          <button
            /* type="button" matters: without it, this would submit the form. */
            type="button"
            className="field__reveal"
            onClick={onToggleReveal}
            aria-pressed={isRevealed}
          >
            {/* The word, not just an icon -- meaning must never depend on a
                picture alone. The icon is reinforcement. */}
            <svg className="field__eye" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2.4" />
              {isRevealed && (
                <path d="M4 20 L20 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              )}
            </svg>
            {isRevealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {/*
        The error message is only rendered when there IS one.
        An empty slot used to be reserved so an appearing message could not
        shift the layout -- but four reserved slots cost ~100px of height and
        pushed the bottom of the form off the tablet viewport. Fitting the
        whole form on screen matters more, so the slot now collapses.
      */}
      {hasError && (
        <p className="field__error" id={errorId}>
          <svg className="field__error-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <path d="M12 7v6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="12" cy="16.6" r="1.3" fill="currentColor" />
          </svg>
          {error}
        </p>
      )}
    </div>
  )
}

export default TextField
