import { t } from '../i18n'
import type { TabState } from '../../../shared/types'
import { Copy, Download, Globe, Grid, Minus, Plus, Printer, Search } from './Icons'

/**
 * What can be done with the page that is open, next to the address it is at.
 *
 * The browser's own menu, two centimetres to the right, is about the browser:
 * tabs, history, settings. This one is about the document — translate it, make
 * it bigger, find something in it, keep it. Keeping the two apart is why the
 * address bar has a button of its own rather than one menu with everything in
 * it.
 */
export default function PageMenu({
  tab,
  x,
  onClose,
  onFind
}: {
  tab: TabState | undefined
  /** where the button that opened this sits, so the card opens under it */
  x: number
  onClose: () => void
  onFind: () => void
}) {
  const width = 300
  const left = Math.max(8, Math.min(x - width + 28, window.innerWidth - width - 8))
  const usable = Boolean(tab?.hasContent) && /^https?:/i.test(tab?.url ?? '')

  const item = (icon: React.ReactNode, label: string, action: () => void, enabled = true) => (
    <button
      key={label}
      disabled={!enabled}
      onClick={() => {
        action()
        onClose()
      }}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-base hover:bg-[var(--surface-hover)] disabled:opacity-40"
      style={{ transition: 'background var(--t-fast) linear' }}
    >
      <span className="text-dim">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )

  // Chromium keeps zoom as a level, where each step is 1.2×; people read it as
  // a percentage, so that is what the row shows.
  const percent = Math.round(Math.pow(1.2, tab?.zoom ?? 0) * 100)

  return (
    <>
      <div
        className="animate-fade fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--bg) 40%, transparent)' }}
        onClick={onClose}
      />
      <div
        className="animate-fade-down contain absolute z-50 overflow-hidden rounded-card"
        style={{
          top: 46,
          left,
          width,
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
      >
        <div className="py-1.5">
          {item(
            <Globe width={15} height={15} />,
            tab?.translated ? t('Показать оригинал') : t('Перевести страницу'),
            () => void window.browser.translatePage(),
            usable
          )}

          <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />

          <div className="flex items-center gap-3 px-3 py-1.5">
            <span className="text-dim">
              <Search width={15} height={15} />
            </span>
            <span className="flex-1 text-base">{t('Масштаб')}</span>
            <span className="flex items-center gap-1">
              <button
                className="flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--surface-hover)]"
                onClick={() => void window.browser.zoom(-1)}
                aria-label={t('Мельче')}
              >
                <Minus width={13} height={13} />
              </button>
              <button
                className="min-w-[52px] rounded-[7px] px-1 py-1 text-center text-sm tabular-nums hover:bg-[var(--surface-hover)]"
                onClick={() => void window.browser.zoom('reset')}
                title={t('Обычный размер')}
              >
                {percent}%
              </button>
              <button
                className="flex h-7 w-7 items-center justify-center rounded-[7px] hover:bg-[var(--surface-hover)]"
                onClick={() => void window.browser.zoom(1)}
                aria-label={t('Крупнее')}
              >
                <Plus width={13} height={13} />
              </button>
            </span>
          </div>

          <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />

          {item(<Search width={15} height={15} />, t('Найти на странице'), onFind, usable)}
          {item(
            <Grid width={15} height={15} />,
            t('Добавить на главную'),
            () => void window.browser.addToHome(),
            usable
          )}
          {item(
            <Copy width={15} height={15} />,
            t('Скопировать адрес'),
            () => void window.browser.copyText(tab?.url ?? ''),
            usable
          )}
          {item(
            <Download width={15} height={15} />,
            t('Сохранить'),
            () => void window.browser.savePage(),
            usable
          )}
          {item(<Printer width={15} height={15} />, t('Печать'), () => void window.browser.print(), usable)}
        </div>
      </div>
    </>
  )
}
