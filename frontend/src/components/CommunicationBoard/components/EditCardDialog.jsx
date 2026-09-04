import { useCallback, useEffect, useRef, useState } from 'react'
import {
  updateCard,
  createCard,
  createFolder,
  updateFolder,
  uploadImage,
  uploadAudio,
  deleteCard,
  deleteFolder,
  toStoredUrl,
} from '../boardApi'
import AudioRecorder from './AudioRecorder'

/*
 * EditCardDialog.jsx
 * ------------------
 * Managing the board: editing a card, editing a folder, or creating either.
 *
 * THE SHAPE OF THE FLOW
 *
 *   MENU ─┬─ Customize Existing Card   → folder → card → edit form
 *         ├─ Customize Existing Folder → folder → folder form
 *         └─ Create New ─┬─ New Folder → folder form
 *                        └─ New Card ─┬─ into an existing folder → card form
 *                                     └─ into a new folder → folder form
 *                                                          → card form
 *                                            (the new folder is preselected)
 *
 * It opens on the MENU rather than on a list of folders, so the common case
 * -- "I want to change one word" -- is two taps from the top instead of a
 * hunt through eleven folders for a screen that might not be the one wanted.
 *
 * ONE STACK, NOT A TREE OF DIALOGS
 *
 * Every screen is a value of `stage`, and `history` is the path taken to get
 * there. Back pops the stack, so it always returns where the caregiver came
 * from -- including the case where the card form was reached by creating a
 * folder on the way, which a fixed per-screen "back target" cannot express.
 *
 * It reuses the Settings panel's own classes (.cpanel, .cset__row) so it
 * inherits the theme, dark mode and touch sizes without restating any of it.
 *
 * Props:
 *   board     - { allCategories, categories, cardsByCategory, basicWords }
 *   onSaved   - called after any successful write, so the board reloads
 *   onClose
 */

/* The screens. Named so the transitions read as English. */
const MENU = 'menu'
const PICK_FOLDER_FOR_CARD = 'pick-folder-for-card'
const PICK_CARD = 'pick-card'
const EDIT_CARD = 'edit-card'
const PICK_FOLDER_TO_EDIT = 'pick-folder-to-edit'
const EDIT_FOLDER = 'edit-folder'
const CREATE_MENU = 'create-menu'
const CREATE_FOLDER = 'create-folder'
const CREATE_CARD_WHERE = 'create-card-where'
/* Creating a folder as the first half of creating a card. A separate screen
   from CREATE_FOLDER because its Save continues to the card form instead of
   closing, and its heading says so. */
const CREATE_FOLDER_THEN_CARD = 'create-folder-then-card'
const PICK_FOLDER_FOR_NEW_CARD = 'pick-folder-for-new-card'
/* Deleting. Two entry points and a confirmation for each -- nothing is
   removed without an explicit second tap. */
const DELETE_MENU = 'delete-menu'
const DELETE_PICK_FOLDER_FOR_CARD = 'delete-pick-folder-for-card'
const DELETE_PICK_CARD = 'delete-pick-card'
const DELETE_CONFIRM_CARD = 'delete-confirm-card'
const DELETE_PICK_FOLDER = 'delete-pick-folder'
const DELETE_CONFIRM_FOLDER = 'delete-confirm-folder'
const CREATE_CARD = 'create-card'

const MAX_WORD = 40
const MAX_FOLDER_NAME = 40

/* Shown on a folder tile that has no picture of its own. */
const DEFAULT_FOLDER_EMOJI = '🗂️'

/*
 * THESE COMPONENTS LIVE AT MODULE SCOPE, AND THAT IS LOAD-BEARING.
 *
 * They used to be declared inside EditCardDialog, and that was the bug that
 * made image and audio replacement fail.
 *
 * A function declared during render is a NEW function object every render, so
 * React sees a different component TYPE each time and cannot reconcile the
 * old tree with the new one -- it unmounts the whole subtree and mounts a
 * fresh one. The `<input type="file">` lives in that subtree, so the moment
 * anything set state, the input holding the caregiver's chosen file was
 * destroyed and replaced with an empty one.
 *
 * Uploading sets state twice (busy on, busy off), so the input was torn down
 * WHILE the upload it started was still in flight. The picker opened, a file
 * was chosen, and then the element that had it vanished -- which is exactly
 * "the file picker works but nothing is saved".
 *
 * Declared out here they are stable types, React updates them in place, and
 * the input survives every re-render.
 */

