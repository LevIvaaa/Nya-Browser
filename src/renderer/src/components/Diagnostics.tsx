import { useEffect, useState } from 'react'
import { t } from '../i18n'
import type { NetworkCheck, PageFailure } from '../../../shared/types'
import { Alert, Refresh, Zap } from './Icons'
import { Row, Section } from './ui'

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
              : t('Связь, DNS и доступ наружу — по очереди, чтобы стало видно, что именно сломалось')
          }
        >
          <button className="btn" onClick={run} disabled={checking}>
            {checking ? t('Проверяем…') : t('Проверить')}
          </button>
        </Row>

        {check && (
          <Row title={t('Что ответило')} hint={new Date(check.at).toLocaleTimeString()}>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-faint">
              <span>{t('связь')}: {check.online ? '✓' : '✗'}</span>
              <span>{t('имена')}: {check.dns ? '✓' : '✗'}</span>
              <span>{t('интернет')}: {check.internet ? '✓' : '✗'}</span>
            </div>
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
        description={t('Последние неудачные загрузки этого запуска. Никуда не записывается и не отправляется')}
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
          <Row title={t('Пока пусто')} hint={t('Ни одна страница в этом запуске не упала')} />
        ) : (
          failures.slice(0, 40).map((one, index) => (
            <Row
              key={index}
              title={one.url.replace(/^https?:\/\//, '').slice(0, 90)}
              hint={`${new Date(one.at).toLocaleTimeString()} · ${one.reason || one.description}`}
            >
              <span className="font-mono text-2xs text-faint">{one.code}</span>
            </Row>
          ))
        )}
      </Section>
    </>
  )
}
