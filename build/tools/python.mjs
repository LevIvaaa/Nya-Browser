// Runs one of the Python checks with whichever interpreter this machine calls
// Python, and with UTF-8 forced: the tools print Bengali and Khmer language
// names, and a Windows console in code page 866 turns that into a crash rather
// than a check result.
//
//   node build/tools/python.mjs check-locales.py [args...]

import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const [script, ...args] = process.argv.slice(2)
if (!script) {
  console.error('usage: node build/tools/python.mjs <script.py> [args...]')
  process.exit(2)
}

const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
// python3 first: on Linux and macOS "python" is often absent or ancient. The
// Windows Store stub answers with exit code 9009 and no output, which is what
// the fallback is for.
for (const exe of ['python3', 'python']) {
  const run = spawnSync(exe, [join(here, script), ...args], { stdio: 'inherit', env })
  if (run.error?.code === 'ENOENT' || run.status === 9009) continue
  process.exit(run.status ?? 1)
}

console.error('no Python found: install python3 to run the language checks')
process.exit(2)
