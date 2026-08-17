require("dotenv").config();

const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
/* Google Cloud Text-to-Speech, kept in its own module -- see tts.js. */
const tts = require("./tts");

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

    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    // The response differs per origin, so caches must not mix them up.
    res.header("Vary", "Origin");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.json());

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

        console.log("Unique indexes on email, googleId and childProfiles.userId are ready");

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
