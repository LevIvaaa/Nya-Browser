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

/**
 * Runs a command, reporting failure rather than throwing. stdin is closed on
 * purpose: EVS asks for an account name when none is configured, and a build
 * must fail fast there instead of waiting forever on a prompt nobody sees.
 */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })
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
    // Being asked for an account name means there is no EVS account yet; any
    // other failure is usually an expired session.
    const noAccount = /Account Name|EOFError|not logged in/i.test(signed.message)
    console.log(
      '\n  VMP signing failed. The build itself is fine; DRM playback may not be.\n' +
        `  ${signed.message.trim().split('\n').slice(-3).join('\n  ')}\n\n` +
        (noAccount
          ? '  There is no EVS account on this machine yet. Creating one is free,\n' +
            '  but only you can: a confirmation code goes to your email.\n' +
            '      python -m castlabs_evs.account signup\n'
          : '  The EVS session has probably expired:\n' +
            '      python -m castlabs_evs.account reauth\n') +
        '  Details in docs/widevine.md\n'
    )
    return
  }
  console.log('  VMP signature applied')
}
