import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import type { PermissionRequest } from '../../../shared/types'
import type { AutofillOffer, SavePasswordOffer } from '../../../preload/index'
import { ArrowLeft, ArrowRight, Cross, Key, Lock, Search, Shield } from './Icons'

/** Shared shell so every inline bar looks and animates the same way. */
function Bar({
  icon,
  children,
  onClose,
  tone = 'accent'
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClose?: () => void
  tone?: 'accent' | 'warn'
}) {
  const color = tone === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <div
      className="animate-fade-down no-drag mx-2.5 mb-1.5 flex items-center gap-3 rounded-[12px] px-3 py-2"
      style={{
        background: `color-mix(in srgb, ${color} 10%, var(--surface-solid))`,
        border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
        boxShadow: 'var(--shadow-sm)'
      }}
    >
      <span className="shrink-0" style={{ color }}>
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
      {onClose && (
        <button className="icon-btn h-6 w-6 shrink-0" onClick={onClose} aria-label={t('Закрыть')}>
          <Cross width={13} height={13} />
        </button>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- find bar */
export function FindBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    return () => void window.browser.stopFind()
  }, [])

  const run = (forward: boolean) => {
    if (query.trim()) void window.browser.find(query, forward)
  }

  return (
    <div className="no-drag flex items-center justify-end gap-1.5 px-3 pb-2">
      <div
        className="animate-fade-down flex h-[32px] items-center gap-2 rounded-[11px] border px-3"
        style={{ background: 'var(--field)', borderColor: 'var(--line)', boxShadow: 'var(--shadow-sm)' }}
      >
        <Search width={14} height={14} className="text-faint" />
        <input
          ref={input}
          value={query}
          spellCheck={false}
          placeholder={t('Найти на странице')}
          className="w-[220px] bg-transparent text-sm outline-none placeholder:text-faint"
          onChange={(event) => {
            setQuery(event.target.value)
            if (event.target.value.trim()) void window.browser.find(event.target.value, true)
            else void window.browser.stopFind()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') run(!event.shiftKey)
            if (event.key === 'Escape') onClose()
          }}
        />
        <button className="icon-btn h-6 w-6" title={t('Назад')} onClick={() => run(false)}>
          <ArrowLeft width={13} height={13} />
        </button>
        <button className="icon-btn h-6 w-6" title={t('Далее')} onClick={() => run(true)}>
          <ArrowRight width={13} height={13} />
        </button>
        <button className="icon-btn h-6 w-6" title={t('Закрыть')} onClick={onClose}>
          <Cross width={13} height={13} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- permission prompt */
const PERMISSION_LABEL: Record<string, string> = {
  camera: 'использовать камеру',
  microphone: 'использовать микрофон',
  geolocation: 'узнать ваше местоположение',
  notifications: 'присылать уведомления',
  clipboard: 'читать буфер обмена',
  midi: 'работать с MIDI-устройствами',
  usb: 'подключаться к USB-устройствам',
  fullscreen: 'открыться на весь экран',
  download: 'открыть внешнее приложение'
}

export function PermissionBar({
  request,
  onAnswer
}: {
  request: PermissionRequest
  onAnswer: (allow: boolean) => void
}) {
  return (
    <Bar icon={<Shield width={16} height={16} />} tone="warn" onClose={() => onAnswer(false)}>
      <span className="min-w-0 flex-1 truncate text-sm">
        <b className="font-semibold">{request.origin || t('Сайт')}</b> просит{' '}
        {t(PERMISSION_LABEL[request.permission] ?? 'дополнительный доступ')}
      </span>
      <button className="btn h-[28px] px-3 text-sm" onClick={() => onAnswer(false)}>
        {t('Запретить')}
      </button>
      <button className="btn btn-primary h-[28px] px-3 text-sm" onClick={() => onAnswer(true)}>
        {t('Разрешить')}
      </button>
    </Bar>
  )
}

/* ------------------------------------------------------- save password bar */
export function SavePasswordBar({
  offer,
  onAnswer
}: {
  offer: SavePasswordOffer
  onAnswer: (save: boolean) => void
}) {
  return (
    <Bar icon={<Key width={16} height={16} />} onClose={() => onAnswer(false)}>
      <span className="min-w-0 flex-1 truncate text-sm">
        {offer.known ? t('Обновить пароль для') : t('Сохранить пароль для')}{' '}
        <b className="font-semibold">{offer.host}</b>
        {offer.username ? ` · ${offer.username}` : ''}
      </span>
      <button className="btn h-[28px] px-3 text-sm" onClick={() => onAnswer(false)}>
        {t('Не сейчас')}
      </button>
      <button className="btn btn-primary h-[28px] px-3 text-sm" onClick={() => onAnswer(true)}>
        {t('Сохранить')}
      </button>
    </Bar>
  )
}

/* ------------------------------------------------------------ autofill bar */
export function AutofillBar({
  offer,
  onClose,
  onUnlock
}: {
  offer: AutofillOffer
  onClose: () => void
  onUnlock: () => void
}) {
  if (offer.locked) {
    return (
      <Bar icon={<Lock width={16} height={16} />} onClose={onClose}>
        <span className="min-w-0 flex-1 truncate text-sm">
          Есть сохранённые пароли для <b className="font-semibold">{offer.host}</b> — хранилище заблокировано
        </span>
        <button className="btn btn-primary h-[28px] px-3 text-sm" onClick={onUnlock}>
          {t('Разблокировать')}
        </button>
      </Bar>
    )
  }

  return (
    <Bar icon={<Key width={16} height={16} />} onClose={onClose}>
      <span className="shrink-0 text-sm text-dim">{t('Подставить пароль:')}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {offer.entries.map((entry) => (
          <button
            key={entry.id}
            className="btn h-[28px] px-3 text-sm"
            onClick={async () => {
              await window.browser.vaultFill(entry.id)
              onClose()
            }}
          >
            {entry.username || t('без имени')}
          </button>
        ))}
      </div>
    </Bar>
  )
}
