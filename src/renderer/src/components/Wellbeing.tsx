import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import type { UsageSpan, UsageSummary } from '../../../shared/types'

/**
 * Where the evening went.
 *
 * The browser counts the time it is actually looked at — window in front, a
 * site in the tab — and keeps two things: the day and the host. This is the
 * reading of it: one large number, the last days as a row of columns beside
 * it, and the sites beneath in the order they took the time.
 *
 * Drawn as one card rather than a list of settings rows, because nothing here
 * is set: it is looked at.
 */
type Period = 'today' | 'week' | 'month'

const PERIODS: Array<{ id: Period; label: string; days: number }> = [
  { id: 'today', label: 'Сегодня', days: 7 },
  { id: 'week', label: 'Неделя', days: 7 },
  { id: 'month', label: 'Месяц', days: 30 }
]

/** 2 ч 05 мин, 7 мин, or a dash for less than a minute. */
function spell(seconds: number): string {
  if (seconds < 60) return '—'
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} ${t('мин')}`
  return `${hours} ${t('ч')} ${String(rest).padStart(2, '0')} ${t('мин')}`
}

const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export function Wellbeing() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [period, setPeriod] = useState<Period>('today')

  const refresh = () => void window.browser.usage().then(setSummary)
  useEffect(refresh, [])

  const span: UsageSpan = summary ? summary[period] : { seconds: 0, sites: [] }
  const shown = PERIODS.find((p) => p.id === period) ?? PERIODS[0]
  const bars = useMemo(() => {
    const trend = summary?.trend ?? []
    return trend.slice(Math.max(0, trend.length - shown.days))
  }, [summary, shown.days])
  const tallest = Math.max(1, ...bars.map((b) => b.seconds))
  const top = span.sites[0]?.seconds ?? 0
  const wide = bars.length > 7

  return (
    <section className="animate-fade-up contain">
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-6 px-5 pb-5 pt-5">
          {/* how long */}
          <div className="min-w-0">
            <div className="text-sm text-dim">{t(shown.label)}</div>
            <div className="mt-1 text-[38px] font-semibold leading-none tracking-[-0.03em]">
              {spell(span.seconds)}
            </div>
            <div className="mt-2 text-sm text-dim">
              {span.sites.length > 0
                ? `${span.sites.length} ${t('сайтов')}`
                : t('Ничего не найдено')}
            </div>
          </div>

          {/* which days, and the switch above them */}
          <div className="flex flex-col items-end gap-4">
            <div className="flex gap-1 rounded-[var(--radius-md)] p-1" style={{ background: 'var(--field-idle)' }}>
              {PERIODS.map((item) => (
                <button
                  key={item.id}
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
                  style={{
                    background: period === item.id ? 'var(--surface-solid)' : 'transparent',
                    color: period === item.id ? 'var(--text)' : 'var(--text-dim)',
                    boxShadow: period === item.id ? 'var(--shadow-sm)' : 'none',
                    transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
                  }}
                  onClick={() => setPeriod(item.id)}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>

            <div className="flex items-end" style={{ gap: wide ? 3 : 6, height: 74 }}>
              {bars.map((bar, index) => {
                const last = index === bars.length - 1
                const height = bar.seconds > 0 ? Math.max(5, Math.round((bar.seconds / tallest) * 56)) : 3
                return (
                  <div
                    key={bar.day}
                    className="flex flex-col items-center justify-end"
                    style={{ width: wide ? 9 : 26, height: '100%' }}
                    title={spell(bar.seconds)}
                  >
                    <div
                      style={{
                        width: '100%',
                        height,
                        borderRadius: 999,
                        background: last
                          ? 'var(--accent)'
                          : bar.seconds > 0
                            ? 'color-mix(in srgb, var(--accent) 34%, transparent)'
                            : 'var(--field-idle)',
                        transition: 'height var(--t-slow) var(--ease-emph)'
                      }}
                    />
                    {!wide && (
                      <span className="mt-2 text-2xs text-faint">{WEEKDAYS[new Date(bar.day).getDay()]}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* and where it went */}
        {span.sites.slice(0, 8).map((site, index) => (
          <div
            key={site.host}
            className="flex items-center gap-3.5 px-5 py-3"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <span
              className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-2xs font-semibold"
              style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-base">{site.host}</span>
                <span className="shrink-0 text-sm text-dim">{spell(site.seconds)}</span>
              </div>
              <div className="mt-2 h-[4px] overflow-hidden rounded-pill" style={{ background: 'var(--field-idle)' }}>
                <div
                  style={{
                    width: `${top > 0 ? Math.max(4, Math.round((site.seconds / top) * 100)) : 0}%`,
                    height: '100%',
                    borderRadius: 999,
                    background:
                      index === 0
                        ? 'var(--accent)'
                        : 'color-mix(in srgb, var(--accent) 52%, transparent)',
                    transition: 'width var(--t-slow) var(--ease-emph)'
                  }}
                />
              </div>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between gap-4 px-5 py-3.5" style={{ borderTop: '1px solid var(--line)' }}>
          <span className="text-sm text-dim">{t('Считается только время, когда окно перед глазами')}</span>
          <button
            className="btn"
            onClick={() => {
              void window.browser.clearUsage().then(refresh)
            }}
          >
            {t('Очистить')}
          </button>
        </div>
      </div>
    </section>
  )
}
