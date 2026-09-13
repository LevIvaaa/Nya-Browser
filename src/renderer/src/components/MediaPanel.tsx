import { t } from '../i18n'
import { useEffect, useState } from 'react'
import type { Playing } from '../../../shared/types'
import { Globe, Pause, Play, Volume, VolumeOff } from './Icons'

/**
 * What is playing, and where.
 *
 * A browser with thirty tabs open is the one place where "something is making
 * a noise and I cannot find it" happens daily. Every tab that plays anything
 * reports it; this is the one list of those, with the controls on each row and
 * a way to go to the tab it belongs to.
 */
export default function MediaPanel({ x, onClose }: { x: number; onClose: () => void }) {
  const [list, setList] = useState<Playing[]>([])

  useEffect(() => {
    void window.browser.playing().then(setList)
    return window.browser.onMedia(setList)
  }, [])

  const width = 340
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
        onClick={onClose}
      />
      <div
        className="animate-fade-down contain absolute z-50 flex max-h-[min(520px,80vh)] flex-col overflow-hidden rounded-card"
        style={{
          top: 40,
          left,
          width,
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
      >
        <div className="shrink-0 px-3 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-wider text-faint">
          {t('Сейчас играет')}
        </div>

        <div className="min-h-0 overflow-y-auto px-1.5 pb-2">
          {list.length === 0 && (
            <p className="px-2 py-3 text-sm text-faint">{t('Ничего не играет')}</p>
          )}
          {list.map((item) => (
            <Row key={item.tabId} item={item} onClose={onClose} />
          ))}
        </div>
      </div>
    </>
  )
}

/** Seconds as a person reads them: 4:07, or 1:02:30 when it is that long. */
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.round(seconds)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

function Row({ item, onClose }: { item: Playing; onClose: () => void }) {
  const done = item.duration > 0 ? Math.min(1, item.position / item.duration) : 0

  return (
    <div className="rounded-[10px] px-2 py-2 hover:bg-[var(--surface-hover)]" style={{ transition: 'background var(--t-fast) linear' }}>
      <div className="flex items-center gap-2.5">
        {item.art ? (
          <img src={item.art} alt="" className="h-10 w-10 shrink-0 rounded-[8px] object-cover" />
        ) : (
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] text-faint"
            style={{ background: 'var(--field-idle)' }}
          >
            <Globe width={16} height={16} />
          </span>
        )}

        <button
          className="min-w-0 flex-1 text-left"
          title={t('Перейти к вкладке')}
          onClick={() => {
            void window.browser.switchTab(item.tabId)
            onClose()
          }}
        >
          <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
          <span className="block truncate text-2xs text-faint">{item.artist || item.host}</span>
        </button>

        <button
          className="icon-btn h-8 w-8 shrink-0"
          title={item.muted ? t('Включить звук') : t('Выключить звук')}
          onClick={() => void window.browser.mediaCommand(item.tabId, 'mute')}
        >
          {item.muted ? <VolumeOff width={14} height={14} /> : <Volume width={14} height={14} />}
        </button>
        <button
          className="icon-btn h-8 w-8 shrink-0"
          title={item.playing ? t('Пауза') : t('Воспроизвести')}
          onClick={() => void window.browser.mediaCommand(item.tabId, 'toggle')}
        >
          {item.playing ? <Pause width={14} height={14} /> : <Play width={14} height={14} />}
        </button>
      </div>

      {/* A live stream has no length to show, so it gets no line. */}
      {item.duration > 0 && (
        <div className="mt-1.5 flex items-center gap-2 pl-[50px]">
          <span className="shrink-0 text-2xs tabular-nums text-faint">{clock(item.position)}</span>
          <input
            type="range"
            min={0}
            max={item.duration}
            value={Math.min(item.position, item.duration)}
            className="h-1 min-w-0 flex-1 accent-[var(--accent)]"
            onChange={(event) =>
              void window.browser.mediaCommand(item.tabId, 'seek', Number(event.target.value))
            }
            style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(done * 100)}%, var(--line))` }}
          />
          <span className="shrink-0 text-2xs tabular-nums text-faint">{clock(item.duration)}</span>
        </div>
      )}
    </div>
  )
}

/** The button in the toolbar, which is only there while something is playing. */
export function MediaButton({ onOpen }: { onOpen: (x: number) => void }) {
  const [list, setList] = useState<Playing[]>([])

  useEffect(() => {
    void window.browser.playing().then(setList)
    return window.browser.onMedia(setList)
  }, [])

  if (list.length === 0) return null
  const playing = list.some((item) => item.playing)

  return (
    <button
      className="icon-btn shrink-0"
      title={t('Сейчас играет')}
      style={{ color: playing ? 'var(--accent)' : undefined }}
      onClick={(event) => onOpen(Math.round(event.currentTarget.getBoundingClientRect().left))}
    >
      {playing ? <Volume width={16} height={16} /> : <VolumeOff width={16} height={16} />}
    </button>
  )
}
