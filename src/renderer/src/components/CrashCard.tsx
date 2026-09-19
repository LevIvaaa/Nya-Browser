import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { CrashReport } from '../../../shared/types'
import { Alert, Cross } from './Icons'

/**
 * What the last run left behind.
 *
 * A browser that closed badly has exactly one thing worth saying about it, and
 * it is not an apology: here are the pages that were open, do you want them
 * back. It waits a couple of seconds so it does not land on top of the window
 * still being painted, sits in the corner with the other notices, and answers
 * once — there is no second asking.
 */
export default function CrashCard() {
  const [report, setReport] = useState<CrashReport | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      void window.browser.lastCrash().then((found) => {
        // A run that crashed before it opened anything has nothing to offer
        // back, and a bare «we crashed» is a worry with no action in it.
        if (found && found.tabs.length > 0) setReport(found)
      })
    }, 2500)
    return () => clearTimeout(timer)
  }, [])

  if (!report) return null

  const close = () => {
    setReport(null)
    void window.browser.dismissCrash()
  }

  const restore = () => {
    for (const url of report.tabs.slice(0, 20)) void window.browser.newTab(url)
    close()
  }

  return (
    <div
      className="animate-slide-down contain fixed right-3 top-[46px] z-40 w-[330px] overflow-hidden rounded-card"
      style={{
        background: 'var(--elevated)',
        border: '1px solid color-mix(in srgb, var(--warn) 45%, transparent)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(30px) saturate(180%)'
      }}
    >
      <div className="flex items-start gap-2.5 px-3.5 pb-2 pt-3">
        <Alert width={16} height={16} style={{ color: 'var(--warn)' }} className="mt-[1px] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium">{t('Прошлый запуск завершился неожиданно')}</div>
          <div className="mt-0.5 text-sm leading-snug text-dim">
            {t('Было открыто вкладок: {count}. Вернуть их?', { count: String(report.tabs.length) })}
          </div>
        </div>
        <button className="icon-btn h-6 w-6 shrink-0" aria-label={t('Закрыть')} onClick={close}>
          <Cross width={12} height={12} />
        </button>
      </div>

      {/* The first few addresses, so «вернуть» is a choice and not a leap. */}
      <div className="px-3.5 pb-2">
        {report.tabs.slice(0, 3).map((url, index) => (
          <div key={index} className="truncate text-2xs text-faint">
            {url.replace(/^https?:\/\//, '')}
          </div>
        ))}
        {report.tabs.length > 3 && (
          <div className="text-2xs text-faint">
            {t('и ещё {count}', { count: String(report.tabs.length - 3) })}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 px-3.5 pb-3">
        <button className="btn btn-primary flex-1" onClick={restore}>
          {t('Вернуть вкладки')}
        </button>
        <button className="btn" onClick={close}>
          {t('Не надо')}
        </button>
      </div>
    </div>
  )
}
