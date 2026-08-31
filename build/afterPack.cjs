// VMP signing for the Widevine build.
//
// The castlabs Electron fork plays DRM content, but licence servers for most
// commercial services additionally require the packaged app to carry a VMP
// signature from castlabs' EVS service. Signing is a build step, and it needs an
// account that only a human can create — so this hook signs when EVS is set up
// and says exactly what to do when it is not, rather than failing the build.
//
// Setup, once per machine:
//   pip install --upgrade castlabs-evs
//   python -m castlabs_evs.account signup     (or: account reauth)
//
// See docs/widevine.md.

const { execFileSync } = require('child_process')

/** Runs a command, returning null when it is simply not installed. */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
  } catch (error) {
    return { failed: true, message: String(error.stderr || error.stdout || error.message) }
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32' && context.electronPlatformName !== 'darwin') return

  const python = process.platform === 'win32' ? 'python' : 'python3'
  const probe = run(python, ['-m', 'castlabs_evs.vmp', '--help'])
  if (probe && probe.failed) {
    console.log(
      '\n  VMP signing skipped: castlabs-evs is not installed.\n' +
        '  Widevine will still initialise, but services that require a VMP\n' +
        '  signature (Netflix among them) may refuse to play.\n' +
        '  To enable it:  pip install --upgrade castlabs-evs\n' +
        '                 python -m castlabs_evs.account signup\n' +
        '  Details in docs/widevine.md\n'
    )
    return
  }

  console.log(`  signing for Widevine (VMP): ${context.appOutDir}`)
  const signed = run(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir])
  if (signed && signed.failed) {
    console.log(
      '\n  VMP signing failed. The build is otherwise fine; DRM playback may not be.\n' +
        `  ${signed.message.trim().split('\n').slice(-3).join('\n  ')}\n` +
        '  Most often this means the EVS account needs a refresh:\n' +
        '                 python -m castlabs_evs.account reauth\n'
    )
    return
  }
  console.log('  VMP signature applied')
}
