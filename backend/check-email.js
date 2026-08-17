/*
 * check-email.js
 * --------------
 * Diagnoses password-reset email configuration, and optionally sends a real
 * test message. Run it any time email is not arriving:
 *
 *     node check-email.js                  # check the configuration only
 *     node check-email.js you@example.com  # ...and send a test email there
 *
 * It never prints SMTP_PASS or any other secret -- only the SHAPE of the
 * value (length and character types), which is enough to spot the usual
 * mistakes without revealing anything.
 */

require("dotenv").config();
const nodemailer = require("nodemailer");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const ok = (msg) => console.log(`  ${GREEN}OK${RESET}    ${msg}`);
const bad = (msg) => console.log(`  ${RED}FAIL${RESET}  ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}WARN${RESET}  ${msg}`);
const hint = (msg) => console.log(`        ${DIM}${msg}${RESET}`);

console.log("\nBuddy Talk -- password reset email check\n");

/* ---------- 1. Are the variables present? ---------- */
console.log("1. Environment variables (from backend/.env)");

const host = process.env.SMTP_HOST;
const port = process.env.SMTP_PORT;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

let blocked = false;

if (host) ok(`SMTP_HOST = ${host}`);
else { bad("SMTP_HOST is missing"); blocked = true; }

if (port) ok(`SMTP_PORT = ${port}`);
else warn("SMTP_PORT is missing (will default to 587)");

if (user) ok(`SMTP_USER = ${user.replace(/^(.{2}).*(@.*)$/, "$1****$2")}`);
else { bad("SMTP_USER is missing"); blocked = true; }

if (!pass) {
    bad("SMTP_PASS is missing");
    blocked = true;
} else {
    /*
     * Only the SHAPE is examined, never the value.
     *
     * A Gmail App Password is 16 lowercase letters. Google DISPLAYS it in four
     * groups ("abcd efgh ijkl mnop"), and Gmail accepts it either way -- so
     * spaces are stripped before checking rather than treated as a mistake.
     */
    const compact = pass.replace(/\s/g, "");
    const looksLikeAppPassword = compact.length === 16 && /^[a-z]+$/.test(compact);

    if (looksLikeAppPassword) {
        ok("SMTP_PASS looks like a Gmail App Password (16 lowercase letters)");
        if (/\s/.test(pass)) {
            hint("it contains spaces -- harmless, Gmail accepts them, but removing");
            hint("them is tidier");
        }
    } else {
        bad(`SMTP_PASS does not look like a Gmail App Password [value withheld]`);
        hint(`${compact.length} characters once spaces are removed (expected 16)`);
        if (/[0-9]/.test(compact)) hint("contains digits -- App Passwords are letters only");
        if (/[^A-Za-z0-9]/.test(compact)) hint("contains symbols -- App Passwords are letters only");
        if (/^["']/.test(pass)) hint("wrapped in quotes -- remove them");
        hint("");
        hint("A Gmail App Password is NOT your account password. It is a separate");
        hint("16-letter credential, and changing your Gmail password does not change it.");
        hint("Create one at: https://myaccount.google.com/apppasswords");
        hint("(2-Step Verification must be switched on first.)");
        hint("");
        hint("Note: the authentication check below is the real test -- if Gmail");
        hint("accepts the value, it works regardless of this warning.");
    }
}

if (blocked) {
    console.log(`\n${YELLOW}Email is not configured.${RESET} Reset links will be printed to the`);
    console.log("backend terminal instead, which is fine for local development.\n");
    process.exit(1);
}

/* ---------- 2. Will Gmail accept them? ---------- */
console.log("\n2. Authenticating with the mail server");

const transport = nodemailer.createTransport({
    host,
    port: Number(port) || 587,
    secure: Number(port) === 465,
    auth: { user, pass }
});

transport
    .verify()
    .then(async () => {
        ok("the mail server accepted these credentials");

        const recipient = process.argv[2];

        if (!recipient) {
            console.log(`\n${GREEN}Configuration is working.${RESET}`);
            console.log(`${DIM}Run "node check-email.js you@example.com" to send a real test email.${RESET}\n`);
            return;
        }

        console.log("\n3. Sending a test email");
        try {
            const info = await transport.sendMail({
                from: process.env.MAIL_FROM || `"Buddy Talk" <${user}>`,
                to: recipient,
                subject: "Buddy Talk test email",
                text: "If you are reading this, Buddy Talk can send password reset emails."
            });
            ok(`sent to ${recipient} (id ${info.messageId})`);
            console.log(`\n${GREEN}Everything works.${RESET} Check the inbox -- and the Spam folder.\n`);
        } catch (sendError) {
            bad(`could not send: ${sendError.message}`);
            console.log();
        }
    })
    .catch((error) => {
        bad(`the mail server rejected these credentials`);
        hint(`code ${error.code} / response ${error.responseCode}`);
        console.log();
        console.log(`  ${DIM}${String(error.response || error.message).split("\n").join(`\n  `)}${RESET}`);

        if (error.responseCode === 534 || /application-specific/i.test(error.response || "")) {
            console.log(`\n  ${YELLOW}Gmail is saying: this is not an App Password.${RESET}`);
            hint("Your normal Gmail password will NEVER work here, no matter how many");
            hint("times it is changed. Generate a 16-letter App Password instead:");
            hint("  https://myaccount.google.com/apppasswords");
        } else if (error.responseCode === 535) {
            console.log(`\n  ${YELLOW}Gmail rejected the username or password.${RESET}`);
            hint("Check SMTP_USER is the full address, and that SMTP_PASS is a");
            hint("16-letter App Password pasted without spaces.");
        }
        console.log();
    });
