import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { TabCost } from '../../../preload/index'
import { Cross, Sleep, Volume } from '../components/Icons'
import { EmptyState, cx, formatBytes } from '../components/ui'

/**
 * What each tab is costing.
 *
 * The question people actually have is "why is this slow" or "why is the fan
 * on", and the answer is almost always one tab. Chromium's own task manager
 * answers it with a table of processes, which is the right answer to a
 * different question — so this lists tabs, by what they cost, with the two
 * buttons that do something about it.
 *
 * Memory is per process, and tabs on the same site share one. Two rows showing
 * the same number are not a bug; they are one process holding two pages, which
 * is what actually happens and what closing one of them will not fix.
 */
export default function TasksPage() {
  const [rows, setRows] = useState<TabCost[]>([])
  const [at, setAt] = useState(Date.now())

  useEffect(() => {
    let alive = true
    const read = async () => {
      const next = await window.browser.tabCosts()
      if (!alive) return
      setRows(next)
      setAt(Date.now())
    }
    void read()
    const timer = window.setInterval(read, 3000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const sorted = [...rows].sort((a, b) => b.memory - a.memory)
  const most = sorted[0]?.memory ?? 1
  const total = rows.reduce((sum, row) => sum + row.memory, 0)

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-6 py-8">
        <header className="animate-fade-up mb-5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Что тратит ресурсы')}</h1>
          <p className="text-sm text-dim">
            {rows.length} {t('вкладок')} · {formatBytes(total * 1024 * 1024)}
          </p>
        </header>

        {sorted.length === 0 ? (
          <EmptyState icon={<Sleep width={26} height={26} />} title={t('Пока нечего показывать')} />
        ) : (
          <div className="card stagger overflow-hidden">
            {sorted.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => window.browser.switchTab(row.id)}
                >
                  <span className="block truncate text-base font-medium">
                    {row.title || row.origin || t('Новая вкладка')}
                  </span>
                  <span className="block truncate text-sm text-dim">{row.origin}</span>
                  {/* The bar is against the heaviest tab, not against the
                      machine: what matters here is which one stands out. */}
                  <span
                    className="mt-1.5 block h-[3px] overflow-hidden rounded-pill"
                    style={{ background: 'var(--field-idle)' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: `${most > 0 ? Math.round((row.memory / most) * 100) : 0}%`,
                        height: '100%',
                        borderRadius: 999,
                        background: row.memory > most * 0.6 ? 'var(--warn)' : 'var(--accent)',
                        transition: 'width var(--t-slow) var(--ease-out)'
                      }}
                    />
                  </span>
                </button>

                {row.audible && (
                  <span className="shrink-0" style={{ color: 'var(--accent)' }} title={t('Звук')}>
                    <Volume width={14} height={14} />
                  </span>
                )}
                {row.sleeping && (
                  <span className="shrink-0 text-faint" title={t('Вкладка спит')}>
                    <Sleep width={14} height={14} />
                  </span>
                )}
                <span
                  className={cx(
                    'w-[92px] shrink-0 text-right text-sm tabular-nums',
                    row.memory > most * 0.6 ? 'font-medium' : 'text-dim'
                  )}
                >
                  {row.sleeping ? '—' : formatBytes(row.memory * 1024 * 1024)}
                </span>
                <button
                  className="btn h-[28px] shrink-0 px-2.5 text-sm"
                  disabled={row.sleeping}
                  onClick={() => window.browser.sleepTab(row.id)}
                >
                  <Sleep width={13} height={13} />
                  {t('Усыпить')}
                </button>
                <button
                  className="icon-btn shrink-0"
                  title={t('Закрыть вкладку')}
                  onClick={() => window.browser.closeTab(row.id)}
                >
                  <Cross width={14} height={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-4 text-sm text-faint">
          {t('Память считается на процесс — вкладки одного сайта делят его')}
        </p>
        <p className="mt-1 text-2xs text-faint tabular-nums">
          {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>
    </div>
  )
}
