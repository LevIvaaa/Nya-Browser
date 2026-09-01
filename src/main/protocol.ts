import { protocol, session, type Session } from 'electron'
import { createReadStream, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { Readable } from 'stream'
import { profiles } from './profiles'
import { securityPage } from './selftest'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg'
}

export const WALLPAPER_EXTENSIONS = Object.keys(MIME).map((e) => e.slice(1))

/** Must run before app.whenReady(). */
export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'nya',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    },
    {
      scheme: 'nya-media',
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false }
    }
  ])
}

/**
 * Serves internal pages, the user's wallpapers and profile avatars. Only plain
 * file names from those two folders are accepted, so a crafted URL cannot reach
 * anything else on disk.
 *
 * Protocol handlers are PER-SESSION in Chromium: registering on the default
 * session covers the chrome UI, but every profile partition needs its own
 * registration or nya:// pages simply fail to load in tabs.
 */
export function registerProtocols(ses: Session = session.defaultSession) {
  const proto = ses.protocol
  if (proto.isProtocolHandled('nya')) return

  proto.handle('nya', async (request) => {
    const url = new URL(request.url)
    if (url.host === 'security') {
      return new Response(securityPage(), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy':
            // External script/img/fetch sources stay allowed on purpose: the
            // page PROVES the blocker works by trying to load real trackers,
            // and the CSP must not be the thing that blocks them.
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https:; img-src https: http: data:; connect-src https: http:"
        }
      })
    }
    return new Response('Not found', { status: 404 })
  })

  proto.handle('nya-media', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'wallpaper' && url.host !== 'avatar') {
      return new Response('Not found', { status: 404 })
    }

    const name = basename(decodeURIComponent(url.pathname.replace(/^\//, '')))
    const ext = extname(name).toLowerCase()
    if (!name || !MIME[ext]) return new Response('Forbidden', { status: 403 })

    const file =
      url.host === 'avatar' ? join(profiles.avatarDir(), name) : join(profiles.wallpaperDir(), name)
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const range = request.headers.get('range')
    const headers: Record<string, string> = {
      'content-type': MIME[ext],
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache'
    }

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      const start = match && match[1] ? Number(match[1]) : 0
      const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
      if (start >= size) {
        return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
      }
      headers['content-range'] = `bytes ${start}-${end}/${size}`
      headers['content-length'] = String(end - start + 1)
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(stream, { status: 206, headers })
    }

    headers['content-length'] = String(size)
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(stream, { headers })
  })
}
