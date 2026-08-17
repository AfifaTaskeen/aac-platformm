import { useEffect, useRef } from 'react'

/*
 * PlaceholderDialog.jsx
 * ---------------------
 * A small dialog for the features that are not built yet: Settings, Edit
 * Words and Core Words.
 *
 * It exists so those buttons are honest. A button that does nothing looks
 * broken; one that says "this is coming next" tells the truth.
 *
 * Props:
 *   title, message - what it says
 *   onClose        - dismiss
 */
function PlaceholderDialog({ title, message, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    // Focus the close button so the dialog can be dismissed by keyboard.
    closeRef.current?.focus()

    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    /*
      The backdrop closes on click. It is not a button, so it carries no
      keyboard role -- Escape and the Close button are the keyboard routes.
    */
    <div className="cdialog__backdrop" onClick={onClose}>
      <div
        className="cdialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cdialog-title"
        /* Stops a click inside the panel from reaching the backdrop. */
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="cdialog__title" id="cdialog-title">
          {title}
        </h2>
        <p className="cdialog__message">{message}</p>

        <button type="button" className="cdialog__close" onClick={onClose} ref={closeRef}>
          Close
        </button>
      </div>
    </div>
  )
}

export default PlaceholderDialog
