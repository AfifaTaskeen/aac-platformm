require("dotenv").config();

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require("path");
/* Promise-based fs, so the image listing can be awaited like everything else. */
const fs = require("fs/promises");
const nodemailer = require("nodemailer");
/* Google Cloud Text-to-Speech, kept in its own module -- see tts.js. */
const tts = require("./tts");
/* The starting board a new child profile is given -- see boardData.js. */
const { seedBoardForChild, ORDER_STEP, toImageUrl, CARD_IMAGE_ROOT } = require("./boardData");
/* Caregiver-uploaded pictures and audio -- see uploads.js. */
const uploads = require("./uploads");

const app = express();

/*
 * Which frontend addresses may call this API.
 *
 * Vite picks the next free port when its usual one is taken, so the React app
 * may be served from 5173 OR 5174 (or 5175...) depending on what else is
 * running. All of them are listed so a shifting dev port does not break
 * sign-in.
 *
 * FRONTEND_ORIGIN in .env is still honoured and simply added to the list, so
 * a deployed URL can be allowed without touching this file.
 */
const ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    process.env.FRONTEND_ORIGIN
].filter(Boolean);

/*
 * Google's library for verifying ID tokens. It fetches Google's public signing
 * keys itself and caches them, so we never handle key material directly.
 */
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/* How long a signed-in session lasts. */
const SESSION_DAYS = 7;

/*
 * CORS -- required for the React app to talk to this server.
 *
 * The frontend runs on http://localhost:5173 and this API on
 * http://localhost:5000. Different ports count as different ORIGINS, and a
 * browser refuses to let a page read a response from another origin unless
 * that server explicitly allows it. (Tools like Postman and curl are not
 * browsers, which is why the route already worked when tested directly.)
 *
 * These headers grant that permission. Before a POST carrying JSON, the
 * browser first sends an OPTIONS "preflight" request asking whether the real
 * request is allowed; the block below answers it with 204 No Content.
 *
 * NOTE: this cannot send "*" (any website). The session cookie used by Google
 * sign-in counts as a credential, and a browser REFUSES to send credentials to
 * a wildcard origin -- so the EXACT origin must be echoed back.
 *
 * That is why this checks the request's Origin header against the allow-list
 * and reflects it. A request from an origin not on the list simply gets no
 * CORS header, and the browser blocks it.
 */
app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;

    if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
        res.header("Access-Control-Allow-Origin", requestOrigin);
        // Lets the browser send and receive the session cookie cross-origin.
        res.header("Access-Control-Allow-Credentials", "true");
    }

    /*
     * PATCH is in this list because the card and folder edit routes use it.
     *
     * A method missing here is not a 405 -- it is a request the browser never
     * sends at all. For anything other than a simple GET/POST the browser
     * first asks OPTIONS "may I use this method?", and if the answer does not
     * name it, the real request is blocked in the browser. fetch() then
     * rejects with a bare TypeError carrying no status, which looks exactly
     * like the server being unreachable. That is precisely how the missing
     * PATCH presented: "Could not reach the server", while the server was
     * running perfectly and every GET worked.
     *
     * Node's http client does not enforce CORS, so back-end tests cannot
     * catch this -- only a browser can.
     */
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    // The response differs per origin, so caches must not mix them up.
    res.header("Vary", "Origin");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.json());

/*
 * Serves caregiver-uploaded pictures and audio.
 *
 * Mounted BEFORE express.json() would matter and before the API routes, so a
 * request for /uploads/... is answered with the file and never falls through
 * to a route.
 *
 * These are deliberately NOT behind requireAuth. An <img> or <audio> element
 * cannot send a session cookie on a cross-origin request in every browser, so
 * gating them would break the very thing they exist for. The filenames are 8
 * random bytes, so a URL cannot be guessed, and nothing about a picture of a
 * cup is sensitive in the way the database is. Access control lives on the
 * DATA -- which card belongs to which child -- not on the bytes.
 *
 * `fallthrough: false` means a missing file returns 404 rather than
 * continuing into the API routes and producing a confusing error.
 */
app.use(
    uploads.UPLOAD_URL_PREFIX,
    express.static(uploads.UPLOAD_ROOT, {
        fallthrough: false,
        // Uploaded media never changes once written -- the filename is unique
        // per upload -- so it can be cached hard.
        maxAge: "30d",
        index: false,
        dotfiles: "deny"
    })
);

// Parses the Cookie header into req.cookies, so we can read the session back.
app.use(cookieParser());

/* ==========================================================================
   SESSION HANDLING

   Google sign-in ends with "this person is authenticated". That fact has to be
   remembered somewhere, or the next request would have no idea who they are.

   The mechanism used here is a JSON Web Token (JWT) stored in an httpOnly
   cookie:
     - the server signs a small token naming the user's id
     - it is sent back as a cookie the browser stores and re-sends automatically
     - httpOnly means page JavaScript CANNOT read it, so a cross-site scripting
       bug cannot steal the session
     - it is signed, not encrypted -- so it holds only an id, never anything
       secret
   ========================================================================== */
function createSession(res, user) {
    const token = jwt.sign(
        // The "payload" -- deliberately tiny. Never put secrets in here; a JWT
        // is signed so it cannot be TAMPERED with, but anyone can READ it.
        { userId: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: `${SESSION_DAYS}d` }
    );

    res.cookie("session", token, {
        httpOnly: true,   // JavaScript cannot read this cookie
        sameSite: "lax",  // not sent on cross-site requests, limiting CSRF
        secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
        maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
    });
}

const client = new MongoClient(process.env.MONGODB_URI, {
    family: 4
});

// Set once the connection succeeds, so the routes can reach the collections.
let users;
let childProfiles;
/*
 * The communication board's data. Same database, same client, same pattern as
 * the two above -- these are two more collections inside BuddyTalk, not a new
 * connection and not a new database.
 */
let folders;
let cards;

// How many rounds bcrypt uses when hashing. Higher = slower = harder to crack.
const SALT_ROUNDS = 10;

// Same forgiving check the React form uses: something @ something . something
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 8;

/*
 * The password rules, mirroring PASSWORD_RULES in the React app exactly.
 *
 * The browser checks these too, but that is only a convenience: anyone can
 * send a request straight to this route with Postman or curl and skip the form
 * entirely. The server has to enforce every rule itself.
 */
const PASSWORD_RULES = [
    { label: `at least ${MIN_PASSWORD_LENGTH} characters`, test: (p) => p.length >= MIN_PASSWORD_LENGTH },
    { label: "one uppercase letter", test: (p) => /[A-Z]/.test(p) },
    { label: "one lowercase letter", test: (p) => /[a-z]/.test(p) },
    { label: "one number", test: (p) => /[0-9]/.test(p) },
    // Anything that is not a letter, a number, or a space.
    { label: "one special character", test: (p) => /[^A-Za-z0-9\s]/.test(p) }
];

/*
 * Returns an error message listing everything the password is missing, or ""
 * when it satisfies every rule. Naming the specific failures is far more
 * useful than a generic "password too weak".
 */
function checkPasswordRules(password) {
    const missing = PASSWORD_RULES
        .filter((rule) => !rule.test(password))
        .map((rule) => rule.label);

    if (missing.length === 0) {
        return "";
    }

    return `Password must contain ${missing.join(", ")}.`;
}

