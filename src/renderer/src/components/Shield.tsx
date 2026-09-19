/**
 * What was watching, what is known, and what was guarded.
 *
 * Three panels that between them answer the questions a privacy setting can
 * only gesture at. "Trackers blocked: 14 312" is a number; "doubleclick.net
 * tried forty-one times on this page" is a fact somebody can do something
 * with, and "this site has 38 cookies and knows your screen and time zone" is
 * the sentence that makes the abstract real.
 */
import { useEffect, useState } from 'react'
import { currentLanguage, t } from '../i18n'
import type { ProtectionReport, SiteKnows, Watcher } from '../../../shared/types'
import type { Warning } from '../../../shared/phishing'
import { Alert, Cross, Globe, Shield, Zap } from './Icons'
import { cx, formatBytes } from './ui'

/* ---------------------------------------------------------------- watchers */

const KIND_NAME: Record<Watcher['kind'], string> = {
  ad: 'Реклама',
  tracker: 'Трекер',
  crypto: 'Майнер',
  param: 'Метка в ссылке',
  upgrade: 'Поднято до HTTPS'
}

/** Who was watching this page, by the host the requests were going to. */
export function Watchers() {
  const [rows, setRows] = useState<Watcher[] | null>(null)

  useEffect(() => {
    void window.browser.watchers().then(setRows)
  }, [])

  if (!rows) return <p className="text-sm text-faint">{t('Смотрим…')}</p>
  if (rows.length === 0) {
    return <p className="text-sm text-faint">{t('На этой странице за вами никто не следил')}</p>
  }

  const total = rows.reduce((sum, one) => sum + one.blocked, 0)

  return (
    <div className="flex flex-col">
      <div className="mb-1.5 text-sm text-dim">
        {t('Остановлено запросов: {n}', { n: total })}
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {rows.map((row) => (
          <div
            key={`${row.host}-${row.kind}`}
            className="flex items-center gap-2 rounded-[9px] px-2 py-1.5 text-sm"
          >
            <Zap width={12} height={12} className="shrink-0 text-faint" />
            <span className="min-w-0 flex-1 truncate">{row.host}</span>
            <span className="shrink-0 text-2xs text-faint">{t(KIND_NAME[row.kind])}</span>
            <span className="w-[34px] shrink-0 text-right text-2xs tabular-nums text-dim">
              {row.blocked}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- what is known */

/** What this site can work out about the machine, as the page itself sees it. */
export function SiteKnowsPanel() {
  const [known, setKnown] = useState<SiteKnows | null | undefined>(undefined)

  useEffect(() => {
    void window.browser.siteKnows().then(setKnown)
  }, [])

  if (known === undefined) return <p className="text-sm text-faint">{t('Смотрим…')}</p>
  if (!known) return <p className="text-sm text-faint">{t('Это не страница сайта')}</p>

  const rows: Array<{ label: string; value: string; warn?: boolean }> = [
    { label: t('Cookie этого сайта'), value: String(known.cookies), warn: known.cookies > 20 },
    { label: t('Хранит в браузере'), value: formatBytes(known.storage), warn: known.storage > 1_000_000 },
    { label: t('Экран'), value: known.screen },
    { label: t('Часовой пояс'), value: known.timezone },
    { label: t('Языки'), value: known.languages },
    { label: t('Остановлено на странице'), value: String(known.blocked) }
  ]

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline gap-2 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate text-dim">{row.label}</span>
          <span className={cx('shrink-0 tabular-nums', row.warn && 'text-[var(--warn)]')}>
            {row.value || '—'}
          </span>
        </div>
      ))}
      {known.granted.length > 0 && (
        <div className="mt-1 flex items-baseline gap-2 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate text-dim">{t('Вы разрешили')}</span>
          <span className="shrink-0">{known.granted.length}</span>
        </div>
      )}
      <p className="mt-2 text-2xs leading-snug text-faint">
        {known.blunted
          ? t('Отпечаток притуплён: холст и звук читаются с шумом, счётчики округлены')
          : t('Отпечаток не притуплён — включить можно в приватности')}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ report */

/** A month of protection, as something a person can act on. */
export function ProtectionReportPanel() {
  const [report, setReport] = useState<ProtectionReport | null>(null)

  useEffect(() => {
    void window.browser.protectionReport().then(setReport)
  }, [])

  if (!report) return <p className="text-sm text-faint">{t('Смотрим…')}</p>

  const locale = currentLanguage() || undefined
  const highest = Math.max(1, ...report.days.map((one) => one.count))
  const total = report.days.reduce((sum, one) => sum + one.count, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: t('Реклама'), value: report.totals.ads },
          { label: t('Трекеры'), value: report.totals.trackers },
          { label: 'HTTPS', value: report.totals.upgrades },
          { label: t('Метки'), value: report.totals.params }
        ].map((one) => (
          <div key={one.label}>
            <div className="text-[22px] font-semibold tabular-nums tracking-[-0.02em]">
              {one.value.toLocaleString(locale)}
            </div>
            <div className="text-sm text-dim">{one.label}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-1.5 text-sm text-dim">{t('За две недели: {n}', { n: total.toLocaleString(locale) })}</div>
        <div className="flex h-[54px] items-end gap-[3px]">
          {report.days.map((one) => (
            <div
              key={one.day}
              className="flex h-full flex-1 items-end rounded-t-[3px]"
              style={{ background: 'color-mix(in srgb, currentColor 8%, transparent)' }}
              title={`${new Date(one.day).toLocaleDateString(locale, { day: 'numeric', month: 'short' })} — ${one.count}`}
            >
              <div
                className="w-full rounded-t-[3px]"
                style={{
                  height: `${Math.max(3, Math.round((one.count / highest) * 100))}%`,
                  background: 'var(--accent)'
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {report.worst.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-dim">{t('Кто старался чаще всех')}</div>
          {report.worst.map((one) => (
            <div key={one.host} className="flex items-center gap-2 py-0.5 text-sm">
              <Globe width={12} height={12} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{one.host}</span>
              <span className="shrink-0 text-2xs tabular-nums text-dim">{one.count}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-2xs text-faint">
        {t('Сайтов со своими правилами: {n}', { n: report.sites })}
        {report.filtersUpdated > 0 &&
          ` · ${t('Списки обновлены {when}', {
            when: new Date(report.filtersUpdated).toLocaleDateString(locale)
          })}`}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- warnings */

const WARNING_TITLE: Record<Warning['kind'], string> = {
  homograph: 'Буквы из другого алфавита',
  lookalike: 'Похоже на знакомый адрес',
  'brand-subdomain': 'Знакомое имя стоит приставкой',
  credentials: 'Имя перед @ — не адрес',
  'raw-ip': 'Адрес без имени',
  'insecure-form': 'Форма без шифрования'
}

const WARNING_TEXT: Record<Warning['kind'], string> = {
  homograph: 'В адресе смешаны алфавиты: он выглядит как знакомый, но ведёт не туда',
  lookalike: 'Адрес отличается от знакомого на один символ',
  'brand-subdomain': 'Знакомое имя стоит в адресе как приставка — сайт другой',
  credentials: 'Настоящий адрес идёт после @, всё перед ним — украшение',
  'raw-ip': 'Адрес без имени, просто числа',
  'insecure-form': 'Пароль на этой странице уйдёт незашифрованным'
}

/**
 * A warning about the address, in the corner.
 *
 * Not a band across the window: a full-width bar shoves the page down, covers
 * what somebody was reading, and reads as part of the site rather than as the
 * browser speaking. This is a card in the top right, where every other notice
 * here appears, and the page carries on underneath it.
 */
export function AddressWarning({
  warnings,
  onLeave,
  onTrust,
  onClose
}: {
  warnings: Warning[]
  onLeave: () => void
  onTrust: () => void
  onClose: () => void
}) {
  if (warnings.length === 0) return null
  const worst = warnings[0]

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
          <div className="text-base font-medium">{t(WARNING_TITLE[worst.kind])}</div>
          <div className="mt-0.5 text-sm leading-snug text-dim">
            {t(WARNING_TEXT[worst.kind])}
            {worst.looksLike && ` · ${t('Похоже на {host}', { host: worst.looksLike })}`}
          </div>
        </div>
        <button className="icon-btn h-6 w-6 shrink-0" aria-label={t('Закрыть')} onClick={onClose}>
          <Cross width={12} height={12} />
        </button>
      </div>
      <div className="flex gap-1.5 px-3.5 pb-3">
        <button className="btn btn-primary flex-1" onClick={onLeave}>
          {t('Уйти отсюда')}
        </button>
        <button className="btn flex-1" onClick={onTrust}>
          {t('Я доверяю')}
        </button>
      </div>
    </div>
  )
}

/** The icon the site panel wears when something is being guarded here. */
export const ShieldIcon = Shield
