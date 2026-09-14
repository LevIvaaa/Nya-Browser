import { useEffect, useState } from 'react'
import { Row } from './ui'
import { t } from '../i18n'
import type { UsageSpan, UsageSummary } from '../../../shared/types'

/**
 * Where the evening went.
 *
 * The browser counts the time it is actually looked at — window in front, a
 * site in the tab — and keeps two things: the day and the host. This shows it
 * back, for today, the week and the month, and offers to forget all of it.
 */
type Period = 'today' | 'week' | 'month'

const LABEL: Record<Period, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Месяц'
}

/** 2 ч 05 мин, 7 мин, or a dash for nothing at all. */
function spell(seconds: number): string {
  if (seconds < 60) return '—'
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} ${t('мин')}`
  return `${hours} ${t('ч')} ${String(rest).padStart(2, '0')} ${t('мин')}`
}

export function Wellbeing() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [period, setPeriod] = useState<Period>('today')

  const refresh = () => void window.browser.usage().then(setSummary)
  useEffect(refresh, [])

  const span: UsageSpan = summary ? summary[period] : { seconds: 0, sites: [] }
  const top = span.sites[0]?.seconds ?? 0

  return (
    <>
      <div className="flex gap-2 px-4 py-3">
        {(['today', 'week', 'month'] as Period[]).map((id) => (
          <button
            key={id}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium"
            style={{
              background: period === id ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--field-idle)',
              color: period === id ? 'var(--accent)' : 'var(--text-dim)'
            }}
            onClick={() => setPeriod(id)}
          >
            {t(LABEL[id])}
          </button>
        ))}
      </div>

      <Row title={t('Всего')}>
        <span className="text-base font-semibold">{spell(span.seconds)}</span>
      </Row>

      {span.sites.length === 0 ? (
        <Row title={t('Ничего не найдено')} />
      ) : (
        span.sites.slice(0, 10).map((site) => (
          <div key={site.host} className="px-4 py-2.5" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-base">{site.host}</span>
              <span className="shrink-0 text-sm text-dim">{spell(site.seconds)}</span>
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-pill" style={{ background: 'var(--field-idle)' }}>
              <div
                style={{
                  width: `${top > 0 ? Math.max(3, Math.round((site.seconds / top) * 100)) : 0}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--accent)'
                }}
              />
            </div>
          </div>
        ))
      )}

      <div className="flex justify-end px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
        <button
          className="btn"
          onClick={() => {
            void window.browser.clearUsage().then(refresh)
          }}
        >
          {t('Очистить')}
        </button>
      </div>
    </>
  )
}
