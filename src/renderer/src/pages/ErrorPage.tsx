import { useState } from 'react'
import { t } from '../i18n'
import type { NetworkCheck, TabError } from '../../../shared/types'
import { NET_HINTS } from '../../../shared/neterrors'
import { Alert, Reload, Shield } from '../components/Icons'

/**
 * What the check found, said as one sentence with something to do in it.
 *
 * The point of the check is not to print three booleans: it is to answer the
 * only question anybody has — is it me, my connection, or the site — and to
 * stop somebody rebooting a router because one server is down.
 */
function verdictWords(check: NetworkCheck): { title: string; detail: string } {
  switch (check.verdict) {
    case 'offline':
      return {
        title: t('Сети нет'),
        detail: t('Компьютер не видит подключения: проверьте Wi-Fi или кабель.')
      }
    case 'no-internet':
      return {
        title: t('Подключение есть, интернета нет'),
        detail: t('Сеть на месте, но за её пределы ничего не проходит. Так бывает за порталом гостевого Wi-Fi, который ждёт входа, и при неверных настройках прокси.')
      }
    case 'no-dns':
      return {
        title: t('Имена сайтов не разрешаются'),
        detail: t('Интернет есть, но адреса не превращаются в номера. Виноват DNS-сервер: попробуйте выбрать другой в настройках, раздел «Сеть».')
      }
    case 'site-down':
      return {
        title: t('Не отвечает только этот сайт'),
        detail: t('С вашей стороны всё в порядке — не отвечает сам сайт. Остаётся подождать.')
      }
    default:
      return {
        title: t('Сеть в порядке'),
        detail: t('Связь, имена и внешние сайты отвечают. Значит, дело в самой странице: попробуйте ещё раз или загляните позже.')
      }
  }
}


export default function ErrorPage({ error }: { error: TabError }) {
  const host = (() => {
    try {
      return new URL(error.url).host
    } catch {
      return error.url
    }
  })()
  const certificate = error.code <= -200 && error.code >= -299
  // Only a certificate the browser actually looked at can be answered for:
  // the details below are the ones it refused, not a guess from the code.
  const refused = error.certificate

  // What is already said in large type under the heading. The card below
  // repeats the code and the address on purpose — they are there to be copied
  // — but repeating the one sentence a person actually reads, word for word,
  // twelve lines apart, made the page look like it had a bug in it.
  const said = NET_HINTS[error.code] ? t(NET_HINTS[error.code]) : error.description
  const extra = error.reason && error.reason !== said ? error.reason : ''

  const [check, setCheck] = useState<NetworkCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const diagnose = async () => {
    setChecking(true)
    try {
      setCheck(await window.browser.checkNetwork(host))
    } finally {
      setChecking(false)
    }
  }
  const words = check ? verdictWords(check) : null

  return (
    <div className="relative z-10 flex h-full items-center justify-center overflow-y-auto px-6 py-10">
      <div className="animate-fade-up w-full max-w-[560px] text-center">
        <span
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-[18px]"
          style={{
            background: `color-mix(in srgb, ${certificate ? 'var(--bad)' : 'var(--warn)'} 14%, transparent)`,
            color: certificate ? 'var(--bad)' : 'var(--warn)'
          }}
        >
          {certificate ? <Shield width={26} height={26} /> : <Alert width={26} height={26} />}
        </span>

        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">
          {certificate ? t('Соединение не защищено') : t('Страница не открылась')}
        </h1>
        <p className="mx-auto mt-2 max-w-[440px] text-base text-dim">
          {said}
        </p>

        <div
          className="mx-auto mt-5 rounded-card px-4 py-3 text-left"
          style={{ background: 'var(--field-idle)', border: '1px solid var(--line)' }}
        >
          <div className="text-2xs uppercase tracking-wider text-faint">{t('Адрес')}</div>
          <div className="truncate text-sm">{host}</div>
          <div className="mt-2 text-2xs uppercase tracking-wider text-faint">{t('Код ошибки')}</div>
          <div className="font-mono text-xs text-dim">
            {error.code} · {error.description}
          </div>
          {extra && (
            <>
              <div className="mt-2 text-2xs uppercase tracking-wider text-faint">
                {t('Что это значит')}
              </div>
              <div className="text-sm text-dim">{extra}</div>
            </>
          )}

          {refused && (
            <>
              <div className="mt-2 text-2xs uppercase tracking-wider text-faint">
                {t('Кем выдан')}
              </div>
              <div className="truncate text-sm text-dim">{refused.issuer || t('Неизвестно')}</div>
              <div className="mt-2 text-2xs uppercase tracking-wider text-faint">
                {t('Отпечаток сертификата')}
              </div>
              <div className="break-all font-mono text-2xs text-dim">{refused.fingerprint}</div>
            </>
          )}
        </div>

        {/* The whole of the diagnosis, and it stays where it was asked for. */}
        {words && (
          <div
            className="animate-fade-up mx-auto mt-4 rounded-card px-4 py-3 text-left"
            style={{
              background: 'var(--field-idle)',
              border: `1px solid ${check?.verdict === 'fine' ? 'var(--line)' : 'var(--warn)'}`
            }}
          >
            <div className="text-sm font-semibold">{words.title}</div>
            <p className="mt-1 text-sm text-dim">{words.detail}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-faint">
              <span>{t('связь')}: {check?.online ? '✓' : '✗'}</span>
              <span>{t('имена')}: {check?.dns ? '✓' : '✗'}</span>
              <span>{t('интернет')}: {check?.internet ? '✓' : '✗'}</span>
              {check?.site !== null && <span>{t('сайт')}: {check?.site ? '✓' : '✗'}</span>}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            className="btn btn-primary"
            onClick={() => (error.crashed ? window.browser.navigate(error.url) : window.browser.reload())}
          >
            <Reload width={15} height={15} />
            {error.crashed ? t('Открыть заново') : t('Попробовать снова')}
          </button>
          <button className="btn" onClick={diagnose} disabled={checking}>
            {checking ? t('Проверяем…') : t('Проверить сеть')}
          </button>
          <button className="btn" onClick={() => window.browser.home()}>
            {t('На стартовую')}
          </button>
          {error.httpsFallbackAvailable && (
            <button className="btn" onClick={() => window.browser.continueOverHttp()}>
              {t('Открыть без шифрования')}
            </button>
          )}
          {refused && (
            <button className="btn" onClick={() => window.browser.proceedPastCertificate()}>
              {t('Всё равно перейти')}
            </button>
          )}
        </div>

        {refused && (
          <p className="mx-auto mt-4 max-w-[440px] text-sm text-faint">
            {t('Браузер не смог подтвердить, что этот сертификат принадлежит сайту. Так выглядит и обычная ошибка настройки, и попытка встать между вами и сайтом. Если перейдёте, исключение будет только для этого адреса и только до перезапуска браузера.')}
          </p>
        )}

        {error.httpsFallbackAvailable && (
          <p className="mx-auto mt-4 max-w-[440px] text-sm text-faint">
            {t('Браузер попытался открыть сайт по HTTPS, но у него нет защищённой версии. Без шифрования данные видны в сети — не вводите на такой странице пароли и карты.')}
          </p>
        )}

        {error.crashed && (
          <p className="mx-auto mt-4 max-w-[440px] text-sm text-faint">
            {t('Страница закрылась сама: ей не хватило памяти или внутри произошёл сбой. Остальные вкладки это не затронуло — адрес сохранён, и его можно открыть заново.')}
          </p>
        )}
      </div>
    </div>
  )
}
