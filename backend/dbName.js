/*
 * dbName.js
 * ---------
 * SAFETY FIX (M-1): which MongoDB database the app (and the maintenance
 * scripts) use is now chosen by the MONGODB_DB environment variable.
 *
 * WHY THIS EXISTS
 * ---------------
 * The database name used to be typed directly into the code
 * (client.db("BuddyTalk")). Changing MONGODB_URI -- the obvious thing to do
 * when you want to "test against a different database" -- did NOT change it,
 * so a test run quietly used the real data, and reseedBoard.js --all could
 * have wiped real families' boards.
 *
 * There is deliberately NO default value. A default would be exactly the
 * silent "real database by accident" this file exists to prevent: if the
 * variable is missing, the program stops and says what to set.
 */

const readline = require("readline");

/*
 * Returns the database name from MONGODB_DB, or stops the program with a
 * clear message if it is not set. `who` only makes the message friendlier
 * ("the server", "reseedBoard.js", ...).
 */
function requireDbName(who) {
    const name = String(process.env.MONGODB_DB || "").trim();

    if (!name) {
        console.error(
            `\n${who} refuses to start: the MONGODB_DB environment variable is not set.\n\n` +
                "  It names the MongoDB database to use. Add this line to backend/.env\n" +
                "  (and to your hosting dashboard's environment variables):\n\n" +
                "      MONGODB_DB=BuddyTalk\n\n" +
                "  Use a DIFFERENT name (for example BuddyTalk_TEST) when testing, so real data is never touched.\n"
        );
        process.exit(1);
    }

    return name;
}

/*
 * Makes the person type the database name before something destructive
 * happens. Returns true only when what they typed is exactly the name.
 *
 * It refuses outright when there is no real person at a keyboard (for example
 * the command is piped or run by a scheduler), because a confirmation nobody
 * can see is not a confirmation.
 *
 * `io` exists only so this can be tested without a real terminal.
 */
async function confirmDatabaseName(dbName, summary, io = {}) {
    const input = io.input || process.stdin;
    const output = io.output || process.stdout;
    const interactive = io.isTTY !== undefined ? io.isTTY : Boolean(process.stdin.isTTY);

    if (!interactive) {
        console.error(
            "Refusing to delete anything: this needs an interactive terminal where you can type the " +
                "database name to confirm, and none is available. Nothing was changed."
        );
        return false;
    }

    const rl = readline.createInterface({ input, output });

    const answer = await new Promise((resolve) => {
        rl.question(
            `\n${summary}\n\nTo continue, type the database name (${dbName}) exactly. Anything else cancels: `,
            resolve
        );
    });

    rl.close();

    return String(answer).trim() === dbName;
}

module.exports = { requireDbName, confirmDatabaseName };
