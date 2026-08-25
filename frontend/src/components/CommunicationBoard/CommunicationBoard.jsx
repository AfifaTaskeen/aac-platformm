import { useState, useRef, useEffect, useCallback } from 'react'
import TopBar from './components/TopBar'
import RightMenu from './components/RightMenu'
import Keyboard from './components/Keyboard'
import CommunicationCard from './components/CommunicationCard'
import PlaceholderDialog from './components/PlaceholderDialog'
import SettingsDialog from './components/SettingsDialog'
import EditCardDialog from './components/EditCardDialog'
import {
  getGridSize,
  loadGridSize,
  saveGridSize,
  loadTextSize,
  saveTextSize,
  loadTheme,
  saveTheme,
  applyTheme,
} from './boardSettings'
import { fetchBoard } from './boardApi'
/*
 * The PALETTE only. The words and folders now come from MongoDB; cardData.js
 * still owns what each category LOOKS like, because a colour is presentation
 * and belongs beside the stylesheet rather than in a database document.
 */
import { categoryColors } from './cardData'
import { folderCoverUrl } from './folderCovers'
import { speakText, playAlert } from './speech'
import './CommunicationBoard.css'

/*
 * CommunicationBoard.jsx
 * ----------------------
 * The board itself: core words, category folders, and the cards inside them.
 *
 * This component owns the STATE and hands pieces to smaller components. The
 * top bar, search, right menu and keyboard are each separate, so any of them
 * can be moved later for a child who needs the controls somewhere else --
 * which is a real requirement here, not a hypothetical.
 *
 * Props:
 *   childProfile - the saved profile. gridSize sets the column count and
 *                  voice sets which voice speaks. Both come from the
 *                  authenticated user's profile; this screen never asks
 *                  again and never writes to it.
 */

/* Used when a profile somehow has no grid size. */
const FALLBACK_GRID_SIZE = 3

/*
 * The key the Core Words folder is filed under.
 *
 * It matches the folder's colorKey, which is what boardApi uses as a
 * category id. Core Words is deliberately excluded from the folder TILES but
 * still present in cardsByCategory, so opening it by this key works exactly
 * as opening any other folder does -- the same documents, no duplication.
 */
const CORE_WORDS_KEY = 'core'

/*
 * The key the Emergency folder is filed under.
 *
 * Like Core Words, Emergency is a real folder in MongoDB but is NOT drawn as
 * a board tile (see boardApi.js). Its entry point is the Alert button, which
 * is always visible in the right-hand menu -- so a child who is hurt or
 * frightened reaches these words in one tap from anywhere, instead of
 * hunting for a tile among thirteen.
 */
const EMERGENCY_KEY = 'emergency'

