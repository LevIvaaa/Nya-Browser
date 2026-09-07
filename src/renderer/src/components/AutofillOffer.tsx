import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { Key, Lock, User } from './Icons'
import type { AutofillOffer } from '../../../preload/index'

/**
 * The offer to fill a saved password, drawn where the field is.
 *
 * It used to be a bar across the top of the window that appeared once per page
 * load: click the login box a second time and nothing happened, which is what
 * "it works every other time" meant. Now the page reports the field that was
 * clicked and this card opens under it, every time, the way it does in every
 * other browser.
 *
 * The card lives in the overlay layer, which the browser shrinks to exactly
 * this card before showing it — page views are native layers above the
 * interface, so anything drawn over a page has to be its own layer, and a
 * full-window one would swallow every click meant for the page.
 */
export default function AutofillCard({
  offer,
  onClose
}: {
  offer: AutofillOffer | null
  onClose: () => void
}) {
  if (!offer) return null
  return offer.locked ? (
    <VaultNotice host={offer.host} onClose={onClose} />
  ) : (
    <Entries offer={offer} onClose={onClose} />
  )
}

/* ------------------------------------------------------- the saved accounts */

function Entries({ offer, onClose }: { offer: AutofillOffer; onClose: () => void }) {
  return (
    <div
      className="animate-pop absolute inset-[20px] flex flex-col overflow-hidden rounded-card"
      style={{
        background: 'var(--elevated)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-xl)',
        backdropFilter: 'blur(30px) saturate(180%)'
      }}
    >
      <div className="flex h-[30px] shrink-0 items-center gap-1.5 px-3 text-2xs text-faint">
        <Key width={11} height={11} />
        <span className="truncate">{t('Сохранённые пароли')}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-1.5">
        {offer.entries.map((entry) => (
          <button
            key={entry.id}
            className="flex h-11 w-full items-center gap-2.5 px-3 text-left transition-colors duration-100 hover:bg-[var(--surface-hover)]"
            onClick={async () => {
              await window.browser.vaultFill(entry.id)
              onClose()
            }}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill"
              style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
            >
              <User width={13} height={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {entry.username || t('без имени')}
              </span>
              {/* Saved somewhere else on the same site: say so rather than let a
                  credential appear from nowhere. */}
              {entry.origin && entry.origin !== offer.host.replace(/^www\./, '') && (
                <span className="block truncate text-2xs text-faint">{entry.origin}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------- the vault is still closed */

/**
 * What appears instead when the vault is shut: the question asked at the
 * moment it matters, rather than at every start of the browser. Answer it and
 * the offer comes straight back with the passwords in it.
 */
function VaultNotice({ host, onClose }: { host: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const [hello, setHello] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
    void window.browser.vaultHelloAvailable().then(setHello)
  }, [])

  async function open() {
    if (busy || !password) return
    setBusy(true)
    const ok = await window.browser.vaultUnlock(password)
    setBusy(false)
    setPassword('')
    if (ok) return onClose()
    setWrong(true)
    field.current?.focus()
  }

  async function viaHello() {
    if (busy) return
    setBusy(true)
    const ok = await window.browser.vaultHelloUnlock()
    setBusy(false)
    if (ok) return onClose()
    setWrong(true)
    field.current?.focus()
  }

  return (
    <div
      className="animate-sheet absolute inset-[20px] flex flex-col rounded-card p-4"
      style={{
        background: 'var(--elevated)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-xl)',
        backdropFilter: 'blur(30px) saturate(180%)'
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Lock width={15} height={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            {t('Пароли под замком')}
          </span>
          <span className="block truncate text-2xs text-faint">
            {t('Есть сохранённый пароль для {host}', { host })}
          </span>
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          ref={field}
          type="password"
          className="field h-[34px] min-w-0 flex-1 text-sm"
          placeholder={t('Мастер-пароль')}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
            setWrong(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void open()
            if (event.key === 'Escape') onClose()
          }}
        />
        <button className="btn btn-primary h-[34px]" disabled={busy || !password} onClick={open}>
          {t('Открыть')}
        </button>
      </div>

      {wrong && (
        <p className="mt-2 text-2xs" style={{ color: 'var(--bad)' }}>
          {t('Не подошло')}
        </p>
      )}

      <div className="mt-auto flex items-center gap-2">
        {hello && (
          <button className="btn h-[32px] flex-1 justify-center" disabled={busy} onClick={viaHello}>
            {t('Windows Hello')}
          </button>
        )}
        <button
          className="btn h-[32px] flex-1 justify-center"
          onClick={async () => {
            await window.browser.vaultDismissNotice()
          }}
        >
          {t('Не сейчас')}
        </button>
      </div>
    </div>
  )
}