const Chevron = () => (
  <svg className="cset__row-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M9 5l7 7-7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function MenuRow({ label, description, onClick, innerRef }) {
  return (
    <button type="button" className="cset__row" onClick={onClick} ref={innerRef}>
      <span className="cset__row-label">
        {label}
        {description && <span className="cedit__rowdesc">{description}</span>}
      </span>
      <Chevron />
    </button>
  )
}

function FolderList({ folders, onPick, firstRef }) {
  return (
    <div className="cset__rows">
      {folders.map((folder, index) => (
        <button
          type="button"
          key={folder.id}
          className="cset__row"
          onClick={() => onPick(folder)}
          ref={index === 0 ? firstRef : undefined}
        >
          {/* The folder NAME alone. The emoji that used to prefix every row
              added nothing -- the name already identifies the folder, and a
              column of decorative glyphs made the list harder to scan, not
              easier. */}
          <span className="cset__row-label">{folder.label}</span>
          <Chevron />
        </button>
      ))}
    </div>
  )
}

/*
 * A media field: the current picture or sound, and ONE button to replace it.
 *
 * Deliberately a single "Choose…" button. The operating system's own picker
 * already offers the gallery, Downloads, Documents, Desktop and cloud
 * storage; listing those as separate in-app choices duplicated the OS badly,
 * added a decision before the real one, and could only ever be a worse
 * version of the picker the device already provides.
 */
function MediaField({
  label,
  kind,
  url,
  fileName,
  uploading,
  disabled,
  inputRef,
  onChoose,
  onRemove,
  children,
}) {
  const accept =
    kind === 'image'
      ? 'image/jpeg,image/png,image/webp,image/gif'
      : 'audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/webm'

  return (
    <div className="cedit__field">
      <span className="cedit__label">{label}</span>

      <div className="cedit__media">
        <span className="cedit__thumb cedit__thumb--lg" aria-hidden="true">
          {kind === 'image' && url ? (
            <img className="cedit__thumb-img" src={url} alt="" />
          ) : (
            <span className="cedit__thumb-emoji">
              {kind === 'image' ? '🖼️' : url ? '🔊' : '🔇'}
            </span>
          )}
        </span>

        <div className="cedit__mediabtns">
          <button
            type="button"
            className="cedit__btn cedit__btn--soft"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
          >
            {uploading ? 'Uploading…' : kind === 'image' ? 'Choose Image' : 'Choose Audio'}
          </button>

          {/*
            Removes the custom picture or sound, returning the card to its
            default: the shipped image for a picture, and the synthetic voice
            for a sound. Only offered when there is something to remove.

            It clears the reference on this FORM; the card is not written
            until Save, so Cancel still undoes it. The stored file is tidied
            up by the same server-side sweep that already runs when a card's
            media changes.
          */}
          {url && onRemove && (
            <button
              type="button"
              className="cedit__btn cedit__btn--soft cedit__btn--remove"
              onClick={onRemove}
              disabled={disabled}
            >
              {kind === 'image' ? 'Remove Image' : 'Remove Sound'}
            </button>
          )}

          {/* What is currently set: the chosen filename, or a note that the
              card already has media from before this edit. */}
          {fileName ? (
            <span className="cedit__filename">{fileName}</span>
          ) : url ? (
            <span className="cedit__filename">
              {kind === 'image' ? 'Current picture' : 'Current sound'}
            </span>
          ) : (
            <span className="cedit__filename cedit__filename--empty">None</span>
          )}

          {kind === 'audio' && url && (
            /* So a caregiver can hear what they picked before saving. Native
               controls: this is a caregiver screen, not the child's board. */
            <audio className="cedit__audio" src={url} controls preload="none" />
          )}

          {/* Where the microphone recorder is slotted in for the audio
              field. Kept as a child rather than built in, so this component
              stays "show one piece of media and let it be replaced". */}
          {children}
        </div>
      </div>

      {/*
        The real file picker. Hidden but still in the DOM and focusable, and
        driven by the button above -- which is what opens the OS picker, and
        therefore what gives access to the gallery, Files, Downloads,
        Documents and Desktop without the app listing any of them.
      */}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="cedit__file"
        onChange={onChoose}
      />
    </div>
  )
}

