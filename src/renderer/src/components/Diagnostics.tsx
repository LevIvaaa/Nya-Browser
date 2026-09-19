import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { NetworkCheck, PageFailure } from '../../../shared/types'
import { Alert, Refresh, Zap } from './Icons'
import { Row, Section } from './ui'
import { Checks } from './Checks'

/**
 * Why a page would not open, and whether it was the browser's fault.
 *
 * Three answers in one place, because they are the three things anybody asks
 * in that order. Is my connection alright — a check that says which of the
 * four links in the chain is broken rather than printing «offline». What
 * failed lately — the addresses and the codes, so «it stopped working
 * yesterday» has a date on it. And, when nothing else explains it, a restart
 * with everything switched off, which is the one test that tells an extension
 * apart from a browser.
 */
export function Diagnostics({ flash }: { flash: (message: string) => void }) {
  const [check, setCheck] = useState<NetworkCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [failures, setFailures] = useState<PageFailure[]>([])
  const [safe, setSafe] = useState(false)

  useEffect(() => {
    void window.browser.safeStart().then(setSafe)
  }, [])

  /*
   * The log has to keep up with what is failing.
   *
   * Reading it once when the page mounts was wrong in the only case that
   * matters: somebody opens the settings, goes and finds a page that will not
   * load, comes back — and is told «ни одна страница не упала» while the
   * browser is holding two failures. Every failure also changes a tab (it is
   * what puts the error on it), so the tab broadcast is exactly the beat to
   * re-read on, and it costs nothing when nothing is failing.
   */
  useEffect(() => {
    const read = () => void window.browser.pageFailures().then(setFailures)
    read()
    return window.browser.onTabs(read)
  }, [])

  const run = async () => {
    setChecking(true)
    try {
      setCheck(await window.browser.checkNetwork())
    } finally {
      setChecking(false)
    }
  }

  const VERDICT: Record<NetworkCheck['verdict'], string> = {
    offline: t('Компьютер не видит сети'),
    'no-internet': t('Сеть есть, но наружу ничего не проходит'),
    'no-dns': t('Имена сайтов не разрешаются — виноват DNS'),
    'site-down': t('Не отвечает сам сайт'),
    fine: t('Связь, имена и внешние сайты в порядке')
  }

  return (
    <>
      <Section
        title={t('Диагностика')}
        icon={<Alert width={15} height={15} />}
        description={t('Что проверить, когда страницы перестали открываться')}
      >
        <Row
          title={t('Проверить сеть')}
          hint={
            check
              ? VERDICT[check.verdict]
              : t('Связь, имена и доступ наружу — по очереди')
          }
        >
          <button className="btn" onClick={run} disabled={checking}>
            {checking ? t('Проверяем…') : t('Проверить')}
          </button>
        </Row>

        {check && (
          <Row title={t('Что ответило')} hint={new Date(check.at).toLocaleTimeString()}>
            <Checks check={check} />
          </Row>
        )}

        <Row
          title={t('Безопасный запуск')}
          hint={
            safe
              ? t('Сейчас браузер работает без расширений, ускорения, фильтров и восстановления вкладок')
              : t('Перезапуск без расширений, ускорения и фильтров: если так всё работает, дело в одном из них')
          }
        >
          <button
            className="btn"
            onClick={() => {
              flash(safe ? t('Перезапуск…') : t('Перезапускаем без расширений…'))
              void window.browser.restartBrowser(!safe)
            }}
          >
            {safe ? t('Обычный запуск') : t('Перезапустить')}
          </button>
        </Row>
      </Section>

      <Section
        title={t('Журнал ошибок страниц')}
        icon={<Zap width={15} height={15} />}
        description={t('Что не открылось с момента запуска')}
        action={
          failures.length > 0 ? (
            <button
              className="btn"
              onClick={() => {
                void window.browser.clearPageFailures()
                setFailures([])
              }}
            >
              {t('Очистить')}
            </button>
          ) : (
            <button
              className="btn"
              title={t('Обновить')}
              onClick={() => void window.browser.pageFailures().then(setFailures)}
            >
              <Refresh width={14} height={14} />
            </button>
          )
        }
      >
        {failures.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <span
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-[12px]"
              style={{
                background: 'color-mix(in srgb, var(--good) 12%, transparent)',
                color: 'var(--good)'
              }}
            >
              <Zap width={16} height={16} />
            </span>
            <div className="text-sm font-medium">{t('Пока пусто')}</div>
            <div className="mt-0.5 text-2xs text-faint">
              {t('Ни одна страница в этом запуске не упала')}
            </div>
          </div>
        ) : (
          failures.slice(0, 40).map((one, index) => <Failure key={index} one={one} />)
        )}
      </Section>
    </>
  )
}

/**
 * One page that would not load.
 *
 * A failure is three facts and they have different weights: which site (the
 * thing being looked for), what happened (the thing to act on) and when. So
 * the host is set in ordinary type, the path behind it is dimmed to a
 * subtitle, the sentence sits under them, and the code — the part only a
 * search engine wants — is a quiet badge at the end rather than the first
 * thing the eye hits.
 *
 * Pressing the row opens the address again, because trying it once more is
 * the next thing anybody does.
 */
function Failure({ one }: { one: PageFailure }) {
  let host = one.url
  let rest = ''
  try {
    const parsed = new URL(one.url)
    host = parsed.hostname.replace(/^www\./, '')
    rest = (parsed.pathname + parsed.search).replace(/^\/$/, '')
  } catch {
    /* an address we cannot parse is shown whole */
  }

  return (
    <button
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--surface-hover)]"
      style={{ borderTop: '1px solid var(--line)', transition: 'background var(--t-fast) linear' }}
      title={t('Открыть во вкладке')}
      onClick={() => void window.browser.newTab(one.url)}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
        style={{
          background: 'color-mix(in srgb, var(--bad) 12%, transparent)',
          color: 'var(--bad)'
        }}
      >
        <Alert width={14} height={14} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="truncate text-sm font-medium">{host}</span>
          {rest && <span className="truncate text-2xs text-faint">{rest}</span>}
        </span>
        <span className="mt-0.5 block truncate text-2xs text-dim">
          {one.reason || one.description}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-2xs tabular-nums text-faint">
          {new Date(one.at).toLocaleTimeString()}
        </span>
        <span
          className="mt-0.5 inline-block rounded-pill px-1.5 font-mono text-[10px]"
          style={{ background: 'var(--field-idle)', color: 'var(--text-faint)' }}
        >
          {one.code}
        </span>
      </span>
    </button>
  )
}
