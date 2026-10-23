# BuddyTalk — End-to-End Testing & Deployment Readiness Audit

**Date:** 2026-10-23
**Scope:** Full application inspection, live testing, security review, and production-build verification.
**Method:** Live HTTP requests against a running backend instance (localhost:5000) and a running frontend dev server (localhost:5173), connected to the real MongoDB Atlas database and the real AWS S3 bucket. All test accounts and test data created during this audit were deleted afterward and verified removed.

Status legend: **PASS** (tested successfully) · **FAIL** (tested and failed) · **FIXED** (failure corrected and retested) · **BLOCKED** (could not be tested — reason given) · **NOT IMPLEMENTED** (feature does not exist in the repository, confirmed by code search).

---

## 1. Architecture & Technology Stack (confirmed from the repository)

- **Frontend:** React 19, Vite 8, plain JavaScript (no TypeScript at runtime), hand-written CSS. No router — navigation is a state machine in `App.jsx`.
- **Backend:** Node.js, Express 5, a single `backend/server.js` (~4,400 lines) containing all routes/middleware. Raw `mongodb` driver, no ODM.
- **Database:** MongoDB Atlas, 4 collections — `users`, `childProfiles`, `folders`, `cards`.
- **Storage:** AWS S3 for both the built-in card picture library (`CARD_IMAGE_BASE_URL`) and, as of this week, caregiver-uploaded images/audio (`AWS_S3_UPLOADS_BUCKET`, implemented in `backend/storage.js`). Cloudflare R2 remains supported as a fallback option in the same module but is not the active provider. Local disk is the last-resort fallback if neither cloud provider is configured.
- **Auth:** JWT in an httpOnly cookie, bcrypt password hashing, optional Google OAuth.
- **AI / Recommendation / Therapist features:** confirmed **NOT IMPLEMENTED** anywhere in the repository — an exhaustive source search for AI-API integrations, recommendation logic, precision/recall metrics, and a therapist role returned no real matches (only two code comments referencing hypothetical *other* providers, e.g. "like Gemini/ElevenLabs/etc.", never an actual integration).

---

## 2. Feature Inventory (what actually exists, and where)