async function connectDB() {
    try {
        await client.connect();

        console.log("MongoDB connected successfully");

        const db = client.db("BuddyTalk");
        users = db.collection("users");
        childProfiles = db.collection("childProfiles");
        /*
         * The board's two collections. Created lazily by MongoDB on first
         * write, so naming them here costs nothing and does not disturb the
         * existing users/childProfiles data in any way.
         */
        folders = db.collection("folders");
        cards = db.collection("cards");

        /*
         * Tell MongoDB that no two documents may share the same email.
         * The check inside the route catches almost every duplicate, but two
         * requests arriving at the same instant could both pass that check
         * before either one inserts. This index is the database itself
         * refusing the second write, which is the only airtight guarantee.
         *
         * Creating it is safe to run on every startup: if the index already
         * exists, MongoDB does nothing.
         */
        await users.createIndex({ email: 1 }, { unique: true });

        /*
         * The same protection for Google accounts. `sparse` means documents
         * WITHOUT a googleId are ignored by this index -- otherwise every
         * password-only user would count as having googleId: null, and the
         * second such user would be rejected as a duplicate.
         */
        await users.createIndex({ googleId: 1 }, { unique: true, sparse: true });

        /*
         * One child profile per user. The upsert in the save route already
         * matches on userId, but this index is the database itself refusing a
         * second profile -- the only airtight guarantee against duplicates.
         */
        await childProfiles.createIndex({ userId: 1 }, { unique: true });

        /* ------------------------------------------------------------------
           BOARD INDEXES

           Every board query filters by childProfileId -- that is the whole
           point of the design, since one child must never see another's
           cards. Without an index MongoDB would scan every card belonging to
           every child on every board load, which is fine with one family and
           unusable with a thousand.

           The compound indexes put childProfileId FIRST deliberately. A
           compound index can serve any leading subset of its fields, so
           { childProfileId, position } also answers a plain childProfileId
           query -- and it returns the rows already sorted, so MongoDB never
           has to sort them in memory.
           ------------------------------------------------------------------ */

        /* "All this child's folders, in display order" -- the folder query. */
        await folders.createIndex({ childProfileId: 1, order: 1 });

        /*
         * Two documents belonging to the SAME child may not share a key. This
         * is what makes seeding safe to attempt twice: if two requests race,
         * the second insert is refused by the database rather than producing a
         * duplicate board.
         *
         * Scoped to the child, so every child still gets their own "food"
         * folder -- the pair must be unique, not the key alone.
         */
        await folders.createIndex({ childProfileId: 1, key: 1 }, { unique: true });

        /* "All this child's cards, in order" -- used by the board load. */
        await cards.createIndex({ childProfileId: 1, order: 1 });

        /*
         * "This child's cards inside this folder" -- the single most frequent
         * query once a child starts opening folders. Also covers core words,
         * which are the folderId: null case.
         */
        await cards.createIndex({ childProfileId: 1, folderId: 1, order: 1 });

        /* The same anti-duplicate guarantee as folders. */
        await cards.createIndex({ childProfileId: 1, key: 1 }, { unique: true });

        console.log("Indexes ready: users, childProfiles, folders, cards");

        // Reports whether SMTP works, so a typo in .env is obvious at startup
        // rather than only when a reset email silently fails to arrive.
        await verifyMailConfig();

        // The server only starts listening once the database is actually
        // available, so no request can arrive before `users` exists.
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, () => {
            console.log(`Server listening on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.log("MongoDB connection failed:", error);
    }
}

/* ==========================================================================
   PASSWORD RESET SUPPORT
   ========================================================================== */

/* How long a reset link stays usable. */
const RESET_TOKEN_MINUTES = 30;

/*
 * Hashes a reset token for storage.
 *
 * The raw token goes in the email link; only this hash is written to MongoDB.
 * That means a leaked database dump cannot be used to reset anyone's password,
 * because the value in the database is not the value the link needs.
 *
 * SHA-256 rather than bcrypt here on purpose: the token is 32 random bytes we
 * generated, so it cannot be guessed or brute-forced the way a human-chosen
 * password can, and a fast hash keeps the lookup quick.
 */
function hashResetToken(rawToken) {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/*
 * Builds the mail transport from environment variables.
 *
 * If SMTP is not configured, this returns null and the calling code logs the
 * reset link to the terminal instead. That keeps local development working
 * with zero email setup -- you copy the link out of the server console.
 */
function createMailTransport() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        // Port 465 uses implicit TLS; 587 upgrades via STARTTLS.
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
            // These belong to Buddy Talk's OWN sender mailbox. They are never a
            // user's credentials: nobody is ever asked for their Gmail password,
            // and no user password of any kind is stored here.
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

/*
 * Checks the SMTP settings once at startup and reports the result, so a typo
 * in .env is obvious immediately instead of silently swallowing every reset
 * email. Purely diagnostic -- it never blocks the server from starting.
 */
async function verifyMailConfig() {
    const transport = createMailTransport();

    if (!transport) {
        console.log("Email: SMTP not configured -- reset links will be printed to this terminal.");
        return;
    }

    try {
        await transport.verify();
        console.log(`Email: SMTP ready (${process.env.SMTP_HOST} as ${process.env.SMTP_USER})`);
    } catch (error) {
        console.log("Email: SMTP configuration FAILED --", error.message);
        if (/invalid login|username and password not accepted|badcredentials/i.test(error.message)) {
            console.log("       Gmail requires a 16-character APP PASSWORD, not the normal account password.");
            console.log("       Create one at: Google Account -> Security -> 2-Step Verification -> App passwords");
        }
    }
}

/*
 * The reset email body. Buddy Talk's colours and a real tappable button, since
 * a bare URL in an email is easy to miss and easy to break across lines.
 *
 * Email clients strip <style> blocks and ignore most modern CSS, so everything
 * here is inline styles on tables -- the one approach that renders consistently
 * in Gmail, Outlook and Apple Mail. The plain-text version below is what
 * clients that block HTML will show.
 */
function buildResetEmail(resetUrl) {
    const html = `
<div style="margin:0;padding:24px;background-color:#FFF7EC;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:3px solid #2B2B3A;border-radius:20px;">
    <tr>
      <td style="padding:28px 28px 8px;">
        <p style="margin:0;font-size:22px;font-weight:bold;color:#2B2B3A;">Buddy Talk</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px;">
        <h1 style="margin:12px 0 8px;font-size:24px;line-height:1.25;color:#2B2B3A;">Reset your password</h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.5;color:#2B2B3A;">
          Someone asked to reset the password for your Buddy Talk account.
          Tap the button below to choose a new one.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 8px;" align="center">
        <a href="${resetUrl}"
           style="display:inline-block;padding:16px 34px;background-color:#FF6F5E;color:#2B2B3A;
                  font-size:18px;font-weight:bold;text-decoration:none;border:3px solid #2B2B3A;
                  border-radius:999px;">
          Reset Password
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 28px;">
        <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#5C5C6B;">
          This link expires in ${RESET_TOKEN_MINUTES} minutes and can only be used once.
        </p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#5C5C6B;">
          If the button does not work, copy and paste this address into your browser:<br>
          <span style="word-break:break-all;color:#2B2B3A;">${resetUrl}</span>
        </p>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#5C5C6B;">
          If you did not ask for this, you can ignore this email &mdash; your password will not change.
        </p>
      </td>
    </tr>
  </table>
</div>`.trim();

    const text =
        `Buddy Talk -- Reset your password\n\n` +
        `Someone asked to reset the password for your Buddy Talk account.\n\n` +
        `Open this link to choose a new password:\n${resetUrl}\n\n` +
        `The link expires in ${RESET_TOKEN_MINUTES} minutes and can only be used once.\n\n` +
        `If you did not ask for this, you can ignore this email -- your password will not change.`;

    return { html, text };
}

/*
 * Sends the reset email.
 *
 * Returns "sent", "logged" (no SMTP configured -- link printed to the console
 * for local development) or throws if the send genuinely failed.
 *
 * Throwing matters: silently swallowing a failure produced exactly the bug
 * being fixed here, where the UI reported success and no email ever arrived.
 */
async function sendResetEmail(toEmail, resetUrl) {
    const transport = createMailTransport();

    if (!transport) {
        console.log("\n=== PASSWORD RESET (no SMTP configured) ===");
        console.log(`  to:   ${toEmail}`);
        console.log(`  link: ${resetUrl}`);
        console.log(`  expires in ${RESET_TOKEN_MINUTES} minutes`);
        console.log("===========================================\n");
        return "logged";
    }

    const { html, text } = buildResetEmail(resetUrl);

    /*
     * Gmail rewrites the From address to the authenticated mailbox anyway, so
     * MAIL_FROM defaults to SMTP_USER rather than a made-up address that would
     * look like spoofing to spam filters.
     */
    const from = process.env.MAIL_FROM || `"Buddy Talk" <${process.env.SMTP_USER}>`;

    const info = await transport.sendMail({
        from,
        to: toEmail,
        subject: "Reset your Buddy Talk password",
        text,
        html
    });

    console.log(`Password reset email sent to ${toEmail} (id ${info.messageId})`);
    return "sent";
}

/* ==========================================================================
   POST /api/auth/forgot-password
   Starts a password reset.

   ALWAYS replies with the same generic message, whether or not the address
   has an account. Confirming which emails are registered would let anyone
   discover who uses Buddy Talk one address at a time.
   ========================================================================== */
app.post("/api/auth/forgot-password", async (req, res) => {
    // One message for every outcome, defined once so no branch can differ.
    const genericResponse = {
        success: true,
        message: "If an account exists for this email, a password reset link has been sent."
    };

    try {
        const { email } = req.body;

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                success: false,
                field: "email",
                message: "Please enter your email address."
            });
        }

        if (!EMAIL_PATTERN.test(email.trim())) {
            return res.status(400).json({
                success: false,
                field: "email",
                message: "Please enter a valid email address."
            });
        }

        const normalisedEmail = email.trim().toLowerCase();
        const user = await users.findOne({ email: normalisedEmail });

        /*
         * No account, or a Google-only account with no password to reset.
         * Both return the generic message so the two cases are
         * indistinguishable from outside.
         */
        if (!user || !user.password) {
            return res.status(200).json(genericResponse);
        }

        // 32 random bytes: the value that goes in the emailed link.
        const rawToken = crypto.randomBytes(32).toString("hex");

        await users.updateOne(
            { _id: user._id },
            {
                $set: {
                    // Only the HASH is stored, never the raw token.
                    resetTokenHash: hashResetToken(rawToken),
                    resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000)
                }
            }
        );

        /*
         * The link points at the app ROOT with the token as a query parameter,
         * not at a /reset-password path. The project has no router and Vite's
         * dev server has no SPA fallback, so a made-up path would 404 before
         * React ever loaded. App.jsx reads ?token= on startup and shows the
         * reset screen.
         *
         * The origin is taken from the request when it is one we already trust
         * (Vite moves between 5173/5174/5175 depending on what is free), so the
         * link always points back at the app the user is actually using. It
         * falls back to FRONTEND_ORIGIN for requests without an Origin header.
         *
         * Only allow-listed origins are used -- an attacker cannot send a
         * forged Origin header to make the link point at their own site.
         */
        const requestOrigin = req.headers.origin;
        const frontendUrl = ALLOWED_ORIGINS.includes(requestOrigin)
            ? requestOrigin
            : (process.env.FRONTEND_ORIGIN || "http://localhost:5173");

        const resetUrl = `${frontendUrl}/?token=${rawToken}`;

        /*
         * If the email genuinely cannot be sent, say so instead of claiming
         * success -- a silent failure is what made this look "working" while
         * nothing arrived.
         *
         * The 503 is safe to expose because its cause is the SERVER's mail
         * configuration, which is identical for every address. It is only
         * reachable after we already know the account exists, but a broken
         * mail server produces the same failure for every real account, so it
         * still tells an attacker nothing about any particular address.
         *
         * The token stays in the database: harmless, unreachable without the
         * emailed link, and it expires on its own.
         */
        try {
            await sendResetEmail(normalisedEmail, resetUrl);
        } catch (mailError) {
            console.log("Could not send reset email:", mailError.message);

            return res.status(503).json({
                success: false,
                message: "We could not send the reset email just now. Please try again in a few minutes."
            });
        }

        return res.status(200).json(genericResponse);

    } catch (error) {
        console.log("Forgot password failed:", error);
        /*
         * A genuine server fault (database unreachable, and so on). Reporting
         * it is safe: it happens for every address alike, so it reveals
         * nothing about whether this one has an account -- and pretending the
         * link was sent when nothing happened is exactly the failure mode this
         * change exists to remove.
         */
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/auth/reset-password
   Finishes a password reset: checks the token, then sets the new password.
   ========================================================================== */
app.post("/api/auth/reset-password", async (req, res) => {
    try {
        const { token, password } = req.body;

        if (typeof token !== "string" || !token) {
            return res.status(400).json({
                success: false,
                message: "This reset link is not valid. Please request a new one."
            });
        }

        if (typeof password !== "string" || !password) {
            return res.status(400).json({
                success: false,
                field: "password",
                message: "Please enter a new password."
            });
        }

        /*
         * The SAME rules the sign-up form enforces, reusing the same function
         * -- so a reset can never quietly set a weaker password than
         * registration would allow.
         */
        const passwordProblem = checkPasswordRules(password);

        if (passwordProblem) {
            return res.status(400).json({
                success: false,
                field: "password",
                message: passwordProblem
            });
        }

        /*
         * Look the user up BY THE HASH of the supplied token, and require the
         * expiry to still be in the future. An expired or already-used token
         * simply matches nothing.
         */
        const user = await users.findOne({
            resetTokenHash: hashResetToken(token),
            resetTokenExpiresAt: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: "This reset link has expired or has already been used. Please request a new one."
            });
        }

        // Same hashing as registration.
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        await users.updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword, passwordChangedAt: new Date() },
                // SINGLE USE: removing the token makes this link dead.
                $unset: { resetTokenHash: "", resetTokenExpiresAt: "" }
            }
        );

        return res.status(200).json({
            success: true,
            message: "Password reset successfully."
        });

    } catch (error) {
        console.log("Reset password failed:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/auth/register
   Creates one new user account.
   ========================================================================== */
app.post("/api/auth/register", async (req, res) => {
    try {
        // 1. Pull the three values out of the JSON the React form sent.
        const { name, email, password } = req.body;

        // 2. Check they are all actually present and are text.
        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                success: false,
                field: "name",
                message: "Please enter your name."
            });
        }

        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                success: false,
                field: "email",
                message: "Please enter your email address."
            });
        }

        if (!EMAIL_PATTERN.test(email.trim())) {
            return res.status(400).json({
                success: false,
                field: "email",
                message: "Please enter a valid email address."
            });
        }

        if (typeof password !== "string" || !password) {
            return res.status(400).json({
                success: false,
                field: "password",
                message: "Please enter a password."
            });
        }

        /*
         * Enforce the strength rules. This happens BEFORE bcrypt.hash() below,
         * so a rejected password is never hashed and never touches the
         * database -- and we do not waste the deliberately-slow hashing work
         * on input we are going to refuse anyway.
         */
        const passwordProblem = checkPasswordRules(password);

        if (passwordProblem) {
            return res.status(400).json({
                success: false,
                field: "password",
                message: passwordProblem
            });
        }

        /*
         * Store emails lower-cased and trimmed. Someone typing "Amina@X.com"
         * must not be able to register a second account alongside
         * "amina@x.com" -- to a person those are the same address.
         */
        const normalisedEmail = email.trim().toLowerCase();

        // 3. Is this email already taken?
        const existingUser = await users.findOne({ email: normalisedEmail });

        if (existingUser) {
            // 409 Conflict: the request was well formed, but it clashes with
            // something already stored.
            return res.status(409).json({
                success: false,
                field: "email",
                message: "An account with this email already exists."
            });
        }

        // 4. Turn the password into a hash. This is one-way: the original
        //    text cannot be recovered from the result.
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // 5. Save the user. Note `password` is never placed on this object --
        //    only `hashedPassword` is stored.
        const result = await users.insertOne({
            name: name.trim(),
            email: normalisedEmail,
            password: hashedPassword,
            createdAt: new Date()
        });

        // 6. Success. 201 means "created".
        //    The hash is deliberately left out of the response -- there is no
        //    reason for the browser to ever receive it.
        return res.status(201).json({
            success: true,
            message: "Account created successfully.",
            user: {
                id: result.insertedId,
                name: name.trim(),
                email: normalisedEmail
            }
        });

    } catch (error) {
        /*
         * Error code 11000 is MongoDB's "duplicate key". It fires if two
         * requests race past the findOne() check above and both try to insert
         * the same email. Reported the same way as the normal duplicate, so
         * the user sees a sensible message either way.
         */
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                field: "email",
                message: "An account with this email already exists."
            });
        }

        // Anything unexpected: log the detail for us, tell the user something
        // general. Internal error text should never be sent to the browser.
        console.log("Registration failed:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/auth/login
   Signs in an existing account created with an email and password.

   Reuses createSession() -- the same session mechanism Google sign-in uses --
   so there is only ever one way a user becomes "signed in".
   ========================================================================== */
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Basic presence checks. Deliberately NOT the sign-up strength rules:
        // an account created before those rules existed must still be able to
        // sign in, and telling someone their stored password is "too weak" at
        // the login screen would be both confusing and useless.
        if (typeof email !== "string" || !email.trim()) {
            return res.status(400).json({
                success: false,
                field: "email",
                message: "Please enter your email address."
            });
        }

        if (typeof password !== "string" || !password) {
            return res.status(400).json({
                success: false,
                field: "password",
                message: "Please enter your password."
            });
        }

        // Stored lower-cased at registration, so look it up the same way.
        const normalisedEmail = email.trim().toLowerCase();

        const user = await users.findOne({ email: normalisedEmail });

        /*
         * SECURITY: the same message and the same status for "no such email"
         * and "wrong password".
         *
         * Saying "no account with that email" would let anyone test addresses
         * one at a time to discover who has an account here -- and for an app
         * used by families of children with disabilities, merely revealing
         * that someone is a user is a privacy leak worth avoiding.
         */
        const invalidCredentials = {
            success: false,
            field: "password",
            message: "Invalid email or password."
        };

        if (!user) {
            return res.status(401).json(invalidCredentials);
        }

        /*
         * An account created through Google has no password field at all.
         * bcrypt.compare would throw on undefined, so this is handled
         * explicitly -- and with a message that actually helps, since the
         * person does have an account and just needs the other button.
         */
        if (!user.password) {
            return res.status(401).json({
                success: false,
                field: "password",
                message: "This account was created with Google. Please use Continue with Google."
            });
        }

        /*
         * Compare the typed password against the stored hash.
         *
         * The hash is never reversed -- bcrypt re-hashes the attempt using the
         * salt embedded in the stored hash and checks whether the results
         * match. This is why a stolen database still does not reveal anyone's
         * password.
         */
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).json(invalidCredentials);
        }

        await users.updateOne(
            { _id: user._id },
            { $set: { lastLoginAt: new Date() } }
        );

        // Same session cookie as Google sign-in.
        createSession(res, user);

        // Only safe public fields -- never the hash.
        return res.status(200).json({
            success: true,
            message: "Signed in successfully.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.log("Login failed:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/auth/google
   Signs a user in with Google. NEVER creates an account.

   An unknown Google account is refused with 404, and nothing is written to
   the database. Creating an account is the Sign Up page's job alone.

   The browser sends one thing: the ID token Google handed it. An ID token is a
   signed JWT containing the user's Google id, email and name.

   Everything below hinges on VERIFYING that token. Without verification anyone
   could POST a hand-written token claiming to be any email address, so this
   route would be a way to log in as anybody. verifyIdToken() checks Google's
   cryptographic signature, the audience (that it was issued for OUR app), the
   issuer, and the expiry.
   ========================================================================== */
app.post("/api/auth/google", async (req, res) => {
    try {
        /*
         * Validate the input FIRST. A malformed request is a client error
         * (400) regardless of how the server happens to be configured, and
         * answering 500 here would wrongly blame the server.
         */
        const { credential } = req.body;

        if (typeof credential !== "string" || !credential) {
            return res.status(400).json({
                success: false,
                message: "No Google sign-in token was received."
            });
        }

        /*
         * Note: this route takes no "which button" parameter. Both Google
         * buttons behave identically -- they sign in an existing account and
         * refuse an unknown one. There is deliberately no request field that
         * could ask it to create anything.
         */

        // Only then check that this server can actually verify anything.
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.JWT_SECRET) {
            console.log("Google sign-in is not configured: missing GOOGLE_CLIENT_ID or JWT_SECRET in backend/.env");
            return res.status(503).json({
                success: false,
                message: "Google sign-in is not configured on the server yet."
            });
        }

        // 1. Verify the token really came from Google and really is for us.
        let payload;
        try {
            const ticket = await googleClient.verifyIdToken({
                idToken: credential,
                audience: process.env.GOOGLE_CLIENT_ID
            });
            payload = ticket.getPayload();
        } catch (verifyError) {
            console.log("Google token verification failed:", verifyError.message);
            return res.status(401).json({
                success: false,
                message: "Google sign-in could not be verified. Please try again."
            });
        }

        // 2. Pull out the identity Google vouched for.
        //    `sub` is Google's permanent unique id for this account. It is the
        //    right thing to key on: a person can change their email address,
        //    but sub never changes.
        const googleId = payload.sub;
        const email = (payload.email || "").trim().toLowerCase();
        const name = (payload.name || "").trim() || email.split("@")[0];

        /*
         * Google tells us whether it has verified the address. If it has not,
         * we must not trust it -- otherwise someone could create a Google
         * account claiming an email they do not own and take over the matching
         * Buddy Talk account.
         */
        if (!email || payload.email_verified !== true) {
            return res.status(401).json({
                success: false,
                message: "Your Google account does not have a verified email address."
            });
        }

        /*
         * 3. Look for an existing Buddy Talk account.
         *
         * Two ways to match, both needed:
         *   - googleId: the permanent id, correct even if they changed email
         *   - email:    someone who registered with a password first and is
         *               now pressing the Google button -- the same person
         *
         * Matching on email is safe ONLY because email_verified was checked
         * above. Without that check, anyone could make a Google account
         * claiming someone else's address and take over their account.
         */
        let user = await users.findOne({
            $or: [
                { googleId: googleId },
                { email: email }
            ]
        });

        /*
         * 4. THE RULE: Google signs people IN. It never signs anybody UP.
         *
         * If there is no Buddy Talk account for this Google identity, refuse.
         * The Sign Up page is the only place an account is created.
         *
         * This is the enforcement point, and it lives HERE, on the server.
         * The frontend also shows a helpful message, but a frontend check
         * alone would be worthless: anyone can POST to this route directly
         * with curl. The decision below is the one that counts.
         *
         * Note what is NOT in this function any more: there is no
         * users.insertOne() anywhere below. Refusing is not a matter of
         * taking an early return past a create -- there is no create left to
         * reach. That is what makes "Google never creates an account" a
         * property of the code rather than a promise about its control flow.
         */
        if (!user) {
            return res.status(404).json({
                success: false,
                code: "NO_ACCOUNT",
                message: "No Buddy Talk account was found for this Google account. Please create an account first."
            });
        }

        if (!user.googleId) {
            /*
             * Existing password account signing in with Google for the first
             * time: link the two so googleId matches directly next time.
             */
            await users.updateOne(
                { _id: user._id },
                { $set: { googleId, lastLoginAt: new Date() } }
            );
            user = { ...user, googleId };
        } else {
            await users.updateOne(
                { _id: user._id },
                { $set: { lastLoginAt: new Date() } }
            );
        }

        // 4. Remember that they are signed in.
        createSession(res, user);

        // 5. Reply. Only safe, public fields -- never the password hash, never
        //    the Google token, never anything from .env.
        return res.status(200).json({
            success: true,
            message: "Signed in with Google.",
            /*
             * Always false: this route only ever signs in an account that
             * already existed. The frontend therefore runs its normal
             * child-profile check, exactly as it does after a password
             * sign-in.
             */
            isNewAccount: false,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        /*
         * The duplicate-key (11000) handler that used to live here has gone
         * with the insert it guarded. This route no longer creates users, so
         * there is no first-time-sign-in race left to lose.
         */
        console.log("Google sign-in failed:", error);

        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   GET /api/auth/me
   Who is signed in? Reads the session cookie and returns that user.
   Useful for checking the cookie actually works, and needed later to keep a
   user signed in across page refreshes.
   ========================================================================== */
app.get("/api/auth/me", async (req, res) => {
    try {
        const token = req.cookies?.session;

        if (!token) {
            return res.status(401).json({ success: false, message: "Not signed in." });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await users.findOne({ _id: new ObjectId(payload.userId) });

        if (!user) {
            return res.status(401).json({ success: false, message: "Not signed in." });
        }

        return res.status(200).json({
            success: true,
            user: { id: user._id, name: user.name, email: user.email }
        });

    } catch {
        // An expired or tampered token lands here.
        return res.status(401).json({ success: false, message: "Not signed in." });
    }
});

/* ==========================================================================
   CHILD PROFILE

   One profile per authenticated user:

       users._id  ->  childProfiles.userId

   The owner is ALWAYS taken from the session cookie, never from the request
   body. If the frontend could supply a userId, anyone could read or overwrite
   another family's profile just by changing a number.
   ========================================================================== */

/*
 * Middleware: identifies the signed-in user from the session cookie and puts
 * them on req.user, or answers 401.
 *
 * Same mechanism as /api/auth/me -- the session is a JWT in an httpOnly
 * cookie, so page JavaScript cannot read or forge it.
 */
async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.session;

        if (!token) {
            return res.status(401).json({ success: false, message: "Please sign in first." });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await users.findOne({ _id: new ObjectId(payload.userId) });

        if (!user) {
            return res.status(401).json({ success: false, message: "Please sign in first." });
        }

        req.user = user;
        next();

    } catch {
        // Expired or tampered token.
        return res.status(401).json({ success: false, message: "Please sign in first." });
    }
}

/* The only values these fields may hold. */
const ALLOWED_GENDERS = ["boy", "girl", "other"];
const ALLOWED_VOICES = ["male", "female"];
const ALLOWED_GRID_SIZES = [2, 3, 4];

/*
 * Validates an incoming profile. Returns { field, message } for the first
 * problem, or null when everything is acceptable.
 */
function validateChildProfile(body) {
    const { childName, gender, voice, gridSize } = body;

    if (typeof childName !== "string" || !childName.trim()) {
        return { field: "childName", message: "Please enter your child's name." };
    }

    if (childName.trim().length > 60) {
        return { field: "childName", message: "That name is too long." };
    }

    if (!ALLOWED_GENDERS.includes(gender)) {
        return { field: "gender", message: "Please choose an option." };
    }

    if (!ALLOWED_VOICES.includes(voice)) {
        return { field: "voice", message: "Please choose a voice." };
    }

    // Accepts 3 or "3" -- a form value arrives as text.
    if (!ALLOWED_GRID_SIZES.includes(Number(gridSize))) {
        return { field: "gridSize", message: "Please choose a grid size." };
    }

    return null;
}

/* ==========================================================================
   GET /api/child-profile
   Returns the signed-in user's child profile, or exists:false if they have
   none yet. The frontend uses this to decide between the setup screen and the
   board.
   ========================================================================== */
app.get("/api/child-profile", requireAuth, async (req, res) => {
    try {
        const profile = await childProfiles.findOne({ userId: req.user._id });

        if (!profile) {
            return res.status(200).json({ success: true, exists: false, profile: null });
        }

        return res.status(200).json({
            success: true,
            exists: true,
            profile: {
                id: profile._id,
                childName: profile.childName,
                gender: profile.gender,
                voice: profile.voice,
                gridSize: profile.gridSize,
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt
            }
        });

    } catch (error) {
        console.log("Fetching child profile failed:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/child-profile
   Creates the profile, or updates it if one already exists.

   A single upsert covers both cases, which is what stops a second profile
   being created when a user edits an existing one. 201 when created, 200 when
   updated, so the caller can tell which happened.
   ========================================================================== */
app.post("/api/child-profile", requireAuth, async (req, res) => {
    try {
        const problem = validateChildProfile(req.body);

        if (problem) {
            return res.status(400).json({ success: false, ...problem });
        }

        const now = new Date();

        const result = await childProfiles.findOneAndUpdate(
            // Matched on the SESSION's user id, never anything from the body.
            { userId: req.user._id },
            {
                $set: {
                    childName: req.body.childName.trim(),
                    gender: req.body.gender,
                    voice: req.body.voice,
                    gridSize: Number(req.body.gridSize),
                    updatedAt: now
                },
                // Only applied when the document is being created.
                $setOnInsert: { userId: req.user._id, createdAt: now }
            },
            { upsert: true, returnDocument: "after", includeResultMetadata: true }
        );

        const profile = result.value;
        const wasCreated = !result.lastErrorObject?.updatedExisting;

        return res.status(wasCreated ? 201 : 200).json({
            success: true,
            created: wasCreated,
            message: wasCreated
                ? "Child profile saved successfully."
                : "Child profile updated successfully.",
            profile: {
                id: profile._id,
                childName: profile.childName,
                gender: profile.gender,
                voice: profile.voice,
                gridSize: profile.gridSize,
                createdAt: profile.createdAt,
                updatedAt: profile.updatedAt
            }
        });

    } catch (error) {
        // Two simultaneous first-time saves racing the unique index.
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "A profile already exists for this account."
            });
        }

        console.log("Saving child profile failed:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
});

/* ==========================================================================
   THE COMMUNICATION BOARD -- FOLDERS AND CARDS

   The ownership chain, which every route below depends on:

       session cookie -> users._id -> childProfiles.userId -> childProfiles._id
                                                                     |
                                            folders.childProfileId <-+
                                              cards.childProfileId <-+

   THE RULE: childProfileId is NEVER read from the request.

   Not from the body, not from the query string, not from the URL. It is
   DERIVED from the session cookie every single time, by looking up the
   profile that belongs to the authenticated user. A caller can send any
   childProfileId they like and it is ignored, because nothing ever reads it.

   That is a stronger guarantee than checking a supplied id against the
   session: a check can be forgotten on one route out of ten, and that one
   route is the vulnerability. Here there is no supplied value to forget to
   check. The same reasoning the existing child-profile routes use -- "the
   owner is ALWAYS taken from the session cookie" -- extended to the board.

   Every query is then additionally scoped by childProfileId, so even a
   correctly-guessed card _id belonging to another family matches nothing.
   ========================================================================== */

/*
 * Middleware: finds the signed-in user's child profile and puts it on
 * req.childProfile.
 *
 * Runs AFTER requireAuth, so req.user is already the authenticated user. This
 * is the single place the user -> profile hop happens; every board route uses
 * it, so none of them can get the association wrong individually.
 *
 * 404 rather than 401 when there is no profile: the caller IS signed in, they
 * simply have not created a child yet. The frontend already sends people to
 * the profile screen in that case.
 */
async function requireChildProfile(req, res, next) {
    try {
        const profile = await childProfiles.findOne({ userId: req.user._id });

        if (!profile) {
            return res.status(404).json({
                success: false,
                code: "NO_CHILD_PROFILE",
                message: "Please create a child profile first."
            });
        }

        req.childProfile = profile;
        next();

    } catch (error) {
        console.log("Loading child profile failed:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again."
        });
    }
}

/*
 * Parses a value that should be a MongoDB ObjectId.
 *
 * Returns null rather than throwing when it is not one. A malformed id in a
 * URL is an ordinary client mistake (or a probe), and `new ObjectId("junk")`
 * throws -- which would otherwise become a 500 and look like a server fault.
 */
function toObjectId(value) {
    if (typeof value !== "string" || !ObjectId.isValid(value)) {
        return null;
    }
    return new ObjectId(value);
}

/* A card's word and a folder's name share these limits. */
const MAX_WORD_LENGTH = 40;
const MAX_FOLDER_NAME_LENGTH = 40;

/*
 * Validates a media reference -- an image or audio URL.
 *
 * Deliberately NOT a full URL parser. Two shapes are allowed:
 *
 *   /cards/food/rice.jpg          a path served by the frontend today
 *   https://bucket/rice.jpg       object storage, once uploads exist
 *
 * Anything else is refused, which is what keeps `javascript:` and `data:`
 * out of a field that will end up in an <img src>. Storing one of those
 * would turn a card into a script-injection vector on the child's board.
 *
 * null is always allowed and means "no media", which is the normal state for
 * a core word and for every card's audio today.
 */
function validateMediaRef(value, field) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== "string" || !value.trim()) {
        return { field, message: `${field} must be a URL, a path, or null.` };
    }

    const trimmed = value.trim();

    if (trimmed.length > 512) {
        return { field, message: `${field} is too long.` };
    }

    // A root-relative path, or an explicit https URL. Nothing else.
    const isPath = trimmed.startsWith("/") && !trimmed.startsWith("//");
    const isHttps = /^https:\/\/[^\s]+$/i.test(trimmed);

    if (!isPath && !isHttps) {
        return { field, message: `${field} must be a root-relative path or an https URL.` };
    }

    return null;
}

/*
 * Shapes a folder document for the browser.
 *
 * An explicit field list, never the raw document. childProfileId is
 * deliberately absent: the client has no use for it, and it is the one value
 * that must never look like something a request may supply.
 */
function publicFolder(folder) {
    return {
        id: folder._id,
        name: folder.name,
        emoji: folder.emoji ?? null,
        colorKey: folder.colorKey ?? null,
        imageUrl: folder.imageUrl ?? null,
        order: folder.order,
        isDefault: Boolean(folder.isDefault),
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt
    };
}

function publicCard(card) {
    return {
        id: card._id,
        word: card.word,
        folderId: card.folderId,
        imageUrl: card.imageUrl ?? null,
        audioUrl: card.audioUrl ?? null,
        emoji: card.emoji ?? null,
        order: card.order,
        isCoreWord: Boolean(card.isCoreWord),
        isDefault: Boolean(card.isDefault),
        createdAt: card.createdAt,
        updatedAt: card.updatedAt
    };
}

/*
 * Works out the `order` value for something appended to the end of a list.
 *
 * Reads the current highest and adds one step, so a new card lands after the
 * existing ones. The gaps ORDER_STEP leaves are what let a future "move left"
 * write a single document instead of renumbering the whole folder.
 */
async function nextOrder(collection, filter) {
    const last = await collection
        .find(filter)
        .sort({ order: -1 })
        .limit(1)
        .toArray();

    if (last.length === 0) {
        return 0;
    }

    return (Number(last[0].order) || 0) + ORDER_STEP;
}

/*
 * Returns the child's board, seeding the default set on first use.
 *
 * Seeding lives here rather than in the child-profile route on purpose: a
 * profile created before this feature existed has no board, and putting the
 * seed at the point of READING means those profiles get one the first time
 * they open the board, with no migration script to remember to run.
 *
 * The duplicate-key catch is what makes it safe under concurrency. Two
 * requests arriving together both see an empty board and both try to seed;
 * the unique (childProfileId, key) index refuses the second, and error 11000
 * is treated as success -- because the outcome we wanted, exactly one board,
 * is what happened.
 */
async function loadOrSeedBoard(childProfileId) {
    const filter = { childProfileId };

    let [folderDocs, cardDocs] = await Promise.all([
        folders.find(filter).sort({ order: 1 }).toArray(),
        cards.find(filter).sort({ order: 1 }).toArray()
    ]);

    if (folderDocs.length === 0 && cardDocs.length === 0) {
        try {
            await seedBoardForChild({ folders, cards }, childProfileId);
        } catch (error) {
            if (error.code !== 11000) {
                throw error;
            }
            // Another request seeded first -- the desired end state either way.
        }

        [folderDocs, cardDocs] = await Promise.all([
            folders.find(filter).sort({ order: 1 }).toArray(),
            cards.find(filter).sort({ order: 1 }).toArray()
        ]);
    }

    return { folderDocs, cardDocs };
}

/* ==========================================================================
   GET /api/card-images
   The pictures a caregiver may choose from when editing a card.

   TEMPORARY, and deliberately shaped so it is easy to replace.

   Today it lists the images shipped with the app, by reading the folder they
   live in. It returns the SAME shape a real gallery will -- a list of
   { url, folder, name } -- so swapping in uploaded images later is a change
   to this one function, not to the picker that consumes it.

   It reads the directory rather than repeating the file names in code: a
   hard-coded list is wrong the moment somebody adds a picture, and this is
   meant to be thrown away, so it should not acquire a second copy of the
   truth on its way out.
   ========================================================================== */

/*
 * CARD_IMAGE_ROOT and toImageUrl are imported from boardData.js rather than
 * repeated here, so the picker and the seeder can never disagree about where
 * the pictures are or how a path is encoded. They did briefly disagree: this
 * route built its URLs unencoded while the seeder encoded them, so a picked
 * "wake up.jpeg" produced a path the browser could not load.
 */

/* Turns "rice" into "Rice", and "ice-cream" into "Ice cream", for a label the
   caregiver reads. Only a display default -- the card keeps its own word. */
function prettyImageName(fileName) {
    const base = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    return base.charAt(0).toUpperCase() + base.slice(1);
}

app.get("/api/card-images", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const images = [];

        let folderNames;
        try {
            folderNames = await fs.readdir(CARD_IMAGE_ROOT, { withFileTypes: true });
        } catch (readError) {
            /*
             * The folder is missing entirely. That is a deployment problem --
             * on a server that hosts only the API, the frontend's public/
             * folder may not be there at all. Report it as "no pictures"
             * rather than a fault: the edit form still works, the caregiver
             * simply has nothing to choose from.
             */
            console.log("Card image folder is not readable:", readError.message);
            return res.status(200).json({ success: true, images: [] });
        }

        for (const entry of folderNames) {
            if (!entry.isDirectory()) continue;

            const folderPath = path.join(CARD_IMAGE_ROOT, entry.name);
            const files = await fs.readdir(folderPath);

            for (const file of files) {
                // Only real picture formats, so a stray .txt or .DS_Store
                // cannot end up offered as a card image.
                if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(file)) continue;

                images.push({
                    /*
                     * The same root-relative form already stored in imageUrl,
                     * so choosing a picture here produces a value the card
                     * routes already accept and the board already renders.
                     *
                     * Built with the SAME encoder the seeder uses, so a
                     * picked path is byte-identical to a seeded one. It must
                     * be percent-encoded: names like "wake up.jpeg" and
                     * "Food & Drink" contain spaces and ampersands, which end
                     * the URL or start a query string when left raw -- the
                     * picture then silently fails to load.
                     */
                    url: toImageUrl(entry.name, file),
                    folder: entry.name,
                    name: prettyImageName(file)
                });
            }
        }

        images.sort((a, b) =>
            a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder.localeCompare(b.folder)
        );

        return res.status(200).json({ success: true, images });

    } catch (error) {
        console.log("Listing card images failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not load the pictures. Please try again."
        });
    }
});

/* ==========================================================================
   UPLOADS

   POST /api/uploads/image
   POST /api/uploads/audio

   Take one file as multipart/form-data and return { url }. The caller then
   PATCHes or POSTs that url into a card's imageUrl / audioUrl, so uploading
   and saving stay separate steps -- a caregiver can pick a picture, see it,
   and still cancel without having changed the card.

   The bytes are written to disk (backend/uploads) and NEVER into MongoDB;
   see uploads.js for why, and for the abstraction that lets this become
   object storage later.
   ========================================================================== */

/* Turns an upload error into a message a caregiver can act on. */
function uploadErrorResponse(error, kind) {
    const limitMb = Math.round(
        (kind === "image" ? uploads.MAX_IMAGE_BYTES : uploads.MAX_AUDIO_BYTES) / (1024 * 1024)
    );

    switch (error.code) {
        case "TOO_LARGE":
            return {
                status: 413,
                message: `That file is too big. Please choose one under ${limitMb}MB.`
            };
        case "UNSUPPORTED_TYPE":
            return {
                status: 415,
                message:
                    kind === "image"
                        ? "That file is not a picture we can use. Please choose a JPG, PNG, WebP or GIF."
                        : "That file is not audio we can use. Please choose an MP3, WAV, M4A or OGG."
            };
        case "NO_FILE":
            return { status: 400, message: "No file was received. Please choose a file." };
        case "NOT_MULTIPART":
            return { status: 400, message: "The upload was malformed. Please try again." };
        default:
            return { status: 500, message: "Could not save that file. Please try again." };
    }
}

function makeUploadRoute(kind) {
    return async (req, res) => {
        try {
            const result = await uploads.handleUpload(req, kind, req.childProfile._id);

            return res.status(201).json({
                success: true,
                url: result.url,
                bytes: result.bytes,
                type: result.type
            });
        } catch (error) {
            const { status, message } = uploadErrorResponse(error, kind);

            if (status === 500) {
                console.log(`Upload (${kind}) failed:`, error);
            }

            return res.status(status).json({ success: false, message });
        }
    };
}

app.post("/api/uploads/image", requireAuth, requireChildProfile, makeUploadRoute("image"));
app.post("/api/uploads/audio", requireAuth, requireChildProfile, makeUploadRoute("audio"));

/* ==========================================================================
   GET /api/board
   The whole board in ONE request: every folder and every card for the
   signed-in user's child.

   One call rather than one per folder because the board is small (33
   documents) and a child tapping into a folder should see it instantly, not
   wait for a network round trip.
   ========================================================================== */
app.get("/api/board", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const { folderDocs, cardDocs } = await loadOrSeedBoard(req.childProfile._id);

        return res.status(200).json({
            success: true,
            childProfileId: req.childProfile._id,
            folders: folderDocs.map(publicFolder),
            cards: cardDocs.map(publicCard)
        });

    } catch (error) {
        console.log("Loading the board failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not load the board. Please try again."
        });
    }
});

/* ==========================================================================
   FOLDERS
   ========================================================================== */

/* GET /api/folders -- this child's folders, in display order. */
app.get("/api/folders", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const { folderDocs } = await loadOrSeedBoard(req.childProfile._id);

        return res.status(200).json({
            success: true,
            folders: folderDocs.map(publicFolder)
        });

    } catch (error) {
        console.log("Loading folders failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not load folders. Please try again."
        });
    }
});

/* POST /api/folders -- create one folder for this child. */
app.post("/api/folders", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const { name, emoji, colorKey, imageUrl } = req.body || {};

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                success: false,
                field: "name",
                message: "Please enter a folder name."
            });
        }

        if (name.trim().length > MAX_FOLDER_NAME_LENGTH) {
            return res.status(400).json({
                success: false,
                field: "name",
                message: `A folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer.`
            });
        }

        const imageProblem = validateMediaRef(imageUrl, "imageUrl");
        if (imageProblem) {
            return res.status(400).json({ success: false, ...imageProblem });
        }

        const now = new Date();
        const childProfileId = req.childProfile._id;

        const doc = {
            childProfileId,
            /*
             * A generated key, so a caregiver's folder can never collide with
             * a default one and the unique index stays meaningful.
             */
            key: `custom-${new ObjectId().toString()}`,
            name: name.trim(),
            emoji: typeof emoji === "string" && emoji.trim() ? emoji.trim() : null,
            colorKey: typeof colorKey === "string" && colorKey.trim() ? colorKey.trim() : null,
            imageUrl: imageUrl ? imageUrl.trim() : null,
            order: await nextOrder(folders, { childProfileId }),
            isDefault: false,
            createdAt: now,
            updatedAt: now
        };

        await folders.insertOne(doc);

        return res.status(201).json({ success: true, folder: publicFolder(doc) });

    } catch (error) {
        console.log("Creating a folder failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not create the folder. Please try again."
        });
    }
});

/*
 * PATCH /api/folders/:id -- rename, re-icon or reorder one folder.
 *
 * The filter carries childProfileId as well as _id, which is the ownership
 * check: another family's folder id simply matches nothing and gets a 404.
 * There is no separate "do you own this?" query that could be omitted.
 */
app.patch("/api/folders/:id", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const folderId = toObjectId(req.params.id);

        if (!folderId) {
            return res.status(404).json({ success: false, message: "Folder not found." });
        }

        const { name, emoji, colorKey, imageUrl, order } = req.body || {};
        const updates = {};

        if (name !== undefined) {
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    field: "name",
                    message: "Please enter a folder name."
                });
            }
            if (name.trim().length > MAX_FOLDER_NAME_LENGTH) {
                return res.status(400).json({
                    success: false,
                    field: "name",
                    message: `A folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer.`
                });
            }
            updates.name = name.trim();
        }

        if (emoji !== undefined) {
            updates.emoji = typeof emoji === "string" && emoji.trim() ? emoji.trim() : null;
        }

        if (colorKey !== undefined) {
            updates.colorKey =
                typeof colorKey === "string" && colorKey.trim() ? colorKey.trim() : null;
        }

        if (imageUrl !== undefined) {
            const imageProblem = validateMediaRef(imageUrl, "imageUrl");
            if (imageProblem) {
                return res.status(400).json({ success: false, ...imageProblem });
            }
            updates.imageUrl = imageUrl ? imageUrl.trim() : null;
        }

        /* Reordering: the caller supplies the new position outright. This is
           what a future "move up" button writes -- one field, one document. */
        if (order !== undefined) {
            if (!Number.isFinite(Number(order))) {
                return res.status(400).json({
                    success: false,
                    field: "order",
                    message: "order must be a number."
                });
            }
            updates.order = Number(order);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "Nothing to update."
            });
        }

        updates.updatedAt = new Date();

        const result = await folders.findOneAndUpdate(
            // Scoped to THIS child -- the ownership check.
            { _id: folderId, childProfileId: req.childProfile._id },
            { $set: updates },
            { returnDocument: "after" }
        );

        if (!result) {
            return res.status(404).json({ success: false, message: "Folder not found." });
        }

        return res.status(200).json({ success: true, folder: publicFolder(result) });

    } catch (error) {
        console.log("Updating a folder failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not update the folder. Please try again."
        });
    }
});

/*
 * DELETE /api/folders/:id
 *
 * The cards inside it are NOT deleted. They are moved to the core-word area
 * (folderId: null) instead, because a caregiver deleting a folder is tidying
 * their categories, not asking to destroy twenty words a child relies on.
 * Deleting a card is its own explicit action.
 */
app.delete("/api/folders/:id", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const folderId = toObjectId(req.params.id);

        if (!folderId) {
            return res.status(404).json({ success: false, message: "Folder not found." });
        }

        const childProfileId = req.childProfile._id;

        /*
         * The cards inside are read BEFORE anything is removed: once the
         * folder is gone they could not be found by folderId, and their
         * uploaded media could not be tidied up.
         */
        const inside = await cards.find({ childProfileId, folderId }).toArray();

        /*
         * PROTECTED WORDS.
         *
         * A folder holding one of the five quick-access core words cannot be
         * deleted, because doing so would delete that word -- the same
         * protection as the card route, applied to the route that could
         * otherwise route around it.
         */
        const protectedCards = inside.filter((c) => c.isCoreWord);

        if (protectedCards.length > 0) {
            return res.status(409).json({
                success: false,
                code: "PROTECTED_CORE_WORD",
                message:
                    `This folder contains main core words (${protectedCards
                        .map((c) => c.word)
                        .join(", ")}) which cannot be deleted.`
            });
        }

        const deleted = await folders.findOneAndDelete({ _id: folderId, childProfileId });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Folder not found." });
        }

        /*
         * The cards inside are DELETED, not orphaned.
         *
         * They used to be moved to folderId: null. That looked kinder but was
         * worse: the board groups every card by its folder, so a card with no
         * folder is invisible -- it survived in the database while vanishing
         * from the screen, which is the least honest of the options. Deleting
         * the folder now means what it says, and the confirmation dialog
         * states the card count before anything happens.
         *
         * Scoped to childProfileId as well as folderId, so it can only ever
         * touch this child's cards.
         */
        const removed = await cards.deleteMany({ childProfileId, folderId });

        /*
         * Tidy up uploaded media belonging to the deleted folder and its
         * cards -- but only files nothing that REMAINS still references.
         * Built-in /cards/... media is never touched.
         */
        const [otherCards, otherFolders] = await Promise.all([
            cards.find({ childProfileId }).project({ imageUrl: 1, audioUrl: 1 }).toArray(),
            folders.find({ childProfileId }).project({ imageUrl: 1 }).toArray()
        ]);

        const stillReferenced = new Set();
        for (const c of otherCards) {
            if (c.imageUrl) stillReferenced.add(c.imageUrl);
            if (c.audioUrl) stillReferenced.add(c.audioUrl);
        }
        for (const f of otherFolders) {
            if (f.imageUrl) stillReferenced.add(f.imageUrl);
        }

        /* The folder's own tile picture is cleaned up alongside its cards. */
        const filesRemoved = await uploads.deleteMediaForCards(
            [...inside, { imageUrl: deleted.imageUrl, audioUrl: null }],
            childProfileId,
            stillReferenced
        );

        return res.status(200).json({
            success: true,
            message: "Folder deleted.",
            cardsDeleted: removed.deletedCount,
            filesRemoved
        });

    } catch (error) {
        console.log("Deleting a folder failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not delete the folder. Please try again."
        });
    }
});

/* ==========================================================================
   CARDS
   ========================================================================== */

/* GET /api/cards -- every card for this child, in order. */
app.get("/api/cards", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const { cardDocs } = await loadOrSeedBoard(req.childProfile._id);

        return res.status(200).json({
            success: true,
            cards: cardDocs.map(publicCard)
        });

    } catch (error) {
        console.log("Loading cards failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not load cards. Please try again."
        });
    }
});

/*
 * GET /api/folders/:folderId/cards -- the cards inside one folder.
 *
 * `core` is accepted as the folderId to mean "the cards in no folder", since
 * a URL cannot carry null. That is the eight core words.
 */
app.get("/api/folders/:folderId/cards", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const childProfileId = req.childProfile._id;
        const raw = req.params.folderId;

        let folderId;

        if (raw === "core") {
            folderId = null;
        } else {
            folderId = toObjectId(raw);
            if (!folderId) {
                return res.status(404).json({ success: false, message: "Folder not found." });
            }

            /* Confirm the folder is this child's before returning anything
               from it, so an unknown id cannot be probed for existence. */
            const folder = await folders.findOne({ _id: folderId, childProfileId });
            if (!folder) {
                return res.status(404).json({ success: false, message: "Folder not found." });
            }
        }

        const cardDocs = await cards
            .find({ childProfileId, folderId })
            .sort({ order: 1 })
            .toArray();

        return res.status(200).json({
            success: true,
            cards: cardDocs.map(publicCard)
        });

    } catch (error) {
        console.log("Loading folder cards failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not load cards. Please try again."
        });
    }
});

/* POST /api/cards -- add one card, optionally inside a folder. */
app.post("/api/cards", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const { word, folderId, imageUrl, audioUrl, emoji } = req.body || {};
        const childProfileId = req.childProfile._id;

        if (typeof word !== "string" || !word.trim()) {
            return res.status(400).json({
                success: false,
                field: "word",
                message: "Please enter a word."
            });
        }

        if (word.trim().length > MAX_WORD_LENGTH) {
            return res.status(400).json({
                success: false,
                field: "word",
                message: `A word must be ${MAX_WORD_LENGTH} characters or fewer.`
            });
        }

        const imageProblem = validateMediaRef(imageUrl, "imageUrl");
        if (imageProblem) {
            return res.status(400).json({ success: false, ...imageProblem });
        }

        const audioProblem = validateMediaRef(audioUrl, "audioUrl");
        if (audioProblem) {
            return res.status(400).json({ success: false, ...audioProblem });
        }

        /*
         * A card may be placed in a folder, or left in the core-word area.
         * When a folder IS named it must belong to this child -- otherwise a
         * caller could file a card into another family's folder, which would
         * make it visible on their board.
         */
        let targetFolderId = null;

        if (folderId !== undefined && folderId !== null) {
            targetFolderId = toObjectId(folderId);
            if (!targetFolderId) {
                return res.status(400).json({
                    success: false,
                    field: "folderId",
                    message: "That folder does not exist."
                });
            }

            const folder = await folders.findOne({ _id: targetFolderId, childProfileId });
            if (!folder) {
                return res.status(404).json({
                    success: false,
                    field: "folderId",
                    message: "That folder does not exist."
                });
            }
        }

        const now = new Date();

        const doc = {
            childProfileId,
            key: `custom-${new ObjectId().toString()}`,
            word: word.trim(),
            folderId: targetFolderId,
            imageUrl: imageUrl ? imageUrl.trim() : null,
            audioUrl: audioUrl ? audioUrl.trim() : null,
            emoji: typeof emoji === "string" && emoji.trim() ? emoji.trim() : null,
            order: await nextOrder(cards, { childProfileId, folderId: targetFolderId }),
            /* A caregiver's card is never a core word today. Core words are
               the seeded eight; changing that is a later feature. */
            isCoreWord: false,
            isDefault: false,
            createdAt: now,
            updatedAt: now
        };

        await cards.insertOne(doc);

        return res.status(201).json({ success: true, card: publicCard(doc) });

    } catch (error) {
        console.log("Creating a card failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not create the card. Please try again."
        });
    }
});

/*
 * PATCH /api/cards/:id
 *
 * Covers everything Edit Words will need: change the word, replace the image
 * or audio reference, MOVE the card to another folder, or reorder it. All of
 * it without changing the card's _id, so a card keeps its identity.
 */
app.patch("/api/cards/:id", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const cardId = toObjectId(req.params.id);

        if (!cardId) {
            return res.status(404).json({ success: false, message: "Card not found." });
        }

        const childProfileId = req.childProfile._id;
        const { word, folderId, imageUrl, audioUrl, emoji, order } = req.body || {};
        const updates = {};

        if (word !== undefined) {
            if (typeof word !== "string" || !word.trim()) {
                return res.status(400).json({
                    success: false,
                    field: "word",
                    message: "Please enter a word."
                });
            }
            if (word.trim().length > MAX_WORD_LENGTH) {
                return res.status(400).json({
                    success: false,
                    field: "word",
                    message: `A word must be ${MAX_WORD_LENGTH} characters or fewer.`
                });
            }
            updates.word = word.trim();
        }

        if (imageUrl !== undefined) {
            const problem = validateMediaRef(imageUrl, "imageUrl");
            if (problem) {
                return res.status(400).json({ success: false, ...problem });
            }
            updates.imageUrl = imageUrl ? imageUrl.trim() : null;
        }

        if (audioUrl !== undefined) {
            const problem = validateMediaRef(audioUrl, "audioUrl");
            if (problem) {
                return res.status(400).json({ success: false, ...problem });
            }
            updates.audioUrl = audioUrl ? audioUrl.trim() : null;
        }

        if (emoji !== undefined) {
            updates.emoji = typeof emoji === "string" && emoji.trim() ? emoji.trim() : null;
        }

        if (order !== undefined) {
            if (!Number.isFinite(Number(order))) {
                return res.status(400).json({
                    success: false,
                    field: "order",
                    message: "order must be a number."
                });
            }
            updates.order = Number(order);
        }

        /* MOVING BETWEEN FOLDERS. null moves the card to the core-word area;
           any other value must be a folder belonging to THIS child. */
        if (folderId !== undefined) {
            if (folderId === null) {
                updates.folderId = null;
            } else {
                const targetFolderId = toObjectId(folderId);
                if (!targetFolderId) {
                    return res.status(400).json({
                        success: false,
                        field: "folderId",
                        message: "That folder does not exist."
                    });
                }

                const folder = await folders.findOne({ _id: targetFolderId, childProfileId });
                if (!folder) {
                    return res.status(404).json({
                        success: false,
                        field: "folderId",
                        message: "That folder does not exist."
                    });
                }

                updates.folderId = targetFolderId;
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: "Nothing to update." });
        }

        updates.updatedAt = new Date();

        const result = await cards.findOneAndUpdate(
            { _id: cardId, childProfileId },
            { $set: updates },
            { returnDocument: "after" }
        );

        if (!result) {
            return res.status(404).json({ success: false, message: "Card not found." });
        }

        return res.status(200).json({ success: true, card: publicCard(result) });

    } catch (error) {
        console.log("Updating a card failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not update the card. Please try again."
        });
    }
});

/* DELETE /api/cards/:id */
app.delete("/api/cards/:id", requireAuth, requireChildProfile, async (req, res) => {
    try {
        const cardId = toObjectId(req.params.id);

        if (!cardId) {
            return res.status(404).json({ success: false, message: "Card not found." });
        }

        const childProfileId = req.childProfile._id;

        /*
         * PROTECTED WORDS.
         *
         * The five quick-access core words are the backbone of a sentence --
         * without "I" or "want" a child cannot build most of what they need
         * to say, and there is currently no way to put one back. Refusing
         * here, on the SERVER, is what makes the protection real: the UI also
         * hides the control, but a UI check alone could be bypassed with
         * curl.
         *
         * Read before deleting so the card is still there to inspect.
         */
        const card = await cards.findOne({ _id: cardId, childProfileId });

        if (!card) {
            return res.status(404).json({ success: false, message: "Card not found." });
        }

        if (card.isCoreWord) {
            return res.status(409).json({
                success: false,
                code: "PROTECTED_CORE_WORD",
                message: `"${card.word}" is a main core word and cannot be deleted.`
            });
        }

        const deleted = await cards.findOneAndDelete({ _id: cardId, childProfileId });

        if (!deleted) {
            return res.status(404).json({ success: false, message: "Card not found." });
        }

        /*
         * Tidy up the card's uploaded picture and sound -- but only if no
         * OTHER card or folder still points at the same file. Two cards may
         * legitimately share one uploaded photograph.
         *
         * Built-in media is untouchable here: deleteMediaForCards only acts on
         * /uploads/ paths, and a shipped picture is /cards/..., so
         * frontend/public/cards can never be reached.
         */
        const [otherCards, allFolders] = await Promise.all([
            cards.find({ childProfileId }).project({ imageUrl: 1, audioUrl: 1 }).toArray(),
            folders.find({ childProfileId }).project({ imageUrl: 1 }).toArray()
        ]);

        const stillReferenced = new Set();
        for (const c of otherCards) {
            if (c.imageUrl) stillReferenced.add(c.imageUrl);
            if (c.audioUrl) stillReferenced.add(c.audioUrl);
        }
        for (const f of allFolders) {
            if (f.imageUrl) stillReferenced.add(f.imageUrl);
        }

        const filesRemoved = await uploads.deleteMediaForCards(
            [deleted],
            childProfileId,
            stillReferenced
        );

        return res.status(200).json({ success: true, message: "Card deleted.", filesRemoved });

    } catch (error) {
        console.log("Deleting a card failed:", error);
        return res.status(500).json({
            success: false,
            message: "Could not delete the card. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/tts
   Turns a word or short sentence into spoken audio.

   The browser sends { text, voice } where voice is "male" or "female" -- the
   same two values the child profile already stores -- and gets MP3 bytes
   back.

   The frontend never sees a Google credential, a project id or even a Google
   voice name: it names one of two preferences and receives audio. All
   authentication happens here, from the environment.

   Deliberately NOT behind requireAuth for now: this first version is for
   verifying the Google integration works, and the test commands need to run
   without a session cookie. Add requireAuth when it is wired to the board.
   ========================================================================== */
app.post("/api/tts", async (req, res) => {
    try {
        /*
         * 1. Validate the input FIRST. A malformed request is a client error
         * whatever the server's configuration happens to be.
         */
        const { text, voice } = req.body || {};

        if (typeof text !== "string" || !text.trim()) {
            return res.status(400).json({
                success: false,
                field: "text",
                message: "Please provide some text to speak."
            });
        }

        if (text.trim().length > tts.MAX_TEXT_LENGTH) {
            return res.status(400).json({
                success: false,
                field: "text",
                message: `Text must be ${tts.MAX_TEXT_LENGTH} characters or fewer.`
            });
        }

        if (!tts.ALLOWED_VOICES.includes(voice)) {
            return res.status(400).json({
                success: false,
                field: "voice",
                message: `Voice must be one of: ${tts.ALLOWED_VOICES.join(", ")}.`
            });
        }

        // 2. Only then, check this server can actually reach Google.
        if (!tts.isConfigured()) {
            console.log(
                "Text-to-speech is not configured: set GOOGLE_APPLICATION_CREDENTIALS " +
                "in backend/.env to the path of your service-account JSON file."
            );
            return res.status(503).json({
                success: false,
                message: "Speech service is not configured on the server yet."
            });
        }

        // 3. Synthesize and return the audio itself, not a JSON wrapper.
        const audio = await tts.synthesize(text.trim(), voice);

        res.set({
            "Content-Type": "audio/mpeg",
            "Content-Length": audio.length,
            /*
             * No caching yet, by design -- this first version proves the
             * integration works. Caching comes later.
             */
            "Cache-Control": "no-store"
        });

        return res.status(200).send(audio);

    } catch (error) {
        /*
         * The real reason goes to the server log, where the developer can
         * see it. The client gets a plain message: a Google error can carry
         * a project id or key path, and none of that belongs in a response.
         */
        console.log("Text-to-speech failed:", error.message);

        return res.status(502).json({
            success: false,
            message: "Could not generate speech just now. Please try again."
        });
    }
});

/* ==========================================================================
   POST /api/auth/logout
   Clears the session cookie.
   ========================================================================== */
app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("session", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    });
    return res.status(200).json({ success: true, message: "Signed out." });
});

connectDB();
