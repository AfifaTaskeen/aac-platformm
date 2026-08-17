import { useState } from 'react'
import BuddyLogo from '../BuddyLogo'
import TextField from '../AccountScreen/TextField'
import { API_BASE_URL } from '../AccountScreen/authConfig'
import '../AccountScreen/AccountScreen.css'
import './ChildProfileScreen.css'

/*
 * ChildProfileScreen.jsx
 * ----------------------
 * Set up (or edit) the child's profile: name, gender, voice and grid size.
 *
 * Reuses the account screens' CSS and TextField, so this is visually the same
 * application -- same cream background, same warm glow, same chunky ink
 * borders, same coral primary button. ChildProfileScreen.css adds only what is
 * genuinely new here: the option buttons and the little grid previews.
 *
 * The profile is saved to MongoDB against the SIGNED-IN user. The browser
 * never sends a user id -- the backend reads it from the session cookie, so
 * one account cannot write another's profile.
 *
 * Props:
 *   existingProfile - the saved profile when editing, or null when new
 *   onSaved         - called with the saved profile once the backend confirms
 */

/* The options, written once as data so the buttons render from one list. */
const GENDER_OPTIONS = [
  { value: 'boy', label: 'Boy' },
  { value: 'girl', label: 'Girl' },
  { value: 'other', label: 'Prefer not to say' },
]

const VOICE_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
]

const GRID_OPTIONS = [2, 3, 4]

/*
 * A small drawing of what a grid size means, so the choice is understandable
 * without reading. `size` cells across and down, rendered as a CSS grid.
 */
function GridPreview({ size }) {
  const cells = Array.from({ length: size * size })

  return (
    <span
      className="gridpick__preview"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      aria-hidden="true"
    >
      {cells.map((_, index) => (
        <span key={index} className="gridpick__cell" />
      ))}
    </span>
  )
}

