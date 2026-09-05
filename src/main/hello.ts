// ---------------------------------------------------------------------------
// Windows Hello — the PIN, the fingerprint or the face the machine already
// knows, used to unlock the password vault.
//
// There is no Electron API for this and no native module here on purpose: a
// native module would have to be rebuilt for every Electron ABI, signed, and
// shipped, which is a lot of moving parts for one dialog. Windows exposes
// UserConsentVerifier through WinRT, and Windows PowerShell can reach WinRT, so
// that is the path: one short script, run out of process, that returns a word.
//
// WebAuthn was the other candidate and does not fit. Chromium reports a
// platform authenticator here, but WebAuthn only answers on a secure origin
// with a registrable domain as its relying party — and the browser's own UI is
// a file:// page belonging to no domain at all.
// ---------------------------------------------------------------------------

import { execFile } from 'child_process'
import { log } from './log'

/** What the prompt is allowed to take before we stop waiting for an answer. */
const TIMEOUT_MS = 90_000

/**
 * The script, as one line per statement. Passed base64-encoded so nothing in it
 * has to survive a shell's idea of quoting.
 *
 * `$Mode` is 'check' for "does this machine have Hello set up" and 'verify' for
 * the prompt itself.
 */
const SCRIPT = (mode: 'check' | 'verify', message: string) =>
  [
    `$ErrorActionPreference = 'Stop'`,
    // AsTask lives in this assembly and Windows PowerShell does not load it.
    `Add-Type -AssemblyName System.Runtime.WindowsRuntime`,
    `try {`,
    `  [void][Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]`,
    `} catch { Write-Output 'UNAVAILABLE'; exit 0 }`,
    `$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {`,
    `  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and`,
    `  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1)`,
    `function Await($op, $type) {`,
    `  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))`,
    `  $task.Wait(-1) | Out-Null`,
    `  $task.Result }`,
    `$availability = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])`,
    `if ($availability -ne 'Available') { Write-Output "UNAVAILABLE $availability"; exit 0 }`,
    mode === 'check'
      ? `Write-Output 'AVAILABLE'`
      : [
          `$result = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync(${psString(message)})) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])`,
          `Write-Output "RESULT $result"`
        ].join('\n')
  ].join('\n')

/** A PowerShell single-quoted string: only the quote itself needs escaping. */
function psString(value: string): string {
  return `'${value.replace(/'/g, "''").replace(/[\r\n]+/g, ' ').slice(0, 120)}'`
}

function run(script: string, timeout: number): Promise<string> {
  // -EncodedCommand takes UTF-16LE base64, which is the one form that survives
  // every layer between here and PowerShell without quoting rules.
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout) => {
        if (error && !stdout) {
          log('hello:', String(error.message ?? error))
          return resolve('')
        }
        resolve(String(stdout).trim())
      }
    )
  })
}

let cached: boolean | null = null

/**
 * Whether this machine has Hello set up at all. Cached: the answer changes only
 * when someone enrols a PIN or a fingerprint, and asking costs a PowerShell
 * start every time.
 */
export async function helloAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (cached !== null) return cached
  const out = await run(SCRIPT('check', ''), 15_000)
  cached = out.includes('AVAILABLE') && !out.includes('UNAVAILABLE')
  return cached
}

/** Forgets the cached answer, for when the setting page asks again. */
export const forgetHello = () => {
  cached = null
}

/**
 * Raises the real Hello prompt and resolves true only for a real verification.
 * Everything else — cancelled, timed out, retries exhausted, not set up — is
 * false, because there is one right answer and everything else is not it.
 */
export async function helloVerify(message: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const out = await run(SCRIPT('verify', message), TIMEOUT_MS)
  return /RESULT\s+Verified/i.test(out)
}