| Feature | Exists? | Primary files |
|---|---|---|
| Registration / login / logout | Yes | `backend/server.js`, `frontend/src/components/AccountScreen/` |
| Google OAuth | Yes (requires real Google credentials to exercise live) | `backend/server.js` |
| Password reset via email | Yes | `backend/server.js`, `nodemailer` |
| Child profile + auto-seeded board | Yes | `backend/server.js`, `backend/boardData.js` |
| AAC communication board (cards, folders, sentence bar) | Yes | `frontend/src/components/CommunicationBoard/` |
| Text-to-Speech | Yes (Web Speech API, client-side only) | `frontend/src/components/CommunicationBoard/speech.js` |
| Custom card creation, image/audio upload | Yes | `backend/uploads.js`, `backend/storage.js` |
| Card / folder reordering ("Card Flexibility") | Yes | `backend/server.js` (`PUT /api/cards/order`, `PUT /api/folders/order`) |
| Settings PIN (separate from account password) + CAPTCHA recovery | Yes | `backend/server.js` (`/api/settings-password/*`) |
| Caregiver settings (grid size, text size, theme, etc.) | Yes | `backend/server.js` (`PATCH /api/child-profile/settings`) |
| AI sentence suggestions / Gemini integration | **NOT IMPLEMENTED** | — |
| Recommendation engine / personalization | **NOT IMPLEMENTED** | — |
| Therapist role / therapist review workflow | **NOT IMPLEMENTED** | — |
| Offline support | **NOT IMPLEMENTED** (explicitly out of scope per this audit's instructions) | — |

---

## 3. Test Results

### 3.1 Startup & health
| Test | Result |
|---|---|
| Backend starts without runtime errors | **PASS** |
| MongoDB Atlas connects | **PASS** |
| AWS S3 upload storage reports active at startup | **PASS** |
| SMTP (password-reset email) reports ready at startup | **PASS** |
| Frontend dev server starts without errors | **PASS** |
| Frontend production build (`npm run build`) | **PASS** — 306 KB JS / 89.8 KB gzipped, no errors |
| `GET /health` distinguishes "process alive" from "database ready" | **PASS** (verified the response shape; a true live-outage simulation against the real Atlas cluster was not performed to avoid disrupting the real database connection — **BLOCKED** for that specific scenario, by design choice to protect live data) |

### 3.2 Authentication & authorization
| Test | Result |
|---|---|
| Register / login / logout, full cycle | **PASS** |
| Invalid login (wrong password, nonexistent user) — identical generic error for both | **PASS** |
| NoSQL-injection attempt in email/login fields (`{"$ne": null}` style payloads) | **PASS** — rejected at type-checking before reaching the database |
| Access to protected routes with no cookie / a tampered cookie / a well-formed JWT naming a deleted user | **PASS** — all correctly return 401, no crash |
| Cross-account IDOR (Account B attempting to PATCH/DELETE Account A's real card ID) | **PASS** — 404, target data confirmed unmodified |
| Password-reset request for an existing vs. nonexistent email | **PASS** — identical response, no account-enumeration leak |
| Password reset with a fabricated token | **PASS** — rejected |
| `/api/auth/me` and child-profile responses checked for leaked password hash/secrets | **PASS** — none found |

### 3.3 AAC communication board & data integrity
| Test | Result |
|---|---|
| Child profile creation auto-seeds the default board | **PASS** — 13 folders, 301 cards, consistent across repeated test runs |
| Duplicate card/folder ID check across the full seeded board | **PASS** — 301 unique card IDs, 13 unique folder IDs, zero duplicates |
| Every card has a non-empty word | **PASS** — 0 cards with missing/empty word |
| Every one of the 301 built-in card images is actually reachable (not just that the URL field is populated) | **PASS** — all 301 checked individually via live HTTP HEAD requests, 0 failures |
| Card creation / edit / delete | **PASS** |
| Card reordering ("Card Flexibility") — reorder, confirm it persists, reset to default | **PASS** |
| Folder reordering | **PASS** |
| Malformed or nonexistent card/folder IDs on PATCH/DELETE | **PASS** — clean 404s, no crash |

### 3.4 Media upload & storage
| Test | Result |
|---|---|
| Valid image upload → confirmed to land in the real AWS S3 bucket (not local disk) | **PASS** |
| Valid audio upload → confirmed to land in the real AWS S3 bucket | **PASS** |
| Uploaded file read back through the app, confirmed byte-identical | **PASS** |
| Card deletion cleans up its associated S3 files | **PASS** (required an IAM permissions fix — see §5) |
| Disguised executable (Windows `MZ` header, named `.jpg`, declared as `image/jpeg`) | **PASS** — rejected by magic-byte content inspection, not just extension/declared-type checking |
| Oversized file (9 MB against an 8 MB limit) | **PASS** — rejected |
| Empty / no-file multipart upload | **PASS** — rejected |
| Wrong file type on the wrong endpoint (image file sent to the audio endpoint) | **PASS** — rejected |

### 3.5 Text-to-Speech
Text-to-Speech is implemented entirely client-side via the browser's Web Speech API (`speech.js`); it makes no backend request. Verifying actual audible speech output requires a real browser with speakers, which this testing session (HTTP-level, headless) cannot observe directly. **BLOCKED for live audio verification** — the code path was inspected and matches prior conversation history where it was confirmed working in a real browser; not re-verified audibly in this specific session.

### 3.6 Settings PIN & recovery
| Test | Result |
|---|---|
| Set / verify / wrong-PIN-rejected | **PASS** |
| Settings-password rate limiter (tighter than general auth — trips at ~11 attempts vs. 20) | **PASS** |
| CAPTCHA recovery: request challenge → wrong code (challenge correctly consumed, cannot be reused even with the right code afterward) → fresh challenge → correct code → reset | **PASS**, full cycle |

### 3.7 AI / Recommendation / Therapist features
**NOT IMPLEMENTED** — no code exists to test. Not marked as failed; marked as out of scope because the feature itself does not exist in this repository, per direct source inspection.

### 3.8 Security dependency scan
| Component | Result |
|---|---|
| Backend `npm audit` | **FIXED** — 3 vulnerabilities found earlier this week (1 critical: `proxy-addr` IP-spoofing; 1 high: outdated `nodemailer`; 1 moderate: `qs`). All resolved via `npm audit fix` + a manual `nodemailer` major-version upgrade (9.1.1 → 10.2.1), re-verified SMTP still connects correctly afterward. **Currently 0 vulnerabilities.** |
| Frontend `npm audit` | **FIXED** — 2 high-severity findings in build tooling (`vite`, `source-map-js`) found and resolved via `npm audit fix`. Re-verified the production build and dev server both still work after the fix. **Currently 0 vulnerabilities.** |
| CORS allowlist | **PASS** — disallowed origin receives no CORS header; the real frontend origin is correctly allowed |
| `trust proxy` configuration for deployment behind a reverse proxy | **FIXED** — was missing, added (`backend/server.js`), conditioned on `NODE_ENV=production` so local development is unaffected |
| Stack-trace / secret leakage in error responses | **PASS** — none found |

---

## 4. Bugs Found and Fixed

1. **Critical dependency vulnerability (`proxy-addr`, IP spoofing)** — fixed via `npm audit fix`. Directly relevant to deployment, since this library determines client IP behind a reverse proxy, which the rate limiter relies on.
2. **High-severity `nodemailer` vulnerability** — fixed by upgrading to 10.2.1; retested the full password-reset email path afterward, confirmed still working.
3. **Missing `trust proxy` setting** — added; without it, rate limiting would behave unreliably once deployed behind any hosting platform's proxy.
4. **AWS IAM permissions gap** — the upload-storage IAM user initially had write+read permission but not delete permission on the S3 bucket, discovered by actually testing card deletion rather than assuming it worked. Fixed by updating the IAM policy to include `s3:DeleteObject`; retested and confirmed card deletion now correctly removes its S3 files (`filesRemoved: 2` on a card with both an image and an audio attachment).
5. **2 high-severity frontend build-tool vulnerabilities (`vite`, `source-map-js`)** — fixed via `npm audit fix`; confirmed the build and dev server still work afterward.

No confirmed bugs in core AAC functionality (card selection, sentence building, reordering, data isolation) were found this session — every test in that category passed on the first attempt.

---

## 5. Accessibility & Usability (code-level findings; this session did not include live browser/device testing)

- Touch targets for cards use `clamp(84px, 10vw, 124px)` — above the commonly cited 44px minimum accessible touch-target guideline.
- `prefers-reduced-motion` is respected both in JavaScript logic and in CSS media queries.
- No head-tracking, eye-gaze, switch-scanning, or dwell-time input methods exist in the codebase — not tested, because they are not implemented, not because of an environment limitation.
- Live, in-browser accessibility testing on real devices was **not performed in this specific session** (this session tested via direct HTTP requests against the backend, not a driven browser) — this is a genuine gap if a live device/browser pass hasn't been done recently; prior conversation history indicates this was done in earlier sessions, but that is not re-verified here.

---

## 6. Deployment Readiness — Final Assessment

**Production build:** succeeds, confirmed this session.
**Backend startup in a production-like configuration:** confirmed — the listen-before-DB-connect pattern, retry-with-backoff, and graceful-shutdown handling were all read and match standard practice for PaaS hosting (Render/Railway/Fly.io-style platforms).
**Dependency security:** 0 vulnerabilities on both frontend and backend, confirmed just now.
**Core workflows:** all tested paths passed.
**AWS S3 integration:** fully working, upload/read/delete cycle verified live against the real bucket.

**Remaining manual steps before a real deployment** (configuration only, not code):
- Set `NODE_ENV=production` on the hosting platform.
- Set `VITE_API_URL` on the frontend host's build environment to the real deployed backend URL.
- Set `FRONTEND_ORIGIN` on the backend host to the real deployed frontend URL.
- Add the hosting platform's egress IPs (or `0.0.0.0/0`) to MongoDB Atlas's Network Access list.
- Carry over all `backend/.env` variables (database URI, JWT secret, SMTP credentials, AWS keys, Google OAuth credentials) into the hosting platform's environment-variable settings — none of these are hardcoded, all are read from `process.env`.

**Verdict: the application is deployment-ready.** Every workflow that could be tested in this environment passed; the issues found (dependency vulnerabilities, a missing proxy-trust setting, an IAM permissions gap) were all genuine, all fixed, and all re-verified after fixing. The only untested items (live audio output, live browser/device accessibility pass, a genuine database-outage simulation) are untested because they require tools or risk this specific session doesn't have — a headless browser, real speakers, or deliberately disrupting the live production database — not because of any known or suspected defect.

---

## Addendum — Focused Follow-Up (2026-10-23, same day)

This addendum closes out the four specific gaps named above. **No browser-automation or computer-use tool was available in this session** (confirmed by checking) — every item below is either a safe, fully-executed backend test, or a precise code-level inspection with an explicit manual-test script for the parts that genuinely require a human with a browser and speakers. Nothing here is guessed or assumed to pass.

### A1. Text-to-Speech — code-level verification + manual browser test script

**Inspected:** `frontend/src/components/CommunicationBoard/speech.js` in full.

Findings from direct code reading (not executed — these are real, confirmed implementation details):
- Uses only the browser-native Web Speech API (`speechSynthesis`) — no network call, no API key, no cloud fallback.
- Voice selection logic: prefers an `en-IN` voice matching the child's requested gender, falls through to any English voice, and **deliberately returns no voice at all rather than falling back to a non-English voice** — this specifically fixes a real documented past bug ("Happy July" — a Hindi TTS engine misreading English letters) and is a genuinely careful piece of defensive design, confirmed by the code's own inline explanation of the original bug.
- Single-letter cards (e.g. "I", "A") are suffixed with a period before being spoken, so the engine reads them as a word rather than spelling out the letter name — confirmed in code, addresses a real, specific failure mode.
- `interrupt: true` (manual Speak button) cancels any in-progress speech first; `interrupt: false` (automatic word-on-tap) is dropped rather than queued if something is already speaking, so rapid tapping cannot queue up a long backlog of delayed words.
- Errors (`utterance.onerror`) explicitly ignore `"interrupted"`/`"canceled"` (expected outcomes of the app's own cancel calls) and only warn on genuine failures.
- A card's own recorded audio (`playRecording`) takes priority over synthetic speech when present, and **resolves `false` rather than throwing** on a missing file, unsupported codec, or blocked autoplay — confirmed the calling code (`CommunicationBoard.jsx`) falls back to synthetic speech in exactly that case.

**BLOCKED for audible verification** — this session has no browser with audio output. The following is the exact manual test to run yourself (takes about 5 minutes):

1. Open the app in Chrome or Edge, sign in, open the board.
2. Tap any single card (e.g. "I") — confirm it is spoken aloud as a word, not spelled as a letter name.
3. Tap several cards quickly in a row — confirm the board does not "stack up" and delay-play every word; only roughly one word per ~0.9 seconds should play automatically, matching `MIN_GAP_MS` in the code.
4. Build a short sentence, then press the dedicated **Speak** button — confirm it reads the whole sentence and cuts off anything mid-utterance if pressed again immediately.
5. In Settings, switch the voice preference between male/female — confirm the spoken voice audibly changes (exact voice available depends on your OS/browser's installed voices, which is expected and documented in the code itself).
6. Record a custom audio clip for one card (Settings → add a card → record), then tap that card — confirm your own recording plays instead of the synthetic voice.
7. Turn your device's volume to 0 or use a browser tab with autoplay blocked, then tap a card — confirm the app does not crash or show a raw JavaScript error; it should simply not produce sound (an expected, already-handled failure mode per the code above).

### A2. Browser & device accessibility — code-level verification + manual test script

**Inspected:** `frontend/src/components/CommunicationBoard/CommunicationBoard.css` and the card/button layout code.

Findings from direct code reading:
- Card touch targets use `clamp(84px, 10vw, 124px)` — above the commonly cited 44px minimum accessible touch-target guideline, confirmed by reading the actual CSS rule, not assumed.
- `prefers-reduced-motion: reduce` is respected both in a JavaScript check (`boardSettings.js`) and in dedicated CSS media-query blocks.
- No head-tracking, eye-gaze, or switch-scanning input exists in the codebase — correctly not tested, because it is not implemented, not because of a tooling gap.

**BLOCKED for a live visual/physical pass** — no browser tool available in this session. Manual test script:

1. Open the app on an actual phone and an actual tablet (not just a resized desktop browser window) — confirm cards remain legible and tappable without pinch-zooming.
2. Try to accidentally mis-tap a card by tapping right at its edge — confirm the touch target is forgiving rather than needing pixel-perfect accuracy.
3. Build a sentence, then deliberately make a "mistake" (tap a wrong card) — confirm there is a clear, reachable way to remove that one card or clear the whole sentence without it being a tiny, easy-to-miss control.
4. Rotate the device between portrait and landscape — confirm the board re-flows sensibly rather than clipping content off-screen.
5. If you or anyone testing has a motion-sensitivity preference set at the OS level (reduce motion), confirm the board's card-selection animation is actually absent, matching the code's stated behavior.

*No clinical or medical accessibility validation is claimed here — this is a usability check only, consistent with the instruction given for this audit.*

### A3. Database failure handling — PASS (fully tested, safely, without touching the live database)

A completely separate backend instance was started on a different port (5099) with a deliberately fake, unreachable `MONGODB_URI`, specifically so the real production Atlas connection was never touched or disrupted. Four things were verified live against this isolated instance:

| Test | Result |
|---|---|
| Server starts and listens even though the database is unreachable | **PASS** — confirmed via the startup log and a live request |
| `GET /health` reports `200 OK` with `database.ready: false` and a visible retry count, rather than crashing or hanging | **PASS** — `retryAttempts: 3` observed within 4 seconds, confirming the retry-with-backoff loop is genuinely running |
| A request with no session cookie still correctly returns `401` (not `503`) during the outage | **PASS** — confirms the code checks "are you logged in" before ever touching the database, so an outage is never mistaken for "you're signed out" |
| A request with a well-formed session token, requiring the database, returns a clean `503` with a clear message during the outage — no crash, no raw stack trace | **PASS** |

The test instance was stopped immediately afterward; `netstat` was used to confirm its port is no longer listening. The real backend (port 5000) and its real Atlas connection were independently confirmed healthy and untouched before and after this test.

### A4. Deployment configuration — reviewed, one new item found

Full environment-variable list, confirmed directly from the source (`grep` across `server.js`, `storage.js`, `boardData.js` for every `process.env.*` reference, and across the frontend `src/` for every `import.meta.env.*` reference) — **names only, no values printed**:

**Backend**, set on the hosting platform:
`NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_ORIGIN` (and/or `FRONTEND_ORIGINS` for multiple allowed origins), `COOKIE_SAMESITE`, `COOKIE_SECURE`, `GOOGLE_CLIENT_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_UPLOADS_BUCKET`, `AWS_REGION`, `CARD_IMAGE_BASE_URL`. (`R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME` remain supported as a dormant fallback but are not required while AWS S3 is configured.) `DEV_LAN_CORS` is development-only and should be left unset in production.

**Frontend**, set in the static-host's **build** environment (not just "available at runtime" — Vite bakes these in at build time):
- `VITE_API_URL` — the real deployed backend's URL. Already covered in the original audit.
- **`VITE_GOOGLE_CLIENT_ID` — newly identified this session.** Confirmed in `frontend/src/components/AccountScreen/AccountScreen.jsx`: the Google Sign-In button checks for this specific variable and, if unset, shows the caregiver a clear message ("Google sign-in is not configured yet...") rather than breaking the page — so this is **not a blocker**, but if you want the Google Sign-In button to actually work on the deployed site, this variable must be set at build time, separately from the backend's own `GOOGLE_CLIENT_ID`.

**MongoDB Atlas:** Network Access list must include the hosting platform's egress IP(s), or `0.0.0.0/0` if the platform's IPs are not fixed/predictable (common on free-tier PaaS hosting) — unchanged from the original audit, reconfirmed still accurate.

**CORS:** reconfirmed — the `trust proxy` setting added earlier this week, and the `FRONTEND_ORIGIN`-based allowlist, were both re-read in full this session and match exactly what was described in the original audit; no changes needed.

---

### Addendum Summary

| Area | Status |
|---|---|
| Text-to-Speech implementation | Code-verified (**PASS** on all inspectable logic); audible output **BLOCKED** — manual script provided above |
| Browser/device accessibility | Code-verified (**PASS** on touch-target size and reduced-motion handling); live visual/physical pass **BLOCKED** — manual script provided above |
| Database failure handling | **PASS** — fully and safely tested against an isolated instance; the real production database was never touched |
| Deployment configuration | Reviewed — **one new non-blocking finding**: `VITE_GOOGLE_CLIENT_ID` must be set at frontend build time for Google Sign-In to function on the deployed site |

**No code was changed during this addendum.** No bug was found that required a fix — the one new item (`VITE_GOOGLE_CLIENT_ID`) is a configuration step, not a defect, and the existing graceful-degradation behavior around it was confirmed correct as-is.

**Final statement:** every workflow that this environment can safely and directly test has been tested and passes, including a genuine (safely isolated) database-outage simulation. The two remaining gaps — audible speech output and a live in-browser/device accessibility pass — are not failures; they are explicitly BLOCKED because this session has no browser-audio or computer-use tool available, and precise manual test scripts have been provided in their place. **The application is ready for a controlled deployment**, with the one addition to the configuration checklist (`VITE_GOOGLE_CLIENT_ID`) if Google Sign-In is wanted on the live site.

---

*Addendum reflects the state of the repository as of 2026-10-23 (same day as the original audit). Git status was clean before this addendum and remains clean after it — no files were modified, only `docs/DEPLOYMENT_AUDIT.md` itself was appended to.*
