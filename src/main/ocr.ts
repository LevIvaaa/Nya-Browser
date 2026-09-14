import { execFile } from 'child_process'
import { log } from './log'

/**
 * Reading the words out of a picture, using what Windows already has.
 *
 * Windows ships an OCR engine — Windows.Media.Ocr — with language packs for
 * whatever the system has installed, and it is good. The alternative was
 * bundling Tesseract and its language data, which is twenty-odd megabytes in
 * the installer and a worse result on a screenshot, so this takes the path the
 * password vault already takes for Windows Hello: one short PowerShell script,
 * run out of process, that prints what it found.
 *
 * Elsewhere there is no engine to ask, and this says so rather than pretending.
 */

/** What the prompt is allowed to take before we stop waiting. */
const TIMEOUT_MS = 30_000

/**
 * The script, as one line per statement, handed over base64-encoded so that
 * nothing in it has to survive a shell's idea of quoting.
 */
const SCRIPT = (file: string) =>
  [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -AssemblyName System.Runtime.WindowsRuntime`,
    `try {`,
    `  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]`,
    `  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]`,
    `  [void][Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]`,
    `} catch { Write-Output 'UNAVAILABLE'; exit 0 }`,
    `$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {`,
    `  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and`,
    `  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1)`,
    `function Await($op, $type) {`,
    `  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))`,
    `  $task.Wait(-1) | Out-Null`,
    `  $task.Result`,
    `}`,
    `$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()`,
    `if ($null -eq $engine) { Write-Output 'NOLANG'; exit 0 }`,
    `$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${file.replace(/'/g, "''")}')) ([Windows.Storage.StorageFile])`,
    `$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])`,
    `$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])`,
    `$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])`,
    `$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])`,
    `Write-Output 'OK'`,
    `foreach ($line in $result.Lines) { Write-Output $line.Text }`
  ].join('\n')

export interface OcrResult {
  /** 'ok', or why there is nothing */
  state: 'ok' | 'unavailable' | 'no-language' | 'failed'
  text: string
}

/** True where there is an engine to ask at all. */
export function ocrAvailable(): boolean {
  return process.platform === 'win32'
}

/**
 * The words in a picture file. The file is read by Windows, not by us: the
 * path goes in, the text comes out, and nothing touches the network.
 */
export function readPicture(file: string): Promise<OcrResult> {
  if (!ocrAvailable()) return Promise.resolve({ state: 'unavailable', text: '' })
  const encoded = Buffer.from(SCRIPT(file), 'utf16le').toString('base64')
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          log('ocr failed', String(error))
          return resolve({ state: 'failed', text: '' })
        }
        const lines = stdout.split(/\r?\n/)
        const head = lines[0]?.trim()
        if (head === 'UNAVAILABLE') return resolve({ state: 'unavailable', text: '' })
        if (head === 'NOLANG') return resolve({ state: 'no-language', text: '' })
        if (head !== 'OK') return resolve({ state: 'failed', text: '' })
        resolve({ state: 'ok', text: lines.slice(1).join('\n').trim() })
      }
    )
  })
}
