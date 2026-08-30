import { useEffect, useMemo, useRef } from 'react'
import type { BackgroundSettings } from '../../../shared/types'

const OPACITY = { subtle: 0.35, medium: 0.6, vivid: 0.95 } as const
const SPEED = { subtle: 34, medium: 26, vivid: 18 } as const

const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i

interface Props {
  background: BackgroundSettings
  accent: string
  reduceMotion: boolean
  /** true while the user is looking at a page — lets video wallpapers pause */
  browsing: boolean
}

/**
 * The wallpaper layer: either a procedural animation or the user's own picture,
 * GIF or video. Everything animates on the compositor (transform / opacity /
 * background-position), so it never triggers layout.
 */
export default function Wallpaper({ background, accent, reduceMotion, browsing }: Props) {
  const video = useRef<HTMLVideoElement>(null)

  const palette = useMemo(() => {
    const mix = (pct: number, other: string) => `color-mix(in srgb, ${accent} ${pct}%, ${other})`
    return { a: mix(88, '#3ac2ff'), b: mix(55, '#ff6ec7'), c: mix(35, '#22d3a7') }
  }, [accent])

  const alpha = OPACITY[background.intensity]
  const duration = reduceMotion ? 0 : SPEED[background.intensity]

  // Pause the video while a page is in front: no decoding, no battery drain.
  useEffect(() => {
    const element = video.current
    if (!element) return
    element.playbackRate = background.speed
    if (browsing && background.pauseWhenBrowsing) element.pause()
    else void element.play().catch(() => undefined)
  }, [browsing, background.pauseWhenBrowsing, background.speed, background.file])

  if (background.kind === 'off') return null

  /* ---------------------------------------------------------- user media */
  if (background.kind === 'image' || background.kind === 'video') {
    if (!background.file) return null
    const src = `nya-media://wallpaper/${encodeURIComponent(background.file)}`
    const isVideo = background.kind === 'video' || VIDEO_EXT.test(background.file)
    const objectFit = background.fit === 'tile' ? 'none' : background.fit === 'center' ? 'none' : background.fit

    return (
      <div className="bg-canvas" aria-hidden>
        {isVideo ? (
          <video
            ref={video}
            className="bg-media"
            src={src}
            autoPlay
            loop
            muted={background.muted}
            playsInline
            preload="auto"
            style={{
              objectFit: objectFit as 'cover' | 'contain' | 'none',
              filter: background.blur ? `blur(${background.blur}px)` : undefined,
              transform: background.blur ? 'scale(1.06)' : undefined
            }}
          />
        ) : background.fit === 'tile' ? (
          <div
            className="bg-media"
            style={{
              backgroundImage: `url("${src}")`,
              backgroundRepeat: 'repeat',
              filter: background.blur ? `blur(${background.blur}px)` : undefined
            }}
          />
        ) : (
          <img
            className="bg-media"
            src={src}
            alt=""
            style={{
              objectFit: objectFit as 'cover' | 'contain' | 'none',
              filter: background.blur ? `blur(${background.blur}px)` : undefined,
              transform: background.blur ? 'scale(1.06)' : undefined
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: 'var(--bg)',
            opacity: background.dim / 100,
            transition: 'opacity var(--t-slow) var(--ease-out)'
          }}
        />
      </div>
    )
  }

  /* ---------------------------------------------------------- procedural */
  const anim = (name: string, seconds: number) => (duration ? `${name} ${seconds}s ease-in-out infinite` : 'none')

  if (background.kind === 'aurora') {
    return (
      <div className="bg-canvas animate-fade" aria-hidden>
        <div
          className="blob"
          style={{
            width: '58vw', height: '58vw', left: '-12vw', top: '-18vw',
            background: palette.a, opacity: alpha, animation: anim('drift-a', duration)
          }}
        />
        <div
          className="blob"
          style={{
            width: '48vw', height: '48vw', right: '-10vw', top: '4vh',
            background: palette.b, opacity: alpha * 0.85, animation: anim('drift-b', duration * 1.25)
          }}
        />
        <div
          className="blob"
          style={{
            width: '52vw', height: '52vw', left: '22vw', bottom: '-26vw',
            background: palette.c, opacity: alpha * 0.7, animation: anim('drift-c', duration * 1.5)
          }}
        />
      </div>
    )
  }

  if (background.kind === 'mesh') {
    return (
      <div className="bg-canvas animate-fade" aria-hidden>
        <div
          className="mesh"
          style={{
            opacity: alpha,
            ['--mesh-duration' as string]: duration ? `${duration}s` : '0s',
            animationPlayState: duration ? 'running' : 'paused',
            backgroundImage: [
              `radial-gradient(closest-side at 30% 35%, ${palette.a}, transparent)`,
              `radial-gradient(closest-side at 72% 28%, ${palette.b}, transparent)`,
              `radial-gradient(closest-side at 48% 78%, ${palette.c}, transparent)`
            ].join(',')
          }}
        />
      </div>
    )
  }

  const wave = (fill: string, height: number, seconds: number, opacity: number, offset: number) => (
    <svg
      className="wave"
      viewBox="0 0 1200 200"
      preserveAspectRatio="none"
      style={{
        opacity,
        height: `${height}%`,
        bottom: `${offset}%`,
        ['--wave-duration' as string]: duration ? `${seconds}s` : '0s',
        animationPlayState: duration ? 'running' : 'paused'
      }}
    >
      <path fill={fill} d="M0 120 C 150 60 250 180 400 120 C 550 60 650 180 800 120 C 950 60 1050 180 1200 120 L1200 200 L0 200 Z" />
      <path fill={fill} transform="translate(1200 0)" d="M0 120 C 150 60 250 180 400 120 C 550 60 650 180 800 120 C 950 60 1050 180 1200 120 L1200 200 L0 200 Z" />
    </svg>
  )

  return (
    <div className="bg-canvas animate-fade" aria-hidden>
      <div
        className="blob"
        style={{
          width: '70vw', height: '40vw', left: '10vw', top: '-14vw',
          background: palette.a, opacity: alpha * 0.55, animation: anim('drift-a', duration * 1.6)
        }}
      />
      {wave(palette.c, 40, duration * 1.7 || 1, alpha * 0.5, -8)}
      {wave(palette.b, 34, duration * 1.1 || 1, alpha * 0.45, -14)}
      {wave(palette.a, 28, duration * 0.8 || 1, alpha * 0.4, -20)}
    </div>
  )
}
