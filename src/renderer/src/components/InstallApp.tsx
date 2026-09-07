import { t } from '../i18n'
import { useState } from 'react'
import type { WebAppCandidate } from '../../../shared/types'
import { Install } from './Icons'

/**
 * The question before a site becomes an app.
 *
 * Installing writes a shortcut to the desktop and the Start menu, puts the site
 * in the list Windows shows under installed apps, and gives it a window with no
 * tab strip. That is enough happening for one click of a small icon to be
 * asked about first — and it is also the only place the browser can say what
 * "install" is going to mean here.
 */
export default function InstallApp({
  candidate,
  onClose
}: {
  candidate: WebAppCandidate | null
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!candidate) return null

  let host = candidate.startUrl
  try {
    host = new URL(candidate.startUrl).host
  } catch {
    /* the address is shown as it came */
  }

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center" onClick={onClose}>
      <div
        className="animate-fade absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 45%, transparent)' }}
      />
      <div
        className="animate-sheet relative mt-[64px] w-[min(400px,92vw)] rounded-card p-5"
        style={{
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px]"
            style={{ background: 'var(--field-idle)' }}
          >
            <img src={candidate.icon} alt="" className="h-8 w-8 object-contain" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-semibold text-ink">{candidate.name}</span>
            <span className="block truncate text-sm text-faint">{host}</span>
          </span>
        </div>

        <p className="mt-4 text-sm text-dim">
          {t('Появится ярлык на рабочем столе и в меню «Пуск», отдельная строка в списке установленных приложений Windows и своё окно без вкладок.')}
        </p>

        {failed && (
          <p className="mt-2 text-sm" style={{ color: 'var(--bad)' }}>
            {t('Не удалось установить — сайт не отдал значок')}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('Отмена')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setFailed(false)
              const installed = await window.browser.installApp()
              setBusy(false)
              if (installed) onClose()
              else setFailed(true)
            }}
          >
            <Install width={15} height={15} />
            {busy ? t('Устанавливаем…') : t('Установить')}
          </button>
        </div>
      </div>
    </div>
  )
}
