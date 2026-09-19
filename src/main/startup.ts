// ---------------------------------------------------------------------------
// Two facts about this run, decided by the command line and fixed for good.
//
// They live in a file of their own because everything needs to read them — the
// window, the switches applied before Electron is ready, the menu — and a flag
// that several modules ask about should not be a reason for any of them to
// import each other.
// ---------------------------------------------------------------------------

/**
 * A run with everything switched off.
 *
 * When a browser will not start, or starts and draws nothing, the useful
 * question is which of the things it does at startup is at fault. Safe start
 * answers it by doing none of them: no extensions, no GPU, no filter lists, no
 * restored session. Nothing on disk changes — the flag lives for one run, and
 * starting normally afterwards puts everything back.
 */
export const safeStart = process.argv.includes('--safe') || process.argv.includes('--safe-mode')

/**
 * The window that is already there.
 *
 * Quick start puts the browser in the list of things the system runs at login
 * with a flag that says to stay out of the way: the process is up and the
 * window is built and hidden, so the first time somebody actually asks for a
 * browser it is already painted. The cost is one idle window's worth of
 * memory, and the setting is what decides whether that is a fair trade.
 */
export const startedHidden = process.argv.includes('--quick-start')
