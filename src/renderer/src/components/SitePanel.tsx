import { t } from '../i18n'
import { useEffect, useState } from 'react'
import type { PermissionKey, PermissionPolicy, SiteInfo } from '../../../shared/types'
import { Lock, Shield, Unlock } from './Icons'
import { cx } from './ui'

/** The permissions worth a row, in the order they are usually thought about. */
const PERMISSIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: 'camera', label: 'Камера' },
  { key: 'microphone', label: 'Микрофон' },
  { key: 'geolocation', label: 'Местоположение' },
  { key: 'notifications', label: 'Уведомления' },
  { key: 'clipboard', label: 'Буфер обмена' },
  { key: 'midi', label: 'MIDI-устройства' },
  { key: 'usb', label: 'USB-устройства' },
  { key: 'fullscreen', label: 'Полный экран' },
  { key: 'download', label: 'Загрузки' }
]

const POLICY_LABEL: Record<PermissionPolicy, string> = {
  allow: 'Разрешить',
  ask: 'Спрашивать',
  block: 'Запретить'
}

/**
 * What this site is allowed to do, under the padlock where the question comes
 * up.
 *
 * The settings page answers for every site at once; this answers for the one in
 * front of you. A row left on "as everywhere else" writes nothing down — the
 * exception list stays a list of decisions rather than a copy of the settings.
 */
export default function SitePanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<SiteInfo | null>(null)

  const refresh = () => window.browser.siteInfo().then(setInfo)
  useEffect(() => {
    void refresh()
  }, [])

  if (!info) return null

  const set = async (patch: Parameters<typeof window.browser.setSite>[1], reload = false) => {
    await window.browser.setSite(info.host, patch, reload)
    await refresh()
  }

  const zoomPercent = Math.round(1.2 ** info.zoom * 100)

  return (
    <div className="absolute inset-0 z-40" onClick={onClose}>
      <div
        className="animate-sheet contain absolute left-1/2 top-[52px] w-[min(430px,94vw)] -translate-x-1/2 overflow-hidden rounded-card"
        style={{
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)',
          backdropFilter: 'blur(30px) saturate(180%)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* ------------------------------------------------------- the site */}
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-3.5">
          {info.secure ? (
            <Lock width={16} height={16} style={{ color: 'var(--good)' }} />
          ) : (
            <Unlock width={16} height={16} style={{ color: 'var(--warn)' }} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{info.host}</span>
            <span className="block truncate text-2xs text-faint">
              {info.secure ? t('Соединение защищено') : t('Соединение не защищено')}
            </span>
          </span>
        </div>

        {/* --------------------------------------------------- the blocker */}
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={info.rules.blocking !== 'off'}
              onChange={(event) =>
                void set({ blocking: event.target.checked ? undefined : 'off' }, true)
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{t('Блокировка на этом сайте')}</span>
              <span className="block text-2xs text-faint">
                {info.rules.blocking === 'off'
                  ? t('Выключена — страница загружается как есть')
                  : t('Заблокировано на этой вкладке: {n}', { n: info.blocked })}
              </span>
            </span>
            <Shield
              width={15}
              height={15}
              style={{ color: info.rules.blocking === 'off' ? 'var(--faint)' : 'var(--good)' }}
            />
          </label>
        </div>

        {/* ------------------------------------------------------- the zoom */}
        <div
          className="flex items-center gap-2 border-t px-4 py-2.5"
          style={{ borderColor: 'var(--line)' }}
        >
          <span className="min-w-0 flex-1 text-sm text-ink">{t('Масштаб')}</span>
          <button className="icon-btn h-7 w-7" onClick={() => void set({ zoom: info.zoom - 0.5 })}>
            −
          </button>
          <span className="w-[46px] text-center text-sm tabular-nums text-dim">{zoomPercent}%</span>
          <button className="icon-btn h-7 w-7" onClick={() => void set({ zoom: info.zoom + 0.5 })}>
            +
          </button>
        </div>

        {/* ------------------------------------------------ the permissions */}
        <div className="max-h-[46vh] overflow-y-auto border-t" style={{ borderColor: 'var(--line)' }}>
          {PERMISSIONS.map(({ key, label }) => {
            const own = info.rules.permissions?.[key]
            const fallback = info.defaults[key]
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-dim" title={t(label)}>
                  {t(label)}
                </span>
                <div
                  className="flex shrink-0 gap-0.5 rounded-[9px] p-0.5"
                  style={{ background: 'var(--field-idle)' }}
                >
                  {(['allow', 'ask', 'block'] as PermissionPolicy[]).map((policy) => {
                    const chosen = own === policy
                    // Nothing decided for this site: the answer the settings would
                    // give is outlined rather than filled, so it reads as inherited
                    // and not as a choice someone made here.
                    const inherited = own === undefined && fallback === policy
                    return (
                      <button
                        key={policy}
                        title={
                          inherited
                            ? t('Как в общих настройках')
                            : chosen
                              ? t('Нажмите ещё раз, чтобы вернуть общую настройку')
                              : t(POLICY_LABEL[policy])
                        }
                        className={cx('rounded-[7px] px-2.5 py-[3px] text-2xs')}
                        style={{
                          background: chosen ? 'var(--accent)' : 'transparent',
                          color: chosen ? '#fff' : inherited ? 'var(--ink)' : 'var(--faint)',
                          outline: inherited ? '1px dashed var(--line-strong)' : 'none',
                          outlineOffset: -1
                        }}
                        onClick={() =>
                          void set({ permissions: { [key]: chosen ? undefined : policy } })
                        }
                      >
                        {t(POLICY_LABEL[policy])}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--line)' }}>
          <p className="pb-1.5 text-center text-2xs text-faint">
            {t('Пунктиром отмечено то, что задано в общих настройках')}
          </p>
          <button
            className="w-full text-center text-sm text-faint hover:text-dim"
            onClick={async () => {
              await window.browser.clearSite(info.host)
              onClose()
            }}
          >
            {t('Сбросить настройки сайта')}
          </button>
        </div>
      </div>
    </div>
  )
}
