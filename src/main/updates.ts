// ---------------------------------------------------------------------------
// Updates from this project's own GitHub releases.
//
// Windows: electron-updater replaces the installation. A portable exe has no
// installation to replace, so "Проверить обновления" says so plainly instead
// of pretending.
//
// Linux: the same card, the same download screen — and then the package
// manager. electron-updater is not used there, because it would write into
// /opt behind dpkg's back and leave the system's idea of what is installed
// disagreeing with what is there. Instead the .deb from the release is fetched
// here, with the progress people are used to seeing, and handed to PackageKit
// over D-Bus — the same road the App Center takes. The system's password
// prompt stays: installing a system package is confirmed by the person, and
// that is not ours to skip.
// ---------------------------------------------------------------------------

import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { log } from './log'
import type { UpdateState } from '../shared/types'

/** Long enough that a launch is never slowed by a network round trip. */
const FIRST_CHECK_DELAY = 25_000
const RECHECK_EVERY = 6 * 60 * 60 * 1000

let state: UpdateState = {
  stage: 'idle',
  version: app.getVersion(),
  available: null,
  percent: 0,
  size: 0,
  error: '',
  supported: false,
  checkedAt: 0
}

type Listener = (state: UpdateState) => void
const listeners = new Set<Listener>()

const emit = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

export const updateState = () => state

