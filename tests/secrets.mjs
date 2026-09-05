// Nothing that unlocks an account may be in the repository — run with `npm test`.
//
// The release token lives in a git-ignored folder beside the working tree and
// reaches the tools only through GH_TOKEN. An ignore rule is a promise, not a
// guarantee: `git add -f`, a rename that dodges the pattern, or a token pasted
// into a script all slip past it. So this asks git what it is actually
// tracking, and reads it.

import { execFileSync } from 'child_process'
import { readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) passed++
  else failures.push({ name, detail })
}

const tracked = git('ls-files', '-z').split('\0').filter(Boolean)

/* --------------------------------------------------------- names on disk */

// The folder the token lives in is Russian for "do not commit and do not push".
const SECRET_PATHS = [
  /(^|\/)не комить и не пуш(\/|$)/,
  /\.(token|pem|pfx|p12|key)$/i,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.git-credentials$/,
  /cred-helper/i,
  /personal[ _-]?token/i
]

const named = tracked.filter((file) => SECRET_PATHS.some((re) => re.test(file)))
check('no secret-looking file is tracked', named.length === 0, named.join(', '))

/* ------------------------------------------------------ contents on disk */

// A GitHub token, an AWS key, a private key header, a bearer in a URL. Written
// in pieces so this file does not trip its own search.
const SECRET_TEXT = [
  ['a GitHub token', new RegExp('gh[pousr]_[A-Za-z0-9]{16,}')],
  ['a fine-grained GitHub token', new RegExp('github' + '_pat_[A-Za-z0-9_]{20,}')],
  ['an AWS access key', new RegExp('AKIA[0-9A-Z]{16}')],
  ['a private key', new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----')],
  ['a password in a URL', new RegExp('https?://[^\\s/@]+:[^\\s/@]{6,}@')]
]

// Only files a token could plausibly hide in, and only ones small enough to be
// hand-written: bitmaps and lockfiles are megabytes of noise.
const READABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|nsh|nsi|py|ps1|sh|yml|yaml|md|html|css|txt|ini|cfg)$/i

const leaks = []
for (const file of tracked) {
  if (!READABLE.test(file) || file.endsWith('tests/secrets.mjs')) continue
  const full = join(root, file)
  let text
  try {
    if (statSync(full).size > 2 * 1024 * 1024) continue
    text = readFileSync(full, 'utf8')
  } catch {
    continue
  }
  for (const [what, re] of SECRET_TEXT) {
    if (re.test(text)) leaks.push(`${file}: ${what}`)
  }
}
check('no tracked file carries a credential', leaks.length === 0, leaks.slice(0, 5).join('; '))

/* ------------------------------------------------- the ignore rules hold */

const ignored = (path) => {
  try {
    git('check-ignore', '-q', path)
    return true
  } catch {
    return false
  }
}

for (const path of ['не комить и не пуш/claude personal token.txt', '.env', 'secret.token']) {
  check(`${path} is ignored`, ignored(path))
}

/* -------------------------------------------------- and nothing is staged */

const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean)
const stagedSecrets = staged.filter((file) => SECRET_PATHS.some((re) => re.test(file)))
check('nothing secret is waiting in the index', stagedSecrets.length === 0, stagedSecrets.join(', '))

for (const { name, detail } of failures) {
  console.log(`FAIL ${name}${detail ? '  — ' + detail : ''}`)
}
console.log(`${passed} passed, ${failures.length} failed`)
process.exit(failures.length === 0 ? 0 : 1)