function EditCardDialog({ board, onSaved, onClose }) {
  const [stage, setStage] = useState(MENU)
  /* The screens visited, so Back can retrace the actual path taken. */
  const [history, setHistory] = useState([])

  /* Which folder is being browsed or edited. */
  const [activeFolder, setActiveFolder] = useState(null)

  /* The card being edited -- null when creating one. */
  const [editingCard, setEditingCard] = useState(null)

  /* The working copy of a card's fields. */
  const [word, setWord] = useState('')
  const [folderKey, setFolderKey] = useState('')
  const [imageUrl, setImageUrl] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)

  /* The working copy of a folder's fields. */
  const [folderName, setFolderName] = useState('')
  const [folderEmoji, setFolderEmoji] = useState('')
  const [folderImageUrl, setFolderImageUrl] = useState(null)

  /* The filename the caregiver chose, shown so they can confirm they picked
     the right file before saving. */
  const [imageName, setImageName] = useState('')
  const [audioName, setAudioName] = useState('')

  /*
   * A recording that has been made but NOT saved: a File held in memory,
   * never on the server. Uploaded only when Save is pressed, so discarding it
   * costs nothing and leaves any previously saved recording untouched.
   */
  const [pendingAudio, setPendingAudio] = useState(null)

  /* Deleting a SAVED recording asks first -- see removeSavedAudio(). */
  const [confirmingAudioDelete, setConfirmingAudioDelete] = useState(false)
  const [folderImageName, setFolderImageName] = useState('')

  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  /* Which field is uploading, so only that button shows "Uploading…". */
  const [uploading, setUploading] = useState(null)
  /* Shown briefly after a successful write. */
  const [notice, setNotice] = useState('')

  const firstControlRef = useRef(null)
  const wordInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const audioInputRef = useRef(null)
  const folderImageInputRef = useRef(null)

  /* Every folder, including Core Words -- which is not a board tile but is
     still a real folder whose cards must be editable. */
  const folders = board.allCategories || board.categories

  useEffect(() => {
    if (stage === EDIT_CARD || stage === CREATE_CARD) wordInputRef.current?.focus()
    else firstControlRef.current?.focus()
  }, [stage])

  /* Moves to a screen, remembering where we came from. */
  const go = useCallback(
    (next) => {
      setProblem('')
      setNotice('')
      setHistory((h) => [...h, stage])
      setStage(next)
    },
    [stage],
  )

  /* Steps back one screen, or closes from the menu. */
  const goBack = useCallback(() => {
    setProblem('')
    setNotice('')

    if (history.length === 0) {
      onClose()
      return
    }

    const previous = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    setStage(previous)
  }, [history, onClose])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') goBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goBack])

  /* ---------- opening the various forms ---------- */

  function openCardForEditing(card) {
    setEditingCard(card)
    setWord(card.label)
    setFolderKey(card.category)
    setImageUrl(card.image)
    setAudioUrl(card.audioUrl || null)
    setImageName('')
    setAudioName('')
    /* A take made while looking at another card must not follow us here. */
    setPendingAudio(null)
    setConfirmingAudioDelete(false)
    go(EDIT_CARD)
  }

  function openFolderForEditing(folder) {
    setActiveFolder(folder)
    setFolderName(folder.label)
    setFolderEmoji(folder.emoji || '')
    setFolderImageUrl(folder.imageUrl || null)
    setFolderImageName('')
    go(EDIT_FOLDER)
  }

  function openNewFolderForm() {
    setActiveFolder(null)
    setFolderName('')
    setFolderEmoji('')
    setFolderImageUrl(null)
    setFolderImageName('')
    go(CREATE_FOLDER)
  }

  function openNewCardForm(folder) {
    setEditingCard(null)
    setActiveFolder(folder)
    setWord('')
    setFolderKey(folder ? folder.id : '')
    setImageUrl(null)
    setAudioUrl(null)
    setImageName('')
    setAudioName('')
    go(CREATE_CARD)
  }

  /* ---------- uploads ---------- */

  /*
   * Uploading happens as soon as a file is chosen, but the RESULT is only
   * held in local state -- nothing is written to the card until Save. So a
   * caregiver can pick a picture, look at it, and still back out.
   */
  async function handleFileChosen(event, kind, setUrl, setName, which = kind) {
    const file = event.target.files?.[0]
    /* Clear the input so choosing the SAME file twice fires change again. */
    event.target.value = ''

    if (!file) return

    setProblem('')
    setBusy(true)
    setUploading(which)

    try {
      const url = kind === 'image' ? await uploadImage(file) : await uploadAudio(file)

      /*
       * The upload has SUCCEEDED and the file is on the server -- but the
       * card is untouched. Only local state changes here; the new url is
       * written to MongoDB when Save is pressed, so Cancel genuinely cancels.
       */
      setUrl(url)
      setName(file.name)
    } catch (error) {
      /* The form stays open and the previous picture is still shown, so a
         failed upload costs nothing. */
      setProblem(
        error.message ||
          (kind === 'image'
            ? 'Image upload failed. Please try again.'
            : 'Audio upload failed. Please try again.'),
      )
    } finally {
      setBusy(false)
      setUploading(null)
    }
  }

  /*
   * A finished microphone recording, held as a PENDING clip.
   *
   * WHY NOTHING IS UPLOADED HERE.
   *
   * A recording that has only been previewed is not a decision yet. Uploading
   * on Stop meant a discarded take had already been written to the server --
   * so "Discard" could not really discard it, and each re-record left an
   * orphaned file behind. Worse, it overwrote the form's audioUrl, so the
   * PREVIOUS saved recording was already gone from the form before the
   * caregiver had agreed to anything.
   *
   * Holding the File in memory instead means:
   *   - Discard is genuinely free: drop the object and nothing was stored.
   *   - The existing saved recording is untouched until Save succeeds.
   *   - A failed upload at Save leaves the old recording in place.
   *
   * The upload itself still happens through the SAME uploadAudio() a chosen
   * file uses -- only its timing has moved.
   */
  function handleRecorded(file) {
    setProblem('')
    /* Re-recording replaces the previous take; the recorder that made it
       revokes its own preview URL. */
    setPendingAudio(file)
  }

  /*
   * Throws away a recording that was never saved.
   *
   * Deliberately does NOT touch audioUrl: that still holds whatever was
   * saved before this take, and discarding a new take must leave it exactly
   * as it was.
   */
  function discardPendingAudio() {
    setPendingAudio(null)
    setProblem('')
  }

  /*
   * Removes the recording the card actually has.
   *
   * Confirmed first, because unlike discarding a preview this throws away
   * something the caregiver made and kept. The card is not written until
   * Save, so this is still reversible with Cancel.
   */
  function removeSavedAudio() {
    setAudioUrl(null)
    setAudioName('')
    setPendingAudio(null)
    setConfirmingAudioDelete(false)
  }

  /* ---------- saving ---------- */

  async function saveCard() {
    const trimmed = word.trim()

    if (!trimmed) {
      setProblem('Please enter a word for this card.')
      wordInputRef.current?.focus()
      return
    }
    if (!folderKey) {
      setProblem('Please choose a folder for this card.')
      return
    }

    const target = folders.find((f) => f.id === folderKey)

    setProblem('')
    setBusy(true)

    try {
      /*
       * THE PENDING RECORDING IS UPLOADED HERE, not when it was made.
       *
       * It happens first and inside the same try, so a failed upload aborts
       * the save before the card is touched -- which is what keeps the
       * previously saved recording intact when the network drops. `audioUrl`
       * is only reassigned once the upload has actually returned a url.
       */
      let audioToSave = audioUrl

      if (pendingAudio) {
        setUploading('audio')
        try {
          audioToSave = await uploadAudio(pendingAudio)
        } finally {
          setUploading(null)
        }
      }

      if (editingCard) {
        /*
         * Only CHANGED fields are sent. The backend leaves an absent field
         * alone, so an untouched picture is not rewritten -- and `order` is
         * never sent at all, which is what preserves the card's position.
         * _id and childProfileId are not ours to change.
         */
        const changes = {}
        if (trimmed !== editingCard.label) changes.word = trimmed
        /* toStoredUrl strips the API origin that toMediaUrl added for
           display, so MongoDB keeps the portable root-relative form. */
        if (imageUrl !== editingCard.image) changes.imageUrl = toStoredUrl(imageUrl)
        if ((audioToSave || null) !== (editingCard.audioUrl || null)) {
          changes.audioUrl = toStoredUrl(audioToSave)
        }
        if (folderKey !== editingCard.category) changes.folderId = target?.folderId ?? null

        if (Object.keys(changes).length === 0) {
          onClose()
          return
        }

        await updateCard(editingCard.id, changes)
      } else {
        await createCard({
          word: trimmed,
          folderId: target?.folderId ?? null,
          imageUrl: toStoredUrl(imageUrl),
          audioUrl: toStoredUrl(audioToSave),
        })
      }

      await onSaved()
      onClose()
    } catch (error) {
      /* The form STAYS OPEN with the caregiver's text intact, so a failed
         save never costs them their work. */
      setProblem(error.message || 'Could not save. Please try again.')
      setBusy(false)
    }
  }

  async function saveFolder({ thenCreateCard = false } = {}) {
    const trimmed = folderName.trim()

    if (!trimmed) {
      setProblem('Please enter a folder name.')
      return
    }

    setProblem('')
    setBusy(true)

    try {
      if (activeFolder) {
        /* Editing: _id, childProfileId and order are all preserved -- only
           the named fields change. */
        await updateFolder(activeFolder.folderId, {
          name: trimmed,
          /*
           * The folder's existing emoji is carried through unchanged. There
           * is no longer a field for it -- it was clutter -- but it is still
           * what the tile falls back to if the folder has no picture, so
           * silently clearing it would leave a blank tile.
           */
          emoji: folderEmoji.trim() || null,
          imageUrl: toStoredUrl(folderImageUrl),
        })
        await onSaved()
        onClose()
        return
      }

      const created = await createFolder({
        name: trimmed,
        /*
         * A new folder gets a neutral folder glyph rather than nothing, so a
         * folder created without a picture still has something to show. The
         * caregiver is not asked to pick one -- that was the clutter.
         */
        emoji: folderEmoji.trim() || DEFAULT_FOLDER_EMOJI,
        imageUrl: toStoredUrl(folderImageUrl),
      })

      /* The board must reload before the card form opens, or the new folder
         would not be in the list it renders from. */
      await onSaved()

      if (thenCreateCard) {
        /*
         * Straight on to the card, with the folder just created already
         * chosen -- the caregiver does not pick it again from a list they
         * have only just added to.
         */
        setEditingCard(null)
        setActiveFolder({ id: created.colorKey || created.id, folderId: created.id, label: created.name })
        setWord('')
        setFolderKey(created.colorKey || created.id)
        setImageUrl(null)
        setAudioUrl(null)
        setBusy(false)
        go(CREATE_CARD)
        return
      }

      onClose()
    } catch (error) {
      setProblem(error.message || 'Could not save. Please try again.')
      setBusy(false)
    }
  }

  /* ---------- deleting ---------- */

  /*
   * NOT OPTIMISTIC.
   *
   * Nothing is removed from view until MongoDB has confirmed the delete. On
   * failure the dialog stays open with the item still listed and an error
   * shown -- so a delete that did not happen never looks like one that did.
   */
  async function confirmDeleteCard() {
    setProblem('')
    setBusy(true)

    try {
      await deleteCard(editingCard.id)
      /* Reload from the backend rather than splicing the local copy: the
         database is the source of truth for what remains. */
      await onSaved()
      onClose()
    } catch (error) {
      setProblem(error.message || 'Could not delete the card. Please try again.')
      setBusy(false)
    }
  }

  async function confirmDeleteFolder() {
    setProblem('')
    setBusy(true)

    try {
      await deleteFolder(activeFolder.folderId)
      await onSaved()
      onClose()
    } catch (error) {
      setProblem(error.message || 'Could not delete the folder. Please try again.')
      setBusy(false)
    }
  }

  /* ---------- small building blocks ---------- */

  /* ---------- the screens ---------- */

  const titles = {
    [MENU]: 'Edit Words',
    [PICK_FOLDER_FOR_CARD]: 'Choose a folder',
    [PICK_CARD]: activeFolder?.label || 'Choose a card',
    [EDIT_CARD]: 'Edit card',
    [PICK_FOLDER_TO_EDIT]: 'Choose a folder',
    [EDIT_FOLDER]: 'Edit folder',
    [CREATE_MENU]: 'Create new',
    [CREATE_FOLDER]: 'New folder',
    [CREATE_CARD_WHERE]: 'Where should it go?',
    [CREATE_FOLDER_THEN_CARD]: 'New folder',
    [PICK_FOLDER_FOR_NEW_CARD]: 'Choose a folder',
    [DELETE_MENU]: 'Delete',
    [DELETE_PICK_FOLDER_FOR_CARD]: 'Choose a folder',
    [DELETE_PICK_CARD]: activeFolder?.label || 'Choose a card',
    [DELETE_CONFIRM_CARD]: 'Delete card?',
    [DELETE_PICK_FOLDER]: 'Choose a folder',
    [DELETE_CONFIRM_FOLDER]: 'Delete folder?',
    [CREATE_CARD]: 'New card',
  }

  const cardsHere = activeFolder ? board.cardsByCategory.get(activeFolder.id) || [] : []

  return (
    <div className="cpanel__backdrop" onClick={onClose}>
      <div
        className="cpanel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editwords-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="cpanel__head">
          <button
            type="button"
            className="cpanel__iconbtn"
            onClick={goBack}
            aria-label={history.length === 0 ? 'Close' : 'Back'}
          >
            {history.length === 0 ? (
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

          <h2 className="cpanel__title" id="editwords-title">
            {titles[stage]}
          </h2>
        </header>

        <div className="cpanel__body">
          {notice && <p className="cedit__notice">{notice}</p>}

          {/* ---------- the management menu ---------- */}
          {stage === MENU && (
            <div className="cset__rows">
              <MenuRow
                label="Customize existing card"
                description="Change a word, picture, sound or folder"
                onClick={() => go(PICK_FOLDER_FOR_CARD)}
                innerRef={firstControlRef}
              />
              <MenuRow
                label="Customize existing folder"
                description="Rename a folder or change its icon"
                onClick={() => go(PICK_FOLDER_TO_EDIT)}
              />
              <MenuRow
                label="Create new"
                description="Add a new card or folder"
                onClick={() => go(CREATE_MENU)}
              />
              <MenuRow
                label="Delete"
                description="Remove a card or a folder"
                onClick={() => go(DELETE_MENU)}
              />
            </div>
          )}

          {/* ---------- customize existing card: folder → card ---------- */}
          {stage === PICK_FOLDER_FOR_CARD && (
            <FolderList
              folders={folders}
              firstRef={firstControlRef}
              onPick={(folder) => {
                setActiveFolder(folder)
                go(PICK_CARD)
              }}
            />
          )}

          {stage === PICK_CARD && (
            <div className="cset__rows">
              {cardsHere.length === 0 && <p className="cedit__hint">This folder has no cards yet.</p>}
              {cardsHere.map((card, index) => (
                <button
                  type="button"
                  key={card.id}
                  className="cset__row"
                  onClick={() => openCardForEditing(card)}
                  ref={index === 0 ? firstControlRef : undefined}
                >
                  <span className="cedit__thumb" aria-hidden="true">
                    {card.image ? (
                      <img className="cedit__thumb-img" src={card.image} alt="" />
                    ) : (
                      <span className="cedit__thumb-emoji">{card.emoji || '💬'}</span>
                    )}
                  </span>
                  <span className="cset__row-label">{card.label}</span>
                  <Chevron />
                </button>
              ))}
            </div>
          )}

          {/* ---------- the card form (edit and create share it) ---------- */}
          {(stage === EDIT_CARD || stage === CREATE_CARD) && (
            <div className="cedit__form">
              <label className="cedit__field">
                <span className="cedit__label">Word</span>
                <input
                  ref={wordInputRef}
                  className="cedit__input"
                  type="text"
                  value={word}
                  maxLength={MAX_WORD}
                  onChange={(e) => {
                    setWord(e.target.value)
                    if (problem) setProblem('')
                  }}
                />
              </label>

              <MediaField
                label="Image"
                kind="image"
                url={imageUrl}
                fileName={imageName}
                uploading={uploading === 'image'}
                disabled={busy}
                inputRef={imageInputRef}
                onChoose={(e) => handleFileChosen(e, 'image', setImageUrl, setImageName)}
                onRemove={() => {
                  setImageUrl(null)
                  setImageName('')
                }}
              />

              <MediaField
                label="Audio"
                kind="audio"
                url={audioUrl}
                fileName={audioName}
                uploading={uploading === 'audio'}
                disabled={busy}
                inputRef={audioInputRef}
                onChoose={(e) => {
                  /* Choosing a file supersedes an unsaved take, so the two
                     cannot both be waiting to become the card's sound. */
                  setPendingAudio(null)
                  handleFileChosen(e, 'audio', setAudioUrl, setAudioName)
                }}
                /* Deleting a SAVED sound asks first; see below. */
                onRemove={() => setConfirmingAudioDelete(true)}
              >
                {/*
                  Recording hands its clip to handleRecorded, which HOLDS it
                  rather than uploading -- so Discard costs nothing and the
                  card's existing sound survives until Save succeeds.
                */}
                <AudioRecorder
                  onRecorded={handleRecorded}
                  onDiscarded={discardPendingAudio}
                  hasSaved={Boolean(audioUrl)}
                  disabled={busy}
                />

                {/*
                  Confirming the removal of a sound the card actually has.
                  Inline rather than a separate screen, so the caregiver can
                  see what they are deleting while they decide.
                */}
                {confirmingAudioDelete && (
                  <div className="crec__confirm" role="alertdialog" aria-label="Delete the sound?">
                    <p className="crec__confirmtext">
                      Delete this card&rsquo;s recording? It will go back to the spoken voice.
                    </p>
                    <div className="crec__confirmbtns">
                      <button
                        type="button"
                        className="cedit__btn cedit__btn--soft crec__btn--danger"
                        onClick={removeSavedAudio}
                      >
                        <span aria-hidden="true">🗑</span> Delete
                      </button>
                      <button
                        type="button"
                        className="cedit__btn cedit__btn--soft"
                        onClick={() => setConfirmingAudioDelete(false)}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </MediaField>

              <div className="cedit__field">
                <span className="cedit__label">Folder</span>
                <div className="cedit__chips">
                  {folders.map((folder) => (
                    <button
                      type="button"
                      key={folder.id}
                      className={`cedit__chip ${folderKey === folder.id ? 'cedit__chip--on' : ''}`}
                      onClick={() => {
                        setFolderKey(folder.id)
                        if (problem) setProblem('')
                      }}
                      aria-pressed={folderKey === folder.id}
                    >
                      <span aria-hidden="true">{folder.emoji} </span>
                      {folder.label}
                      {folderKey === folder.id && <span aria-hidden="true"> ✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              {problem && (
                <p className="cedit__error" role="alert">
                  {problem}
                </p>
              )}

              <div className="cedit__actions">
                <button type="button" className="cedit__btn cedit__btn--cancel" onClick={goBack} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="cedit__btn cedit__btn--save" onClick={saveCard} disabled={busy}>
                  {busy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* ---------- customize existing folder ---------- */}
          {stage === PICK_FOLDER_TO_EDIT && <FolderList folders={folders} firstRef={firstControlRef} onPick={openFolderForEditing} />}

          {(stage === EDIT_FOLDER || stage === CREATE_FOLDER) && (
            <div className="cedit__form">
              <label className="cedit__field">
                <span className="cedit__label">Folder name</span>
                <input
                  className="cedit__input"
                  type="text"
                  value={folderName}
                  maxLength={MAX_FOLDER_NAME}
                  ref={firstControlRef}
                  onChange={(e) => {
                    setFolderName(e.target.value)
                    if (problem) setProblem('')
                  }}
                />
              </label>


              <MediaField
                label="Folder picture"
                kind="image"
                url={folderImageUrl}
                fileName={folderImageName}
                uploading={uploading === 'folder-image'}
                disabled={busy}
                inputRef={folderImageInputRef}
                onChoose={(e) =>
                  handleFileChosen(e, 'image', setFolderImageUrl, setFolderImageName, 'folder-image')
                }
              />

              {problem && (
                <p className="cedit__error" role="alert">
                  {problem}
                </p>
              )}

              <div className="cedit__actions">
                <button type="button" className="cedit__btn cedit__btn--cancel" onClick={goBack} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cedit__btn cedit__btn--save"
                  onClick={() => saveFolder({ thenCreateCard: false })}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* ---------- create new ---------- */}
          {stage === CREATE_MENU && (
            <div className="cset__rows">
              <MenuRow
                label="Create new folder"
                description="A new group of cards"
                onClick={openNewFolderForm}
                innerRef={firstControlRef}
              />
              <MenuRow
                label="Create new card"
                description="A new word for the board"
                onClick={() => go(CREATE_CARD_WHERE)}
              />
            </div>
          )}

          {stage === CREATE_CARD_WHERE && (
            <div className="cset__rows">
              <MenuRow
                label="Add to an existing folder"
                onClick={() => go(PICK_FOLDER_FOR_NEW_CARD)}
                innerRef={firstControlRef}
              />
              <MenuRow
                label="Create a new folder for it"
                description="The card is added to it straight away"
                onClick={() => {
                  setActiveFolder(null)
                  setFolderName('')
                  setFolderEmoji('')
                  setFolderImageUrl(null)
                  go(CREATE_FOLDER_THEN_CARD)
                }}
              />
            </div>
          )}

          {stage === CREATE_FOLDER_THEN_CARD && (
            <div className="cedit__form">
              <p className="cedit__hint cedit__hint--left">
                Step 1 of 2 — name the folder, then you will add the card.
              </p>

              <label className="cedit__field">
                <span className="cedit__label">Folder name</span>
                <input
                  className="cedit__input"
                  type="text"
                  value={folderName}
                  maxLength={MAX_FOLDER_NAME}
                  ref={firstControlRef}
                  onChange={(e) => {
                    setFolderName(e.target.value)
                    if (problem) setProblem('')
                  }}
                />
              </label>


              {problem && (
                <p className="cedit__error" role="alert">
                  {problem}
                </p>
              )}

              <div className="cedit__actions">
                <button type="button" className="cedit__btn cedit__btn--cancel" onClick={goBack} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cedit__btn cedit__btn--save"
                  onClick={() => saveFolder({ thenCreateCard: true })}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Next'}
                </button>
              </div>
            </div>
          )}

          {stage === PICK_FOLDER_FOR_NEW_CARD && <FolderList folders={folders} firstRef={firstControlRef} onPick={openNewCardForm} />}

          {/* ---------- delete: the two choices ---------- */}
          {stage === DELETE_MENU && (
            <div className="cset__rows">
              <MenuRow
                label="Delete a card"
                description="Remove one word from a folder"
                onClick={() => go(DELETE_PICK_FOLDER_FOR_CARD)}
                innerRef={firstControlRef}
              />
              <MenuRow
                label="Delete a folder"
                description="Remove a folder and the cards inside it"
                onClick={() => go(DELETE_PICK_FOLDER)}
              />
            </div>
          )}

          {/* ---------- delete a card: folder, then card ---------- */}
          {stage === DELETE_PICK_FOLDER_FOR_CARD && (
            <FolderList
              folders={folders}
              firstRef={firstControlRef}
              onPick={(folder) => {
                setActiveFolder(folder)
                go(DELETE_PICK_CARD)
              }}
            />
          )}

          {stage === DELETE_PICK_CARD && (
            <div className="cset__rows">
              {cardsHere.length === 0 && <p className="cedit__hint">This folder has no cards.</p>}

              {cardsHere.map((card, index) => {
                /*
                 * The five quick-access core words are shown but not
                 * selectable. Hiding them would be more confusing -- a
                 * caregiver would wonder where "Want" had gone -- so they are
                 * listed, dimmed, and labelled as protected.
                 */
                const isProtected = card.coreWord

                return (
                  <button
                    type="button"
                    key={card.id}
                    className={`cset__row ${isProtected ? 'cset__row--locked' : ''}`}
                    onClick={() => {
                      if (isProtected) return
                      setEditingCard(card)
                      go(DELETE_CONFIRM_CARD)
                    }}
                    disabled={isProtected}
                    ref={index === 0 ? firstControlRef : undefined}
                  >
                    {/* The picture as well as the word, so the caregiver can
                        see which card they are about to remove. */}
                    <span className="cedit__thumb" aria-hidden="true">
                      {card.image ? (
                        <img className="cedit__thumb-img" src={card.image} alt="" />
                      ) : (
                        <span className="cedit__thumb-emoji">{card.emoji || '💬'}</span>
                      )}
                    </span>
                    <span className="cset__row-label">
                      {card.label}
                      {isProtected && (
                        <span className="cedit__rowdesc">Main core word — cannot be deleted</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {stage === DELETE_CONFIRM_CARD && editingCard && (
            <div className="cedit__form">
              <div className="cedit__confirm">
                <span className="cedit__thumb cedit__thumb--lg" aria-hidden="true">
                  {editingCard.image ? (
                    <img className="cedit__thumb-img" src={editingCard.image} alt="" />
                  ) : (
                    <span className="cedit__thumb-emoji">{editingCard.emoji || '💬'}</span>
                  )}
                </span>
                <div>
                  <p className="cedit__confirm-title">Delete “{editingCard.label}”?</p>
                  <p className="cedit__confirm-text">This card will be permanently removed.</p>
                </div>
              </div>

              {problem && (
                <p className="cedit__error" role="alert">
                  {problem}
                </p>
              )}

              <div className="cedit__actions">
                <button
                  type="button"
                  className="cedit__btn cedit__btn--cancel"
                  onClick={goBack}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cedit__btn cedit__btn--danger"
                  onClick={confirmDeleteCard}
                  disabled={busy}
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}

          {/* ---------- delete a folder ---------- */}
          {stage === DELETE_PICK_FOLDER && (
            <FolderList
              folders={folders}
              firstRef={firstControlRef}
              onPick={(folder) => {
                setActiveFolder(folder)
                go(DELETE_CONFIRM_FOLDER)
              }}
            />
          )}

          {stage === DELETE_CONFIRM_FOLDER && activeFolder && (
            <div className="cedit__form">
              <div className="cedit__confirm">
                <span className="cedit__thumb cedit__thumb--lg" aria-hidden="true">
                  {activeFolder.imageUrl ? (
                    <img className="cedit__thumb-img" src={activeFolder.imageUrl} alt="" />
                  ) : (
                    <span className="cedit__thumb-emoji">{activeFolder.emoji || '🗂️'}</span>
                  )}
                </span>
                <div>
                  <p className="cedit__confirm-title">Delete “{activeFolder.label}”?</p>
                  <p className="cedit__confirm-text">
                    {cardsHere.length === 0
                      ? 'This folder is empty.'
                      : `This folder contains ${cardsHere.length} ${
                          cardsHere.length === 1 ? 'card' : 'cards'
                        }. Deleting the folder will also delete ${
                          cardsHere.length === 1 ? 'it' : 'them all'
                        }.`}
                  </p>
                </div>
              </div>

              {problem && (
                <p className="cedit__error" role="alert">
                  {problem}
                </p>
              )}

              <div className="cedit__actions">
                <button
                  type="button"
                  className="cedit__btn cedit__btn--cancel"
                  onClick={goBack}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cedit__btn cedit__btn--danger"
                  onClick={confirmDeleteFolder}
                  disabled={busy}
                >
                  {busy ? 'Deleting…' : 'Delete Folder'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

export default EditCardDialog