function ChildProfileScreen({ existingProfile = null, onSaved }) {
  // Pre-filled when editing, so an existing profile is updated rather than
  // being retyped from scratch.
  const [values, setValues] = useState({
    childName: existingProfile?.childName || '',
    gender: existingProfile?.gender || '',
    voice: existingProfile?.voice || '',
    gridSize: existingProfile?.gridSize || 3,
  })

  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isEditing = Boolean(existingProfile)

  /*
   * Whether the profile can be saved yet. Derived from `values` on every
   * render rather than kept in its own state, so it can never fall out of
   * step with what is actually on screen.
   *
   * gridSize is not tested: it always holds a valid value (3 by default), so
   * there is nothing for the user to get wrong.
   */
  const isComplete =
    values.childName.trim() !== '' && values.gender !== '' && values.voice !== ''

  function validateField(fieldName, nextValues) {
    if (fieldName === 'childName') {
      if (!nextValues.childName.trim()) return "Please enter your child's name."
      return ''
    }
    if (fieldName === 'gender') {
      if (!nextValues.gender) return 'Please choose an option.'
      return ''
    }
    if (fieldName === 'voice') {
      if (!nextValues.voice) return 'Please choose a voice.'
      return ''
    }
    return ''
  }

  function handleChange(fieldName, nextValue) {
    const nextValues = { ...values, [fieldName]: nextValue }
    setValues(nextValues)
    setStatus('')

    // Only re-check a field already showing an error, so the message clears
    // the moment it is fixed without nagging mid-word.
    if (errors[fieldName]) {
      setErrors({ ...errors, [fieldName]: validateField(fieldName, nextValues) })
    }
  }

  /* Choosing an option counts as answering it, so mark it touched and clear. */
  function handlePick(fieldName, nextValue) {
    const nextValues = { ...values, [fieldName]: nextValue }
    setValues(nextValues)
    setTouched({ ...touched, [fieldName]: true })
    setErrors({ ...errors, [fieldName]: validateField(fieldName, nextValues) })
    setStatus('')
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (isSubmitting) return

    const fields = ['childName', 'gender', 'voice']
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
      // Text field can take focus; the option groups are scrolled to instead.
      const target = document.getElementById(firstBroken)
      if (target) target.focus()
      else document.getElementById(`${firstBroken}-group`)?.scrollIntoView({ block: 'center' })
      return
    }

    setStatus('')
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/child-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        /*
         * Sends the session cookie, which is how the backend knows whose
         * profile this is. No user id is included in the body on purpose.
         */
        credentials: 'include',
        body: JSON.stringify({
          childName: values.childName,
          gender: values.gender,
          voice: values.voice,
          gridSize: values.gridSize,
        }),
      })

      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }

      if (response.ok) {
        setStatus(data?.message || 'Child profile saved successfully.')
        if (onSaved && data?.profile) onSaved(data.profile)
        return
      }

      if (response.status === 401) {
        setStatus('Your session has ended. Please sign in again.')
        return
      }

      // The backend names the field it rejected, so the message lands there.
      if (data?.field) {
        setErrors({ [data.field]: data.message })
        setTouched({ ...nextTouched, [data.field]: true })
        return
      }

      setStatus(data?.message || 'Something went wrong. Please try again.')
    } catch (requestError) {
      console.log('Saving child profile failed:', requestError)
      setStatus('Could not reach the server. Please check it is running and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function errorFor(fieldName) {
    return touched[fieldName] ? errors[fieldName] || '' : ''
  }

  /*
   * `account--profile` scopes this screen's wider layout so the account screens
   * are untouched. The base `account` class still carries the shared theme --
   * colours, fonts, borders, buttons -- and the modifier only changes
   * measurements.
   */
  return (
    <div className="account account--profile">
      <div className="account__glow" aria-hidden="true" />

      <header className="account__brand">
        <BuddyLogo className="account__logo" title="Buddy Talk" />
        <span className="account__brand-name">Buddy Talk</span>
      </header>

      <div className="account__body">
        {/*
          Deliberately NOT account__panel--signin: that modifier pins the width
          back to 520px on a laptop, which is what made this screen look like a
          small form adrift in empty space. This screen sets its own width.
        */}
        <div className="account__panel account__panel--profile">
          <div className="account__intro">
            <h1 className="account__heading">
              {isEditing ? "Edit your child's profile" : "Set up your child's profile"}
            </h1>
            <p className="account__subheading">
              A few details to personalize Buddy Talk for your child.
            </p>
          </div>

          <form className="account__form" onSubmit={handleSubmit} noValidate>
            <div className="account__fields">
              <TextField
                id="childName"
                label="Child name"
                value={values.childName}
                onChange={(next) => handleChange('childName', next)}
                onBlur={() => {
                  setTouched({ ...touched, childName: true })
                  setErrors({ ...errors, childName: validateField('childName', values) })
                }}
                error={errorFor('childName')}
                autoComplete="off"
              />
            </div>

            {/*
              The three questions sit in one responsive row on a wide screen
              and wrap by themselves on a narrow one. This wrapper is layout
              only -- each question is still its own <fieldset> with a
              <legend>, which is what tells a screen reader that these buttons
              belong to one question.
            */}
            <div className="profile__groups">
              <fieldset className="pickgroup" id="gender-group">
                <legend className="pickgroup__legend">Gender</legend>
                <div className="pickgroup__options">
                  {GENDER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pickbtn ${values.gender === option.value ? 'pickbtn--on' : ''}`}
                      onClick={() => handlePick('gender', option.value)}
                      /* Announces the chosen state, since colour alone cannot. */
                      aria-pressed={values.gender === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {errorFor('gender') && <p className="pickgroup__error">{errorFor('gender')}</p>}
              </fieldset>

              <fieldset className="pickgroup" id="voice-group">
                <legend className="pickgroup__legend">Voice</legend>
                <div className="pickgroup__options">
                  {VOICE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`pickbtn ${values.voice === option.value ? 'pickbtn--on' : ''}`}
                      onClick={() => handlePick('voice', option.value)}
                      aria-pressed={values.voice === option.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="pickgroup__help">
                  This voice will be used for your child&rsquo;s communication cards.
                </p>
                {errorFor('voice') && <p className="pickgroup__error">{errorFor('voice')}</p>}
              </fieldset>

              <fieldset className="pickgroup" id="gridSize-group">
                <legend className="pickgroup__legend">Grid size</legend>
                <div className="pickgroup__options pickgroup__options--grids">
                  {GRID_OPTIONS.map((size) => (
                    <button
                      key={size}
                      type="button"
                      className={`gridpick ${values.gridSize === size ? 'gridpick--on' : ''}`}
                      onClick={() => handlePick('gridSize', size)}
                      aria-pressed={values.gridSize === size}
                      aria-label={`${size} by ${size} grid, ${size * size} cards`}
                    >
                      <GridPreview size={size} />
                      <span className="gridpick__label">
                        {size} &times; {size}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            {/*
              Disabled until the profile is complete, so the button is neutral
              on arrival and turns coral only once it can actually be used.
              `isSubmitting` keeps it disabled during the request too, which is
              what prevents a double submission.
            */}
            <button
              type="submit"
              className="account__primary"
              disabled={!isComplete || isSubmitting}
            >
              {isSubmitting ? 'Saving…' : 'Save & Continue'}
            </button>

            <p className="account__status" role="status" aria-live="polite">
              {status}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}

export default ChildProfileScreen