function CommunicationBoard({ childProfile }) {
  /*
   * The sentence being built: an array of card objects, in tap order.
   * Objects rather than strings, so a repeated word is still a distinct
   * entry and Delete removes exactly one.
   */
  const [sentence, setSentence] = useState([])

  /*
   * Which folder is open. null means the home board (core words + folders).
   * A single value is enough for one level of folders; when folders can
   * nest, this becomes an array used as a stack.
   */
  const [openCategory, setOpenCategory] = useState(null)

  /*
   * THE BOARD ITSELF, loaded from MongoDB.
   *
   * `board` holds { basicWords, categories, cardsByCategory } once the
   * request succeeds, and stays null until then. Three states, and exactly
   * one is true at a time:
   *
   *   board === null && !error   ->  still loading
   *   error                      ->  the request failed
   *   board                      ->  render it
   *
   * There is deliberately no fallback to cardData.js. Quietly rendering the
   * built-in words when the database is unreachable would hide the failure at
   * the worst possible moment: a caregiver's edits would silently vanish and
   * the board would look fine, so nobody would know to fix it.
   */
  const [board, setBoard] = useState(null)
  const [boardError, setBoardError] = useState(null)

  /* Bumped to re-run the fetch when the user presses Try again. */
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    setBoardError(null)

    fetchBoard({ signal: controller.signal })
      .then((loaded) => setBoard(loaded))
      .catch((error) => {
        // An abort is this component going away, not a failure to report.
        if (error.name === 'AbortError') return
        console.log('Could not load the board:', error)
        setBoardError(error.message || 'Could not load the board. Please try again.')
      })

    return () => controller.abort()
  }, [reloadCount])

  /*
   * Re-reads the board from MongoDB after an edit.
   *
   * Awaited by the edit dialog, which closes only once this resolves -- so
   * the panel never disappears before the change it made is on screen. It
   * deliberately re-FETCHES rather than patching the local copy: the database
   * is the source of truth, and a locally-applied change could disagree with
   * what was actually stored.
   */
  const reloadBoard = useCallback(async () => {
    const loaded = await fetchBoard()
    setBoard(loaded)
  }, [])

  const [isEditOpen, setIsEditOpen] = useState(false)

  /*
   * The Grid Size setting. Read from localStorage on first render -- the
   * lazy initialiser form runs once, so storage is not touched on every
   * render.
   */
  const [gridSizeId, setGridSizeId] = useState(loadGridSize)

  /* The Text Size setting -- the size of the words on cards, nothing else. */
  const [textSizeId, setTextSizeId] = useState(loadTextSize)

  /* Light or dark. Applied to <html>, so it covers every screen. */
  const [themeId, setThemeId] = useState(loadTheme)

  useEffect(() => {
    applyTheme(themeId)
  }, [themeId])

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [dialog, setDialog] = useState(null)

  /* The scrolling card area, moved by the Up/Down buttons. */
  const cardAreaRef = useRef(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  /*
   * Viewport width, kept in state so the row count recalculates when the
   * window is resized or the tablet is turned. Reading window.innerWidth
   * directly during render would go stale on the next rotation.
   */
  const [boardWidth, setBoardWidth] = useState(
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  )

  /*
   * Viewport HEIGHT, tracked for the same reason as the width above.
   *
   * A phone in landscape is wide but very short -- ~318px of page once
   * Android Chrome's URL bar is showing -- and the column count has to know
   * that. Width alone would put a landscape phone in the same bucket as a
   * tablet and produce cards taller than the whole scroll area.
   */
  const [boardHeight, setBoardHeight] = useState(
    typeof window === 'undefined' ? 768 : window.innerHeight,
  )

  useEffect(() => {
    function onResize() {
      setBoardWidth(window.innerWidth)
      setBoardHeight(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    /* Rotating a phone fires orientationchange; on some Android builds the
       resize that follows reports the OLD height, so both are listened for. */
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  /*
   * The grid size the caregiver chose, straight from the saved profile.
   * There is deliberately no way to change it here -- Child Profile owns
   * that setting, and two places to set one value would only disagree.
   */
  const gridSize = Number(childProfile?.gridSize) || FALLBACK_GRID_SIZE
  const voicePreference = childProfile?.voice || 'female'

  /*
   * The saved grid size chooses the card SIZE, not a fixed column count.
   *
   * A smaller grid (2x2) means bigger cards; 4x4 means smaller ones. The
   * board then fits as many of those columns as the screen allows, so a wide
   * landscape tablet fills its width instead of leaving empty margins at the
   * sides -- while a card stays exactly the size the caregiver asked for.
   *
   * The widths are what each grid size yields on a portrait tablet (~768px
   * of card area), which is what keeps 2, 3 and 4 visibly different sizes.
   */
  const CARD_WIDTH_BY_GRID = { 2: '260px', 3: '190px', 4: '150px' }
  const minCardWidth = CARD_WIDTH_BY_GRID[gridSize] || CARD_WIDTH_BY_GRID[3]

  /*
   * The column count, matching the breakpoints in CommunicationBoard.css
   * exactly. The two MUST agree: the row height is the available height
   * divided by the row count, so a mismatch either squashes the cards or
   * lets the bottom row run off the screen.
   *
   * Tablet-first -- 3 is the base case, and the wider screens are the
   * exceptions written around it.
   */
  function columnsForWidth(width) {
    /*
     * SHORT LANDSCAPE (a phone on its side) is decided by HEIGHT, not width.
     *
     * Such a screen is wide -- 844px or more -- so the width rules below
     * would give it 3 columns, and a 3-column card on an 844px board is
     * ~273px tall against a card area of ~141px: not even one full row
     * visible, so the child cannot see a whole card without scrolling.
     *
     * More columns means narrower columns, and card height follows column
     * width through the picture's ratio, so 5 columns is what brings a card
     * close to the available height. It matches the CSS query exactly
     * (orientation: landscape and max-height: 500px) so the two cannot
     * disagree about which layout is in force.
     */
    if (boardHeight <= 500 && width > boardHeight) return 5

    if (width <= 700) return 2
    if (width >= 1300) return 5
    if (width >= 1000) return 4
    return 3
  }

  /* The Grid Size setting chosen in Settings. */
  const gridSizeSetting = getGridSize(gridSizeId)

  /*
   * The column count actually used: what the screen would show, shifted by
   * the Grid Size setting.
   *
   *   Small  +1 column  -> more, smaller cards
   *   Medium  0         -> unchanged, today's layout exactly
   *   Large  -1 column  -> fewer, larger cards
   *
   * Working in COLUMNS rather than pixels means the setting composes with
   * the responsive breakpoints instead of overriding them: Large on a
   * desktop still shows more across than Large on a tablet, and no size can
   * produce cards too small to tap, because the floor is 1 column.
   */
  function effectiveColumns() {
    const base = columnsForWidth(boardWidth)
    return Math.max(1, base + gridSizeSetting.shift)
  }

  function rowsFor(cardCount) {
    return Math.max(1, Math.ceil(cardCount / effectiveColumns()))
  }

  /*
   * Builds the inline variables the grid reads.
   *
   * --cols is now set here rather than by a CSS breakpoint, so the setting
   * and the row arithmetic can never disagree -- they are computed from the
   * same number.
   */
  function gridStyleFor(cardCount) {
    return {
      '--colw': minCardWidth,
      '--cols': effectiveColumns(),
      '--rows': rowsFor(cardCount),
    }
  }

  /*
   * Tapping a card appends it to the sentence.
   *
   * The updater form -- (current) => [...current, card] -- rather than
   * [...sentence, card] is what makes rapid tapping safe: each update is
   * applied to the freshest state, so two taps in the same frame cannot
   * both read the same stale array and drop one of the words.
   *
   * The word is also spoken immediately, so the child hears what they chose
   * without pressing anything else -- for a child still matching a picture to
   * its word, that instant confirmation is most of the point of the card.
   *
   * interrupt: false is deliberate. A sentence the child asked to hear is
   * never cut off by a card tapped while it plays, and a fast run of taps
   * speaks the first word rather than queueing a backlog that leaves the
   * board narrating long after the child has moved on. The card is added
   * either way: the sentence never depends on whether the sound played.
   */
  function handleSelectCard(card) {
    setSentence((current) => [...current, card])
    speakText(card.label, { voicePreference, interrupt: false })
  }

  /* Typed words become the same shape as a card, so everything downstream
     -- rendering, Delete, Speak -- treats them identically. */
  function handleAddTypedWord(word) {
    setSentence((current) => [
      ...current,
      { id: `typed-${Date.now()}`, label: word, category: 'typed', image: null, coreWord: false },
    ])
  }

  function handleSpeak() {
    /* The whole sentence, in tap order, as one utterance -- so it is read
       with sentence intonation rather than as disconnected words. */
    const text = sentence.map((word) => word.label).join(' ')

    /* interrupt: true -- pressing Speak means "say this now", so anything
       still playing (including a word from the card just tapped) stops. */
    const started = speakText(text, { voicePreference, interrupt: true })

    if (!started) {
      setDialog({
        title: 'Speech not available',
        message: 'This browser cannot speak text aloud. Try Chrome or Edge.',
      })
      return
    }

    /*
     * Shows "Speaking…" for roughly the length of the sentence. The Web
     * Speech API does fire onend events, but they are unreliable across
     * browsers -- a timer keeps the label honest without depending on them.
     */
    setIsSpeaking(true)
    const estimatedMs = Math.min(6000, 700 + text.length * 90)
    setTimeout(() => setIsSpeaking(false), estimatedMs)
  }

  function handleDelete() {
    setSentence((current) => current.slice(0, -1))
  }

  function handleClear() {
    setSentence([])
  }

  /*
   * Back steps out one level: a search closes, then the keyboard, then an
   * open folder. One button, one predictable step at a time.
   */
  function handleBack() {
    if (isKeyboardOpen) {
      setIsKeyboardOpen(false)
      return
    }
    setOpenCategory(null)
  }

  const canGoBack = isKeyboardOpen || openCategory !== null

  /*
   * Works out whether the card area can still be scrolled, so the Up and
   * Down buttons can be disabled when there is nowhere to go -- rather than
   * looking active but doing nothing.
   */
  const updateScrollState = useCallback(() => {
    const el = cardAreaRef.current
    if (!el) return
    setCanScrollUp(el.scrollTop > 4)
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 4)
  }, [])

  /* Re-checked whenever the contents change, since a different folder means
     a different amount to scroll. */
  useEffect(() => {
    updateScrollState()
  }, [openCategory, isKeyboardOpen, updateScrollState])

  useEffect(() => {
    const el = cardAreaRef.current
    if (!el) return

    el.addEventListener('scroll', updateScrollState, { passive: true })
    /* Also re-check when the window resizes: a shorter window can turn a
       fitting grid into a scrolling one. */
    window.addEventListener('resize', updateScrollState)

    /*
     * ...and whenever the CONTENT's height changes, which is the case the
     * two listeners above both miss.
     *
     * Card images are lazy-loaded. At mount the grid is only as tall as its
     * empty boxes, so scrollHeight barely exceeds clientHeight and Down is
     * computed as "nothing to scroll" -- and it stays disabled, because
     * neither a scroll nor a resize ever follows. Measured on a 390x732
     * Android viewport: scrollHeight 2092 vs clientHeight 406, yet Down was
     * disabled until a resize event was fired by hand.
     *
     * A ResizeObserver on the scroll container and on the grid inside it
     * re-measures as the images arrive, so Up/Down become enabled exactly
     * when there really is something to scroll.
     */
    let observer = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateScrollState)
      observer.observe(el)
      const grid = el.querySelector('.cboard__grid')
      if (grid) observer.observe(grid)
    }

    /*
     * WHY THE OBSERVER ALONE IS NOT ENOUGH -- measured, not assumed.
     *
     * A timeline captured on a 390x732 Android viewport:
     *
     *   t=4197ms   scrollHeight 406 == clientHeight 406   (nothing to scroll)
     *   t=6150ms   scrollHeight 2092                      (the real content)
     *
     * The effect runs at the first moment, when the container genuinely has
     * nothing to scroll, so `false` was the CORRECT answer then. The content
     * arrives two seconds later -- and no scroll, no resize, and no size
     * change to any observed BOX accompanies it, so nothing ever recomputed
     * and Down stayed disabled for good. A single real scroll event enabled
     * it instantly, which is what proved the state, not the maths, was stale.
     *
     * So the growth itself has to be watched. scrollHeight is not observable
     * directly, so this samples it briefly after mount: every 250ms until it
     * stops changing, and never longer than 5s. That is a handful of cheap
     * reads during the load and then nothing -- no permanent timer.
     */
    let lastHeight = el.scrollHeight
    const poll = setInterval(() => {
      const h = el.scrollHeight
      if (h !== lastHeight) {
        lastHeight = h
        updateScrollState()
      }
    }, 250)
    /*
     * Runs for a fixed 8 seconds and then stops -- deliberately NOT
     * "until the height stops changing".
     *
     * An earlier version gave up after the height had been stable for one
     * second, which looked tidy and was wrong: the measured timeline shows
     * the poll starting at t=4806ms and the content arriving at t=5972ms,
     * with a quiet second in between. The early-exit fired during that gap,
     * so the poll was already cancelled when the content finally grew.
     *
     * A fixed window cannot make that mistake. Eight seconds of one cheap
     * property read every 250ms is ~32 reads during startup, then nothing.
     */
    const pollCap = setTimeout(() => clearInterval(poll), 8000)

    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
      if (observer) observer.disconnect()
      clearInterval(poll)
      clearTimeout(pollCap)
    }
    /* openCategory is a dependency so the observer re-attaches to the NEW
       grid element when the child opens a different folder. */
  }, [updateScrollState, openCategory, isKeyboardOpen])

  /* Moves the card area by most of a screenful, keeping a little overlap so
     the child does not lose their place. */
  function scrollCards(direction) {
    const el = cardAreaRef.current
    if (!el) return
    el.scrollBy({ top: direction * el.clientHeight * 0.8, behavior: 'smooth' })
  }

  function openFolder(categoryId) {
    setOpenCategory(categoryId)
    /*
     * Opening a folder always leaves the keyboard.
     *
     * renderCardArea() checks isKeyboardOpen FIRST, so while the keyboard is
     * up it wins over whatever category is selected. Setting the category
     * without clearing this flag changed the state but not the screen: Core
     * Words and Alert appeared to do nothing, because the keyboard was still
     * drawn over the cards they had just opened.
     *
     * Clearing it here rather than in each caller means every route into a
     * folder -- Core Words, Alert, and tapping a folder card -- behaves the
     * same way, and a future one cannot forget.
     */
    setIsKeyboardOpen(false)
    // Start a new folder at the top rather than wherever the last one was.
    if (cardAreaRef.current) cardAreaRef.current.scrollTop = 0
  }

  /*
   * What fills the card area. Exactly one of: the keyboard, an open folder,
   * or the home board.
   */
  function renderCardArea() {
    if (isKeyboardOpen) {
      return <Keyboard onAddWord={handleAddTypedWord} onClose={() => setIsKeyboardOpen(false)} />
    }

    /*
     * Still fetching, or the fetch failed. Both are shown INSIDE the card
     * area, so the sentence bar and the toolbar stay exactly where they are
     * -- the screen does not jump when the board arrives.
     */
    if (boardError) {
      return (
        <div className="cboard__status" role="alert">
          <p className="cboard__status-text">{boardError}</p>
          <button
            type="button"
            className="cboard__status-btn"
            onClick={() => setReloadCount((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )
    }

    if (!board) {
      return (
        <div className="cboard__status" role="status" aria-live="polite">
          <p className="cboard__status-text">Loading the board…</p>
        </div>
      )
    }

    if (openCategory) {
      const cardsHere = board.cardsByCategory.get(openCategory) || []
      return (
        <div className="cboard__grid" style={gridStyleFor(cardsHere.length)}>
          {cardsHere.map((card) => (
            <CommunicationCard
              key={card.id}
              card={card}
              onSelect={handleSelectCard}
            />
          ))}
        </div>
      )
    }

    /*
     * The home board: core words then folders, in ONE continuous grid.
     *
     * No section headings and no board title -- the cards themselves are the
     * content, and every extra line of text is something a child has to look
     * past to reach them.
     */
    return (
      <div
        className="cboard__grid"
        style={gridStyleFor(board.basicWords.length + board.categories.length)}
      >
        {board.basicWords.map((card) => (
          <CommunicationCard
            key={card.id}
            card={card}
            onSelect={handleSelectCard}
            isCore
          />
        ))}

        {board.categories.map((category) => (
          <button
            type="button"
            /*
             * A folder is now the SAME shape as a word card -- no protruding
             * tab -- so the grid is one even run of cards. It is still
             * announced as a folder, which is what tells a screen reader the
             * difference now that the shape no longer does.
             */
            className="ccard ccard--tinted cfolder"
            key={category.id}
            /*
             * The colours come from the PALETTE, looked up by the folder's
             * colorKey -- not from the database. cardData.js still owns what
             * "food" looks like, which is why the folders are painted exactly
             * as they were before this change.
             */
            style={{
              '--tint': categoryColors(category.id)?.tint,
              '--deep': categoryColors(category.id)?.deep,
            }}
            onClick={() => openFolder(category.id)}
            aria-label={`Open ${category.label} folder`}
          >
            {/*
              A folder shows its PICTURE when it has one, and falls back to
              its emoji when it does not.

              The image branch was missing entirely, which is why a folder
              created with a picture still showed only an emoji: the url was
              fetched, carried through boardApi and origin-corrected for
              display, and then never rendered.

              The same two classes as a word card, so a folder with a picture
              is laid out exactly like the cards inside it -- fixed square
              area, object-fit: contain, no stretching.
            */}
            {/*
              The folder's cover, in priority order (see folderCovers.js):
                1. the caregiver's own image, if they customised this folder
                2. the built-in cover shipped with the app
                3. the emoji, if neither exists
              Identical markup either way, so the tile keeps the same fixed
              square area, object-fit and dimensions as every other card.
            */}
            {folderCoverUrl(category) ? (
              <span className="ccard__imagebox">
                <img
                  className="ccard__image"
                  src={folderCoverUrl(category)}
                  alt=""
                  draggable="false"
                />
              </span>
            ) : (
              <span className="ccard__imagebox ccard__imagebox--emoji">
                <span className="ccard__emoji" aria-hidden="true">
                  {category.emoji}
                </span>
              </span>
            )}
            <span className="ccard__label">{category.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    /*
     * Two rows, not two columns:
     *
     *   row 1  the back arrow and the sentence bar, spanning the full width
     *   row 2  the card area and the toolbar, side by side
     *
     * That is why the toolbar is nested inside the lower row rather than
     * being a sibling of everything: it must start BELOW the sentence bar,
     * and the sentence bar must reach all the way to the right edge.
     */
    <div
      className={`cboard cboard--text-${textSizeId}`}
      /*
       * The class is what applies Text Size: CommunicationBoard.css states
       * the label sizes for each one outright. Every card label -- word
       * cards, core words, and FOLDER names -- is a descendant of this
       * element, so a folder and the cards inside it change together.
       */
    >
      <TopBar
        words={sentence}
        canGoBack={canGoBack}
        onBack={handleBack}
        onSpeak={handleSpeak}
        onDelete={handleDelete}
        onClear={handleClear}
        isSpeaking={isSpeaking}
      />

      <div className="cboard__lower">
        <div className="cboard__main">
          {/*
            The scrolling region. Only this area scrolls -- the sentence bar
            and the toolbar stay put, so the controls never move out of reach.
            The keyboard renders in here too, which is why it can never cover
            the sentence bar or the toolbar.
          */}
          {/*
            NOTE: there is deliberately no --popping class here any more.

            It used to switch this element to `overflow: visible` for the
            duration of a tap, to stop an enlarged card being clipped. That
            was the cause of the screen jumping on lower rows: this element is
            a SCROLL CONTAINER (overflow-y: auto), and an element that stops
            being scrollable discards its scrollTop -- so the board snapped
            back to the top on every tap once the child had scrolled down.
            The card no longer travels far enough to need the extra room.
          */}
          <div
            className={[
              'cboard__cards',
              gridSizeId === 'small' ? 'cboard__cards--small' : '',
              gridSizeId === 'large' ? 'cboard__cards--large' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            ref={cardAreaRef}
          >
            {renderCardArea()}
          </div>
        </div>

        <RightMenu
          /*
           * Edit Words is no longer a sidebar button -- it now lives inside
           * Settings, which is where configuration belongs. The dialog says so
           * explicitly, so the feature is not simply lost.
           */
          onSettings={() => setIsSettingsOpen(true)}
          /*
           * Opens the Core Words folder in the card area, exactly as tapping
           * a folder tile does -- because it IS a real folder in MongoDB,
           * holding the same card documents the five quick-access words come
           * from. This button is its only entry point: Core Words is
           * deliberately absent from the folder tiles (see boardApi.js), so
           * there is one way in, not two.
           *
           * It used to open a placeholder dialog, which is why the words
           * never appeared: the data was always there and nothing ever asked
           * for it.
           */
          onCoreWords={() => openFolder(CORE_WORDS_KEY)}
          onKeyboard={() => setIsKeyboardOpen((open) => !open)}
          isKeyboardOpen={isKeyboardOpen}
          onScrollUp={() => scrollCards(-1)}
          onScrollDown={() => scrollCards(1)}
          canScrollUp={canScrollUp}
          canScrollDown={canScrollDown}
          /*
           * Alert now does two things: it sounds the attention tone, exactly
           * as before, AND opens the Emergency folder -- the sound calls an
           * adult over while the cards give the child the words to explain.
           * The tone is kept because it was the button's whole purpose until
           * now, and losing it would remove a working feature.
           */
          onAlert={() => {
            playAlert()
            openFolder(EMERGENCY_KEY)
          }}
        />
      </div>

      {dialog && (
        <PlaceholderDialog title={dialog.title} message={dialog.message} onClose={() => setDialog(null)} />
      )}

      {isSettingsOpen && (
        <SettingsDialog
          gridSize={gridSizeId}
          /*
           * Applies immediately -- the board re-renders behind the open
           * dialog, so the effect of a choice is visible while choosing it.
           * The value is saved at the same moment, so a refresh keeps it.
           */
          onSelectGridSize={(id) => {
            setGridSizeId(id)
            saveGridSize(id)
          }}
          textSize={textSizeId}
          onSelectTextSize={(id) => {
            setTextSizeId(id)
            saveTextSize(id)
          }}
          theme={themeId}
          onSelectTheme={(id) => {
            setThemeId(id)
            saveTheme(id)
          }}
          /* Settings closes as Edit Words opens, so only one panel is ever
             on screen. */
          onEditWords={() => {
            setIsSettingsOpen(false)
            setIsEditOpen(true)
          }}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/*
        Editing needs the board to list folders and cards, so it only opens
        once the board has loaded. There is no path to it while loading --
        Settings itself is reachable, but the row leads here only after the
        data exists.
      */}
      {isEditOpen && board && (
        <EditCardDialog
          board={board}
          onSaved={reloadBoard}
          onClose={() => setIsEditOpen(false)}
        />
      )}
    </div>
  )
}

export default CommunicationBoard
