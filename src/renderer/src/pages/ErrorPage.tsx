import { t } from '../i18n'
import type { TabError } from '../../../shared/types'
import { Alert, Reload, Shield } from '../components/Icons'

const HINTS: Record<number, string> = {
  [-2]: 'Не удалось обработать ответ сервера.',
  [-6]: 'Файл не найден.',
  [-7]: 'Сервер слишком долго не отвечает.',
  [-21]: 'Сеть изменилась во время загрузки.',
  [-100]: 'Соединение закрыто сервером.',
  [-101]: 'Соединение сброшено.',
  [-102]: 'Сервер отказался от соединения.',
  [-105]: 'Не удалось найти адрес — проверьте имя сайта.',
  [-106]: 'Нет подключения к интернету.',
  [-107]: 'Ошибка защищённого соединения (TLS).',
  [-118]: 'Время ожидания соединения истекло.',
  [-200]: 'Сертификат сайта выдан на другое имя.',
  [-201]: 'Срок действия сертификата истёк.',
  [-202]: 'Сертификат выдан недоверенным центром.',
  [-501]: 'Ответ сервера небезопасен.'
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
          {HINTS[error.code] ? t(HINTS[error.code]) : error.description}
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

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button className="btn btn-primary" onClick={() => window.browser.reload()}>
            <Reload width={15} height={15} />
            {t('Попробовать снова')}
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
      </div>
    </div>
  )
}
