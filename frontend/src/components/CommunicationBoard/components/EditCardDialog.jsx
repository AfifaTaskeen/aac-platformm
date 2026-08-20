import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCardImages, updateCard } from '../boardApi'

/*
 * EditCardDialog.jsx
 * ------------------
 * Editing one existing card's word, folder and picture.
 *
 * The flow, as four stages in one panel:
 *
 *   FOLDERS  ->  CARDS  ->  EDIT CARD  ->  (pick a picture)
 *                              |
 *                              save -> PATCH /api/cards/:id -> reload board
 *
 * Deliberately the SAME shell as Settings -- .cpanel for the frame,
 * .cset__row for a list row, .cset__option for a choice. A caregiver who has
 * used Settings already knows how to move around this, and it inherits the
 * theme, the dark mode and the touch sizes without restating any of it.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * Add, delete, reorder, record audio, upload a picture. Only editing an
 * existing card, which is what was asked for. `order` is never sent, so a
 * card keeps its position.
 *
 * Props:
 *   board     - { categories, cardsByCategory, basicWords } from the API
 *   onSaved   - called after a successful PATCH, so the board can reload
 *   onClose
 */

/* The stages, named so the transitions below read as English. */
const STAGE_FOLDERS = 'folders'
const STAGE_CARDS = 'cards'
const STAGE_EDIT = 'edit'
const STAGE_IMAGE = 'image'