export function onUpdateState(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * A portable build has nothing to replace, and an unpackaged one has no
 * update-config at all; in both cases electron-updater would only throw.
 */
function canUpdate(): boolean {
  if (!app.isPackaged) return false
  // Linux updates itself too, but by its own road — see `linuxManaged` — so
  // electron-updater is not the thing that answers for it.
  if (process.platform === 'linux') return false
  // electron-builder sets this for the portable target only.
  return !process.env.PORTABLE_EXECUTABLE_DIR
}

/** An installed .deb: it can be updated, by the package manager. */
function linuxManaged(): boolean {
  return process.platform === 'linux' && app.isPackaged
}


/**
 * The newest release, asked of GitHub directly. Used where electron-updater
 * cannot run: on Linux it answers both questions at once — is there something
 * newer, and which file to fetch.
 */
async function newestPublished(): Promise<{ version: string; deb: string; size: number }> {
  const response = await net.fetch(
    'https://api.github.com/repos/LevIvaaa/Nya-Browser/releases/latest',
    { headers: { accept: 'application/vnd.github+json' } }
  )
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  const body = (await response.json()) as {
    tag_name?: string
    assets?: { name?: string; browser_download_url?: string; size?: number }[]
  }
  // Пакет под ту же разрядность, что и работающая копия. Релиз без .deb —
  // не повод молчать: тогда остаётся сказать о версии и показать страницу.
  const wanted = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const asset =
    (body.assets ?? []).find((one) => (one.name ?? '').endsWith(`_${wanted}.deb`)) ??
    (body.assets ?? []).find((one) => (one.name ?? '').endsWith('.deb'))
  return {
    version: String(body.tag_name ?? '').replace(/^v/, ''),
    deb: String(asset?.browser_download_url ?? ''),
    size: Number(asset?.size ?? 0)
  }
}

/* --------------------------------------------------------------- Linux -- */

/** Куда лёг скачанный пакет; пустая строка — значит качать ещё нечего. */
let debUrl = ''
let debFile = ''

/** Папка под скачанный пакет: своя, чтобы её можно было удалить целиком. */
function debDir(): string {
  const dir = join(tmpdir(), 'nya-browser-update')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Качает пакет, рассказывая, насколько продвинулся.
 *
 * Тот же экран с полосой, что и на Windows: человеку незачем знать, что под
 * ним другой способ доставки.
 */
async function downloadDeb(): Promise<boolean> {
  if (!debUrl) return false
  emit({ stage: 'downloading', percent: 0, error: '' })
  try {
    const response = await net.fetch(debUrl)
    if (!response.ok || !response.body) throw new Error(`GitHub ${response.status}`)

    // Заголовок бывает и не бывает; когда его нет, берём размер, который
    // назвал релиз, — иначе проценты считать не из чего.
    const total = Number(response.headers.get('content-length')) || state.size || 0
    const file = join(debDir(), debUrl.split('/').pop() || 'nya-browser.deb')
    const out = createWriteStream(file)
    const reader = response.body.getReader()
    let got = 0
    let shown = -1

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      got += value.byteLength
      await new Promise<void>((written, failed) =>
        out.write(Buffer.from(value), (error) => (error ? failed(error) : written()))
      )
      const percent = total > 0 ? Math.min(99, Math.round((got / total) * 100)) : 0
      // Перерисовывать на каждом куске незачем: процент меняется реже.
      if (percent !== shown) {
        shown = percent
        emit({ stage: 'downloading', percent })
      }
    }
    await new Promise<void>((closed) => out.end(closed))

    debFile = file
    log('updates: package fetched to', file)
    emit({ stage: 'ready', percent: 100 })
    return true
  } catch (error) {
    log('updates: package download failed —', String(error))
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
    return false
  }
}

/** Запускает программу и ждёт её, не превращая неудачу в исключение. */
function run(command: string, args: string[]): Promise<{ ok: boolean; said: string }> {
  return new Promise((done) => {
    execFile(command, args, { timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => {
      if (!error) return done({ ok: true, said: String(stdout) })
      done({ ok: false, said: String(stderr || (error as Error).message) })
    })
  })
}

/**
 * Ставит скачанный пакет.
 *
 * Сначала PackageKit по D-Bus — тем же путём, которым ставит App Center:
 * пакет проходит через dpkg, зависимости разбирает система, и она же знает,
 * что у неё теперь установлено.
 *
 * Если PackageKit недоступен — а `gdbus` есть не в каждой установке, и не
 * каждый рабочий стол держит его службу, — остаётся apt под pkexec. Это тот
 * же dpkg и то же системное окно с паролем, просто без посредника.
 *
 * Чего здесь нет и не будет: тихой установки от имени root. Установка
 * системного пакета подтверждается человеком, и обходить это подтверждение
 * браузеру не положено.
 */
async function installDeb(): Promise<boolean> {
  if (!debFile) return false
  emit({ stage: 'installing', error: '' })

  const byPackageKit = await run('gdbus', [
    'call',
    '--session',
    '--dest',
    'org.freedesktop.PackageKit',
    '--object-path',
    '/org/freedesktop/PackageKit',
    '--method',
    'org.freedesktop.PackageKit.Modify.InstallPackageFiles',
    '0',
    `['${debFile}']`,
    ''
  ])

  let done = byPackageKit.ok
  if (!done) {
    log('updates: PackageKit refused —', byPackageKit.said.trim())
    const byApt = await run('pkexec', ['apt-get', 'install', '-y', '--allow-downgrades', debFile])
    done = byApt.ok
    if (!done) {
      log('updates: apt refused —', byApt.said.trim())
      emit({
        stage: 'error',
        error: byApt.said.trim().slice(0, 300) || 'Установка не завершилась'
      })
      return false
    }
  }

  log('updates: installed, restarting')
  try {
    rmSync(debDir(), { recursive: true, force: true })
  } catch {
    /* временная папка — не повод не перезапуститься */
  }
  app.relaunch()
  app.quit()
  return true
}

/** Compares two dotted versions without pretending to know semver. */
function isNewer(candidate: string, current: string): boolean {
  const parts = (value: string) => value.split('.').map((n) => parseInt(n, 10) || 0)
  const a = parts(candidate)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

let wired = false

export function initUpdates() {
  state = { ...state, supported: canUpdate() || linuxManaged(), managed: linuxManaged() }
  if (linuxManaged()) {
    // Ничего не качается само: сотня мегабайт на чужом мобильном интернете —
    // не то решение, которое браузер принимает за человека. Но сказать, что
    // вышла новая версия, он обязан, иначе на старой остаются молча.
    log('updates: package-managed build, checking on our own')
    setTimeout(() => void checkByHand(), FIRST_CHECK_DELAY)
    setInterval(() => void checkByHand(), RECHECK_EVERY)
    return
  }
  if (!canUpdate()) {
    log('updates: not supported for this build')
    return
  }
  if (wired) return
  wired = true

  // Nothing is fetched until the user says so: a browser that quietly pulls a
  // hundred megabytes on someone's tethered connection has decided something
  // that was not its to decide. What it may do is say a version exists.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => undefined }

  autoUpdater.on('checking-for-update', () => emit({ stage: 'checking', error: '' }))
  autoUpdater.on('update-not-available', () =>
    emit({ stage: 'current', available: null, checkedAt: Date.now() })
  )
  autoUpdater.on('update-available', (info) => {
    log('updates: found', info.version)
    emit({
      stage: 'available',
      available: info.version,
      // The installer is the only file in the release that matters here.
      size: info.files?.[0]?.size ?? 0,
      percent: 0,
      checkedAt: Date.now()
    })
  })
  autoUpdater.on('download-progress', (progress) =>
    emit({ stage: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    log('updates: ready to install', info.version)
    emit({ stage: 'ready', available: info.version, percent: 100 })
  })
  autoUpdater.on('error', (error) => {
    log('updates: failed —', String(error))
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
  })

  setTimeout(() => void check(), FIRST_CHECK_DELAY)
  setInterval(() => void check(), RECHECK_EVERY)
}

/**
 * Проверка без electron-updater — по релизам GitHub напрямую.
 *
 * Если в релизе лежит пакет, дальше всё как на Windows: карточка, кнопка,
 * полоса загрузки. Если пакета почему-то нет, ответ помечается `manual`, и
 * кнопка честно ведёт на страницу загрузки, а не запускает загрузку в никуда.
 */
async function checkByHand(): Promise<UpdateState> {
  // Загрузка идёт — проверять посреди неё нечего, а сбросить её проверкой
  // было бы обидно.
  if (state.stage === 'downloading' || state.stage === 'installing') return state
  emit({ stage: 'checking', error: '' })
  try {
    const newest = await newestPublished()
    if (newest.version && isNewer(newest.version, app.getVersion())) {
      debUrl = newest.deb
      emit({
        stage: 'available',
        available: newest.version,
        size: newest.size,
        percent: 0,
        manual: !newest.deb,
        error: ''
      })
    } else {
      emit({ stage: 'current', available: '', manual: false, error: '' })
    }
  } catch (error) {
    emit({ stage: 'error', error: String(error), manual: true })
  }
  return state
}

export async function check(): Promise<UpdateState> {
  if (linuxManaged()) return checkByHand()
  if (!canUpdate()) {
    return {
      ...state,
      stage: 'unsupported',
      error: app.isPackaged
        ? 'Портативная сборка не может обновить себя — нужен установщик'
        : 'Обновления работают только в собранной версии'
    }
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
  }
  return state
}

/** Starts the download the user asked for. */
export async function download(): Promise<boolean> {
  if (state.stage !== 'available') return false
  if (linuxManaged()) return downloadDeb()
  emit({ stage: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
    return true
  } catch (error) {
    emit({ stage: 'error', error: String(error instanceof Error ? error.message : error) })
    return false
  }
}

/** Quits and lets the downloaded installer take over. */
export function installNow(): boolean {
  if (state.stage !== 'ready') return false
  if (linuxManaged()) {
    void installDeb()
    return true
  }
  log('updates: restarting to install')
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
  return true
}
