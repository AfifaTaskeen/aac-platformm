# Technology Stack

This lists only what's actually in the codebase and `package.json` files — nothing planned or considered-but-unused.

## Frontend

- **React 19** — the UI is built as a tree of components (the board, the card editor, settings, account screens).
- **Vite** — dev server and production build tool.
- Plain JavaScript (no TypeScript) and hand-written CSS using custom properties for theming (no Tailwind or other CSS framework).
- **Web Speech API** (browser-native) — text-to-speech, with no external service or API key.
- **MediaRecorder / Web Audio API** (browser-native) — lets a caregiver record their own voice for a card directly in the browser.

## Backend

- **Node.js** with **Express 5** — a REST API; all routes live in a single `server.js`.
- Raw `mongodb` driver (no ODM/Mongoose) — queries and validation are written directly against the driver.
- `cookie-parser`, `express-rate-limit` — session cookie parsing and rate limiting on authentication and Settings-PIN routes.

## Database

- **MongoDB Atlas** — four collections: `users`, `childProfiles`, `folders`, `cards`. Every folder/card document is scoped by its owning child profile's ID, which comes from the authenticated session rather than anything the client sends — this is what keeps one family's data from being reachable by another account.

## Authentication & Security

- **JWT** (`jsonwebtoken`), stored in an httpOnly cookie — identifies a signed-in caregiver on every request without the token being readable by page JavaScript.
- **bcrypt** — hashes the account password and the separate Settings PIN; neither is ever stored as plain text.
- **Google OAuth** (`google-auth-library`) — optional "Sign in with Google," verified server-side against Google's own token endpoint.
- A separate, independent Settings PIN (4 characters) gates the Settings screen, with its own CAPTCHA-based recovery flow if forgotten.
- File uploads are checked by their actual binary content (not just the file extension or declared type) before being accepted.

## Media Storage

- **AWS S3** — used for both the built-in card picture library and caregiver-uploaded photos/audio.
- Cloudflare R2 is supported in the code as an alternative storage backend, and local disk is used as a fallback during development when no cloud storage is configured — but AWS S3 is the storage actually in use.

## Email

- **Nodemailer** over SMTP — sends password-reset emails. If SMTP isn't configured, the reset link is printed to the server log instead, so local development works without any email setup.

## Development Tools

- Git and GitHub for version control.
- `npm` for both frontend and backend dependencies.
- `oxlint` for frontend linting.
- `npm audit` is run regularly to catch dependency vulnerabilities (the project currently has zero known vulnerabilities on both frontend and backend).

## Architecture

```
Caregiver / Child (browser)
        │
        ▼
React frontend (Vite)
        │  fetch() requests, session cookie included
        ▼
Express backend
        │  requireAuth → requireChildProfile middleware
        ▼
MongoDB Atlas (users, childProfiles, folders, cards)
        │
        ▼
AWS S3 (built-in card images + caregiver uploads)
```

Text-to-speech happens entirely in the browser (Web Speech API) and never touches the backend — tapping a card speaks it instantly with no network round-trip.

## Deployment (planned)

Not yet deployed as of this writing. The intended setup is a static-site host for the frontend and a Node-process host for the backend, with MongoDB Atlas and AWS S3 unchanged — see `docs/DEPLOYMENT_AUDIT.md` for the full readiness checklist and exact environment-variable requirements.
