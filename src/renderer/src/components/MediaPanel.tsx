import { t } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Playing } from '../../../shared/types'
import { Back10, Camera, Forward10, Note, Pause, Pip, Play, SkipBack, SkipForward, Sleep, Volume, VolumeOff } from './Icons'

/**
 * What is playing, and where.
 *
 * A browser with thirty tabs open is the one place where "something is making
 * a noise and I cannot find it" happens daily. Every tab that plays anything
 * reports it; this is the one list of those — the first one as a player you
 * can actually use, the rest as a line each, with the way to their tab on it.
 */
export default function MediaPanel({ x, onClose }: { x: number; onClose: () => void }) {
  const [list, setList] = useState<Playing[]>([])

  useEffect(() => {
    void window.browser.playing().then(setList)
    return window.browser.onMedia(setList)
  }, [])

  const width = 384
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const [first, ...rest] = list
  const cover = first?.art || first?.favicon || ''

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
        onClick={onClose}
      />
      <div
        className="animate-fade-down contain absolute z-50 flex max-h-[min(560px,82vh)] flex-col overflow-hidden rounded-card"
        style={{
          top: 40,
          left,
          width,
          background: 'var(--elevated)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
      >
        {/* The cover, out of focus and filling the whole panel: the colour of
            the music is the colour of the thing you are looking at, edge to
            edge, with no dark frame drawn around it. */}
        {cover && (
          <div
            key={cover}
            className="animate-fade pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url("${cover}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(34px) saturate(220%)',
              transform: 'scale(1.7)',
              opacity: 0.42
            }}
          />
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--elevated) 42%, transparent), color-mix(in srgb, var(--elevated) 86%, transparent))'
          }}
        />

        <div className="relative shrink-0 px-3 pb-1.5 pt-2.5 text-2xs font-semibold uppercase tracking-wider text-faint">
          {t('Сейчас играет')}
        </div>

        <div className="relative min-h-0 overflow-y-auto px-2 pb-2">
          {!first && (
            <div className="flex flex-col items-center gap-2 px-2 py-7 text-faint">
              <Note width={22} height={22} />
              <p className="text-sm">{t('Ничего не играет')}</p>
            </div>
          )}

          {first && <Hero key={first.tabId} item={first} onClose={onClose} />}

          {rest.length > 0 && (
            <div className="px-1 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-faint">
              {t('Другие источники')}
            </div>
          )}
          <div className="stagger">
            {rest.map((item) => (
              <Row key={item.tabId} item={item} onClose={onClose} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * The speeds, in a ring. `step` is how far round to go: one for the next one,
 * nought for the one you are on — so the button can say what it will do.
 */
const SPEEDS = [1, 1.25, 1.5, 2, 0.75]
function faster(rate: number, step = 1) {
  const at = SPEEDS.findIndex((one) => Math.abs(one - rate) < 0.01)
  return SPEEDS[((at < 0 ? 0 : at) + step) % SPEEDS.length]
}

/** Seconds as a person reads them: 4:07, or 1:02:30 when it is that long. */
function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/**
 * Where the track is, second by second, between the reports.
 *
 * A page says where it is about once a second. A line that moved once a second
 * would look broken, so the number is carried forward by the clock and put
 * right whenever the page speaks.
 */
function useClock(item: Playing) {
  const [at, setAt] = useState(item.position)
  const from = useRef({ position: item.position, when: Date.now() })

  useEffect(() => {
    from.current = { position: item.position, when: Date.now() }
    setAt(item.position)
  }, [item.tabId, item.position])

  useEffect(() => {
    if (!item.playing) return
    const tick = window.setInterval(() => {
      const next = from.current.position + (Date.now() - from.current.when) / 1000
      setAt(item.duration > 0 ? Math.min(next, item.duration) : next)
    }, 200)
    return () => window.clearInterval(tick)
  }, [item.playing, item.duration, item.tabId])

  return at
}

/** Three bars keeping time — paused when the sound is. */
function Eq({ on }: { on: boolean }) {
  return (
    <span className={on ? 'eq' : 'eq still'} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

/**
 * A line you can take hold of. One of these is the track, the other is the
 * volume; both behave the same way, which is the point of having one.
 */
function Scrub({
  value,
  max,
  label,
  onDrag,
  onDone,
  step = 5
}: {
  value: number
  max: number
  label: string
  /** while the hand is down, so the numbers beside it can follow */
  onDrag?: (to: number) => void
  onDone: (to: number) => void
  step?: number
}) {
  const rail = useRef<HTMLDivElement | null>(null)
  const [holding, setHolding] = useState(false)

  const at = useCallback(
    (clientX: number) => {
      const box = rail.current?.getBoundingClientRect()
      if (!box || box.width <= 0) return 0
      const ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width))
      return ratio * max
    },
    [max]
  )

  const done = Math.max(0, Math.min(1, max > 0 ? value / max : 0))

  return (
    <div
      ref={rail}
      className={`scrub ${holding ? 'holding' : ''}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setHolding(true)
        onDrag?.(at(event.clientX))
      }}
      onPointerMove={(event) => {
        if (!holding) return
        onDrag?.(at(event.clientX))
      }}
      onPointerUp={(event) => {
        if (!holding) return
        setHolding(false)
        onDone(at(event.clientX))
      }}
      onPointerCancel={() => setHolding(false)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') onDone(Math.max(0, value - step))
        else if (event.key === 'ArrowRight') onDone(Math.min(max, value + step))
        else return
        event.preventDefault()
      }}
    >
      <div className="scrub-rail">
        <div
          className="scrub-fill"
          style={{
            width: `${done * 100}%`,
            // While the hand is on it the line must follow the hand exactly;
            // the rest of the time it may take the second it is given.
            transition: holding ? 'none' : 'width 220ms linear'
          }}
        />
      </div>
      <span
        className="scrub-thumb"
        style={{ left: `${done * 100}%`, transition: holding ? 'transform var(--t-fast)' : undefined }}
      />
    </div>
  )
}

/** The cover, or the tab's own icon, or a note — in that order of preference. */
function Art({ item, size }: { item: Playing; size: number }) {
  const [gave, setGave] = useState<string[]>([])
  // Each picture is tried once. A site without a favicon should leave a note
  // behind, not a torn-paper icon.
  const src = [item.art, item.favicon].find((one) => one && !gave.includes(one))
  const radius = size > 48 ? 'var(--radius-md)' : 'var(--radius-sm)'

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="art-in shrink-0 object-cover"
        style={{ width: size, height: size, borderRadius: radius, background: 'var(--field-idle)' }}
        key={src}
        onError={() => setGave((list) => (list.includes(src) ? list : [...list, src]))}
      />
    )
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center text-faint"
      style={{ width: size, height: size, borderRadius: radius, background: 'var(--field-idle)' }}
    >
      <Note width={Math.round(size / 2.6)} height={Math.round(size / 2.6)} />
    </span>
  )
}

/** The one in front: the whole player, for whatever is playing now. */
function Hero({ item, onClose }: { item: Playing; onClose: () => void }) {
  const running = useClock(item)
  const [held, setHeld] = useState<number | null>(null)
  const at = held ?? running
  // No length to run along. That is what a live stream looks like — but so
  // does a site that simply never says where in the track it is, and calling
  // an ordinary song a live broadcast is a small lie. A source with a track
  // list of its own is not a broadcast, so only the rest are called one.
  const endless = item.duration <= 0
  const live = endless && !item.next && !item.prev
  const send = (
    what: Parameters<typeof window.browser.mediaCommand>[1],
    to?: number
  ) => void window.browser.mediaCommand(item.tabId, what, to)

  const go = () => {
    void window.browser.switchTab(item.tabId)
    onClose()
  }

  return (
    <div className="relative" style={{ borderRadius: 'var(--radius)' }}>
      <div className="relative px-1 pb-1 pt-0.5">
        <div className="flex items-start gap-3">
          <button className="lift shrink-0" title={t('Перейти к вкладке')} onClick={go}>
            <Art item={item} size={72} />
          </button>

          <div className="min-w-0 flex-1 pt-0.5">
            <button className="block w-full min-w-0 text-left" title={t('Перейти к вкладке')} onClick={go}>
              <span className="block truncate text-[15px] font-semibold leading-tight text-ink">
                {item.title}
              </span>
              {item.artist && (
                <span className="mt-0.5 block truncate text-xs text-dim">{item.artist}</span>
              )}
              <span className="mt-1 flex items-center gap-1.5 text-2xs text-faint">
                <span style={{ color: item.playing ? 'var(--accent)' : undefined }}>
                  <Eq on={item.playing && !item.muted} />
                </span>
                <span className="truncate">{item.host}</span>
                {live && item.playing && <span className="shrink-0">· {t('Прямой эфир')}</span>}
              </span>
            </button>
          </div>

          {item.pip && (
            <button
              className="icon-btn h-8 w-8 shrink-0"
              title={t('В отдельном окне')}
              onClick={() => send('pip')}
            >
              <Pip width={15} height={15} />
            </button>
          )}
        </div>

        {/* Nothing to run along, nothing to draw. */}
        {!endless && (
          <div className="mt-2.5">
            <Scrub
              value={Math.min(at, item.duration)}
              max={item.duration}
              label={t('Перемотка')}
              onDrag={item.seekable ? setHeld : undefined}
              onDone={(to) => {
                setHeld(null)
                if (item.seekable) send('seek', Math.round(to))
              }}
            />
            <div className="mt-1 flex items-center justify-between text-2xs tabular-nums text-faint">
              <span>{clock(at)}</span>
              <span>{clock(item.duration)}</span>
            </div>
          </div>
        )}

        <div className={`flex items-center justify-center gap-1 ${endless ? 'mt-3' : 'mt-0.5'}`}>
          {item.prev && (
            <button className="icon-btn h-9 w-9" title={t('Предыдущий трек')} onClick={() => send('prev')}>
              <SkipBack width={16} height={16} />
            </button>
          )}
          {!endless && (
            <button
              className="icon-btn h-9 w-9"
              title={t('Назад на 10 секунд')}
              onClick={() => send('skip', -10)}
            >
              <Back10 width={17} height={17} />
            </button>
          )}
          <button
            className="lift mx-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white"
            style={{ background: 'var(--accent)', boxShadow: 'var(--shadow-md)' }}
            title={item.playing ? t('Пауза') : t('Воспроизвести')}
            onClick={() => send('toggle')}
          >
            {item.playing ? <Pause width={19} height={19} /> : <Play width={19} height={19} />}
          </button>
          {!endless && (
            <button
              className="icon-btn h-9 w-9"
              title={t('Вперёд на 10 секунд')}
              onClick={() => send('skip', 10)}
            >
              <Forward10 width={17} height={17} />
            </button>
          )}
          {item.next && (
            <button className="icon-btn h-9 w-9" title={t('Следующий трек')} onClick={() => send('next')}>
              <SkipForward width={16} height={16} />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <button
            className="icon-btn h-8 w-8 shrink-0"
            title={item.muted ? t('Включить звук') : t('Выключить звук')}
            onClick={() => send('mute')}
          >
            {item.muted ? <VolumeOff width={15} height={15} /> : <Volume width={15} height={15} />}
          </button>
          <div className="min-w-0 flex-1" style={{ opacity: item.muted ? 0.4 : 1 }}>
            <Scrub
              value={item.muted ? 0 : item.volume}
              max={1}
              step={0.05}
              label={t('Громкость')}
              onDone={(to) => send('volume', Number(to.toFixed(2)))}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-faint">
            {Math.round((item.muted ? 0 : item.volume) * 100)}%
          </span>
          {item.rate > 0 && (
            <button
              className="icon-btn h-8 w-auto shrink-0 px-1.5 text-2xs font-semibold tabular-nums"
              title={t('Скорость')}
              style={{ color: item.rate === 1 ? undefined : 'var(--accent)' }}
              onClick={() => send('rate', faster(item.rate))}
            >
              {String(faster(item.rate, 0)).replace('.', ',')}×
            </button>
          )}
        </div>

        <Extras video={item.video} />
      </div>
    </div>
  )
}

/**
 * The row of things a player is asked for once it has been watched for a
 * while: go back fifteen seconds, take this frame, put the subtitles on, keep
 * the controls in sight, and stop in twenty minutes.
 *
 * Kept small and unlabelled on purpose — the panel is a panel, not a settings
 * page, and each of these is one press.
 */
function Extras({ video }: { video: boolean }) {
  const [sleep, setSleep] = useState(0)
  const [panel, setPanel] = useState(false)

  const step = (minutes: number) => {
    setSleep(minutes)
    void window.browser.sleepTimer(minutes)
  }

  return (
    <div className="mt-2 flex items-center gap-1">
      <button
        className="icon-btn h-8 w-auto px-2 text-2xs font-semibold"
        title={t('Назад на 15 секунд')}
        onClick={() => void window.browser.player('replay')}
      >
        ↺ 15
      </button>
      {video && (
        <button
          className="icon-btn h-8 w-8"
          title={t('Снимок кадра')}
          onClick={() => void window.browser.player('frame-now')}
        >
          <Camera width={14} height={14} />
        </button>
      )}
      {video && (
        <button
          className="icon-btn h-8 w-auto px-2 text-2xs font-semibold"
          title={t('Субтитры')}
          onClick={() => void window.browser.player('subtitles')}
        >
          CC
        </button>
      )}
      <button
        className="icon-btn h-8 w-8"
        title={t('Мини-плеер')}
        style={{ color: panel ? 'var(--accent)' : undefined }}
        onClick={() => {
          setPanel(!panel)
          void window.browser.player('panel')
        }}
      >
        <Pip width={14} height={14} />
      </button>
      <span className="flex-1" />
      {/* Nothing, fifteen, thirty, sixty — the four answers anybody gives. */}
      <button
        className="icon-btn h-8 w-auto px-2 text-2xs font-semibold tabular-nums"
        title={t('Таймер сна')}
        style={{ color: sleep > 0 ? 'var(--accent)' : undefined }}
        onClick={() => step(sleep === 0 ? 15 : sleep === 15 ? 30 : sleep === 30 ? 60 : 0)}
      >
        <Sleep width={13} height={13} />
        {sleep > 0 ? ` ${sleep}` : ''}
      </button>
    </div>
  )
}

/** Everything else that is making a noise: a line each. */
function Row({ item, onClose }: { item: Playing; onClose: () => void }) {
  return (
    <div
      className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-[var(--surface-hover)]"
      style={{ borderRadius: 'var(--radius-md)', transition: 'background var(--t-fast) linear' }}
    >
      <Art item={item} size={34} />

      <button
        className="min-w-0 flex-1 text-left"
        title={t('Перейти к вкладке')}
        onClick={() => {
          void window.browser.switchTab(item.tabId)
          onClose()
        }}
      >
        <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
        <span className="flex items-center gap-1.5 text-2xs text-faint">
          <span style={{ color: item.playing ? 'var(--accent)' : undefined }}>
            <Eq on={item.playing && !item.muted} />
          </span>
          <span className="truncate">{item.artist || item.host}</span>
        </span>
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
  const playing = list.some((item) => item.playing && !item.muted)

  return (
    <button
      className="icon-btn shrink-0"
      title={t('Сейчас играет')}
      style={{ color: playing ? 'var(--accent)' : undefined }}
      onClick={(event) => onOpen(Math.round(event.currentTarget.getBoundingClientRect().left))}
    >
      {/* The bars move while the music does; otherwise they stand still,
          which says «paused, and still here» in one glance. */}
      <span className="flex h-[15px] items-center">
        <Eq on={playing} />
      </span>
    </button>
  )
}