function EditCardDialog({ board, onSaved, onClose }) {
  const [stage, setStage] = useState(STAGE_FOLDERS)

  /* Which folder is being browsed. The pseudo-folder 'basic' is the core
     words, which live in no folder -- the board already uses that name. */
  const [browsingCategory, setBrowsingCategory] = useState(null)

  /* The card being edited, and the working copy of its fields. The original
     is kept so Cancel can simply discard the draft. */
  const [editingCard, setEditingCard] = useState(null)
  const [draftWord, setDraftWord] = useState('')
  const [draftCategory, setDraftCategory] = useState('')
  const [draftImage, setDraftImage] = useState(null)

  const [validationError, setValidationError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  /* The pictures available to choose from. Loaded once, when the picker is
     first opened, rather than on mount -- most edits are a word change and
     never need the list. */
  const [images, setImages] = useState(null)

  const firstControlRef = useRef(null)
  const wordInputRef = useRef(null)

  /* Focus follows the stage, so a keyboard or switch user is never left with
     focus on a control that has scrolled away. */
  useEffect(() => {
    if (stage === STAGE_EDIT) {
      wordInputRef.current?.focus()
    } else {
      firstControlRef.current?.focus()
    }
  }, [stage])

  useEffect(() => {
    if (stage !== STAGE_IMAGE || images !== null) return

    const controller = new AbortController()
    fetchCardImages({ signal: controller.signal })
      .then(setImages)
      .catch((error) => {
        if (error.name !== 'AbortError') setImages([])
      })

    return () => controller.abort()
  }, [stage, images])

  /*
   * Steps back one stage, mirroring how the board's own Back button works.
   * From the first stage it closes, so there is never a dead end.
   */
  const goBack = useCallback(() => {
    setSaveError('')
    setValidationError('')

    if (stage === STAGE_IMAGE) {
      setStage(STAGE_EDIT)
      return
    }
    if (stage === STAGE_EDIT) {
      setEditingCard(null)
      setStage(STAGE_CARDS)
      return
    }
    if (stage === STAGE_CARDS) {
      setBrowsingCategory(null)
      setStage(STAGE_FOLDERS)
      return
    }
    onClose()
  }, [stage, onClose])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') goBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBack])

  /* Opens one card for editing, seeding the draft from its current values. */
  function openCard(card) {
    setEditingCard(card)
    setDraftWord(card.label)
    setDraftCategory(card.category)
    setDraftImage(card.image)
    setValidationError('')
    setSaveError('')
    setStage(STAGE_EDIT)
  }

  /*
   * Saves.
   *
   * Only CHANGED fields are sent. The backend's PATCH leaves an absent field
   * alone, so an untouched picture is not rewritten and `order` -- which is
   * never sent at all -- keeps the card exactly where it was.
   */
  async function handleSave() {
    const word = draftWord.trim()

    if (!word) {
      setValidationError('Please enter a word for this card.')
      wordInputRef.current?.focus()
      return
    }

    if (!draftCategory) {
      setValidationError('Please choose a folder for this card.')
      return
    }

    setValidationError('')
    setSaveError('')

    const changes = {}

    if (word !== editingCard.label) {
      changes.word = word
    }

    if (draftCategory !== editingCard.category) {
      /*
       * The API wants the folder's real MongoDB id, while the board works in
       * palette keys.
       *
       * Every folder in the list is a REAL folder now, including Core Words
       * -- so this always resolves to an id. There is no longer a synthetic
       * "no folder" choice to translate to null.
       */
      /* allCategories, not categories: Core Words is absent from the tile
         list but must still be a valid destination when moving a card. */
      const target = (board.allCategories || board.categories).find(
        (c) => c.id === draftCategory,
      )
      changes.folderId = target?.folderId ?? null
    }

    if (draftImage !== editingCard.image) {
      changes.imageUrl = draftImage
    }

    if (Object.keys(changes).length === 0) {
      // Nothing was altered -- close rather than sending an empty PATCH, which
      // the backend would rightly reject as "Nothing to update".
      onClose()
      return
    }

    setIsSaving(true)

    try {
      await updateCard(editingCard.id, changes)
      /*
       * Only now, after MongoDB has confirmed the write, does the board
       * reload. Nothing local is updated first -- if the request failed, the
       * board must not be showing a change the database never accepted.
       */
      await onSaved()
      onClose()
    } catch (error) {
      // The form STAYS OPEN with the caregiver's text intact, so a failed save
      // never costs them their edit.
      setSaveError(error.message || 'Could not save your changes. Please try again.')
      setIsSaving(false)
    }
  }

  /*
   * The folders to browse -- simply the real ones.
   *
   * Core Words used to be appended here as a synthetic entry, because core
   * words lived outside every folder. They are a real folder now, so adding
   * it again would list it twice and, worse, moving a card into that
   * duplicate would have set folderId to null instead of the real id.
   */
  const browsableFolders = (board.allCategories || board.categories).map((c) => ({
    id: c.id,
    label: c.label,
    emoji: c.emoji,
  }))

  const cardsInBrowsed = board.cardsByCategory.get(browsingCategory) || []

  const headingByStage = {
    [STAGE_FOLDERS]: 'Edit Words',
    [STAGE_CARDS]: browsableFolders.find((f) => f.id === browsingCategory)?.label || 'Cards',
    [STAGE_EDIT]: 'Edit Card',
    [STAGE_IMAGE]: 'Choose a Picture',
  }

  return (
    <div className="cpanel__backdrop" onClick={onClose}>
      <div
        className="cpanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editcard-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cpanel__head">
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={goBack}
            aria-label={stage === STAGE_FOLDERS ? 'Close editing' : 'Back'}
            ref={firstControlRef}
          >
            {stage === STAGE_FOLDERS ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M20 12H5M12 5l-7 7 7 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>

          <h2 className="cpanel__title" id="editcard-title">
            {headingByStage[stage]}
          </h2>
        </header>

        <div className="cpanel__body">
          {/* ---------- 1. Which folder? ---------- */}
          {stage === STAGE_FOLDERS && (
            <div className="cset__rows">
              {browsableFolders.map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  className="cset__row"
                  onClick={() => {
                    setBrowsingCategory(folder.id)
                    setStage(STAGE_CARDS)
                  }}
                >
                  <span className="cset__row-label">
                    <span aria-hidden="true">{folder.emoji} </span>
                    {folder.label}
                  </span>
                  <svg
                    className="cset__row-chevron"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M9 5l7 7-7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* ---------- 2. Which card? ---------- */}
          {stage === STAGE_CARDS && (
            <div className="cset__rows">
              {cardsInBrowsed.length === 0 && (
                <p className="cedit__hint">There are no cards in this folder yet.</p>
              )}

              {cardsInBrowsed.map((card) => (
                <button
                  type="button"
                  key={card.id}
                  className="cset__row"
                  onClick={() => openCard(card)}
                >
                  <span className="cedit__thumb" aria-hidden="true">
                    {card.image ? (
                      <img className="cedit__thumb-img" src={card.image} alt="" />
                    ) : (
                      <span className="cedit__thumb-emoji">{card.emoji || '💬'}</span>
                    )}
                  </span>
                  <span className="cset__row-label">{card.label}</span>
                  <svg
                    className="cset__row-chevron"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M9 5l7 7-7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ))}
            </div>
          )}

          {/* ---------- 3. Edit it ---------- */}
          {stage === STAGE_EDIT && editingCard && (
            <div className="cedit__form">
              <label className="cedit__field">
                <span className="cedit__label">Word</span>
                <input
                  ref={wordInputRef}
                  className="cedit__input"
                  type="text"
                  value={draftWord}
                  maxLength={40}
                  onChange={(event) => {
                    setDraftWord(event.target.value)
                    if (validationError) setValidationError('')
                  }}
                  aria-invalid={Boolean(validationError)}
                />
              </label>

              <div className="cedit__field">
                <span className="cedit__label">Folder</span>
                <div className="cedit__chips">
                  {browsableFolders.map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      className={`cedit__chip ${
                        draftCategory === folder.id ? 'cedit__chip--on' : ''
                      }`}
                      onClick={() => {
                        setDraftCategory(folder.id)
                        if (validationError) setValidationError('')
                      }}
                      aria-pressed={draftCategory === folder.id}
                    >
                      <span aria-hidden="true">{folder.emoji} </span>
                      {folder.label}
                      {/* A tick as well as the fill, so the choice never
                          depends on colour alone. */}
                      {draftCategory === folder.id && <span aria-hidden="true"> ✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cedit__field">
                <span className="cedit__label">Picture</span>
                <button
                  type="button"
                  className="cedit__picture"
                  onClick={() => setStage(STAGE_IMAGE)}
                >
                  <span className="cedit__thumb cedit__thumb--lg" aria-hidden="true">
                    {draftImage ? (
                      <img className="cedit__thumb-img" src={draftImage} alt="" />
                    ) : (
                      <span className="cedit__thumb-emoji">{editingCard.emoji || '💬'}</span>
                    )}
                  </span>
                  <span className="cedit__picture-text">
                    {draftImage ? 'Change picture' : 'Choose a picture'}
                  </span>
                </button>
              </div>

              {validationError && (
                <p className="cedit__error" role="alert">
                  {validationError}
                </p>
              )}

              {saveError && (
                <p className="cedit__error" role="alert">
                  {saveError}
                </p>
              )}

              <div className="cedit__actions">
                <button
                  type="button"
                  className="cedit__btn cedit__btn--cancel"
                  onClick={goBack}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cedit__btn cedit__btn--save"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* ---------- 4. Pick a picture ---------- */}
          {stage === STAGE_IMAGE && (
            <div>
              {images === null && <p className="cedit__hint">Loading pictures…</p>}

              {images !== null && images.length === 0 && (
                <p className="cedit__hint">No pictures are available to choose from.</p>
              )}

              {images !== null && images.length > 0 && (
                <div className="cedit__gallery">
                  {images.map((image) => (
                    <button
                      type="button"
                      key={image.url}
                      className={`cedit__galleryitem ${
                        draftImage === image.url ? 'cedit__galleryitem--on' : ''
                      }`}
                      onClick={() => {
                        setDraftImage(image.url)
                        setStage(STAGE_EDIT)
                      }}
                      aria-pressed={draftImage === image.url}
                      aria-label={`${image.name}, from ${image.folder}`}
                    >
                      <img className="cedit__galleryimg" src={image.url} alt="" loading="lazy" />
                      <span className="cedit__galleryname">{image.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default EditCardDialog
