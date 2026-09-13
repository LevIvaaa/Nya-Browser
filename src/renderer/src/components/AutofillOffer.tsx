import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { CardIcon, Key, Lock, MapPin, User } from './Icons'
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

/** How a card is written where it has to be recognised, not read. */
export const cardLine = (card: { brand: string; last4: string }) =>
  `${BRANDS[card.brand] ?? t('Карта')} •••• ${card.last4}`

/**
 * The names cards are known by. Not translated: they are the words printed
 * on the card itself, in Latin letters, everywhere in the world.
 */
export const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  mir: 'Мир',
  amex: 'Amex',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  discover: 'Discover'
}

/**
 * The colours the payment systems are known by. A dot in that colour with
 * the name beside it, because their marks are theirs and drawing them badly
 * is worse than not drawing them at all.
 */
export const BRAND_COLOURS: Record<string, string> = {
  visa: '#1a4fd6',
  mastercard: '#eb001b',
  mir: '#0f9d58',
  amex: '#2e77bc',
  jcb: '#0e4c96',
  unionpay: '#e21836',
  discover: '#ff6000'
}

/**
 * The payment systems, as badges.
 *
 * A card is known by its mark long before it is known by its number, and a
 * grey pill with a word in it is not that mark. Each one here is a small card
 * of its own: the system's colours, a quiet sheen across the top, a hairline
 * to lift it off the surface, and inside it either the name in the shape the
 * system writes it or — where the system is a picture rather than a word —
 * that picture, drawn plainly.
 *
 * Nobody's logotype is reproduced: these are the colours and the geometry
 * anybody can see on the card in their own pocket, drawn well enough to be
 * recognised at twenty-eight pixels and no further.
 */
const BADGE: Record<
  string,
  { from: string; to: string; word?: string; italic?: boolean; size?: number; mark?: 'mastercard' | 'unionpay' }
> = {
  visa: { from: '#2b5cd8', to: '#16256e', word: 'VISA', italic: true, size: 11 },
  mir: { from: '#13b467', to: '#087a42', word: 'МИР', size: 10.5 },
  amex: { from: '#3a8fe0', to: '#1b5f9e', word: 'AMEX', size: 9.5 },
  jcb: { from: '#2a6fd0', to: '#0e3f82', word: 'JCB', size: 10.5 },
  discover: { from: '#ff8a2b', to: '#d85c00', word: 'DISCOVER', size: 6.6 },
  mastercard: { from: '#2a2b31', to: '#16171b', mark: 'mastercard' },
  unionpay: { from: '#2a2b31', to: '#16171b', mark: 'unionpay' }
}

export function BrandBadge({ brand, size = 'sm' }: { brand: string; size?: 'sm' | 'md' }) {
  const known = BADGE[brand]
  const width = size === 'md' ? 50 : 44
  const height = size === 'md' ? 32 : 28

  // A card nobody recognises still gets a card: the shape carries the meaning,
  // and an empty space where the others have a badge would read as an error.
  const from = known?.from ?? 'var(--field-idle)'
  const to = known?.to ?? 'var(--field-idle)'

  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden"
      style={{
        width,
        height,
        borderRadius: 7,
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16), 0 1px 2px rgba(0,0,0,0.28)'
      }}
    >
      {/* The light that falls across the top of anything held in a hand. */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: '52%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0))'
        }}
      />
      {known?.mark === 'mastercard' ? (
        <svg width={width} height={height} viewBox="0 0 44 28" aria-hidden>
          <circle cx="18.4" cy="14" r="7.6" fill="#eb001b" />
          <circle cx="25.6" cy="14" r="7.6" fill="#f79e1b" opacity="0.88" />
        </svg>
      ) : known?.mark === 'unionpay' ? (
        <svg width={width} height={height} viewBox="0 0 44 28" aria-hidden>
          <path d="M13.6 6.5h7.2l-3 15h-7.2z" fill="#e21836" />
          <path d="M20.4 6.5h7.2l-3 15h-7.2z" fill="#00447c" />
          <path d="M27.2 6.5h7.2l-3 15h-7.2z" fill="#007b84" />
        </svg>
      ) : (
        <svg width={width} height={height} viewBox="0 0 44 28" aria-hidden>
          <text
            x="22"
            y="18.4"
            textAnchor="middle"
            fill="#fff"
            fontSize={known?.size ?? 8}
            fontWeight="700"
            fontStyle={known?.italic ? 'italic' : 'normal'}
            letterSpacing={known?.word && known.word.length > 5 ? '0.1' : '0.6'}
            style={{ fontFamily: 'inherit' }}
          >
            {known?.word ?? '••••'}
          </text>
        </svg>
      )}
    </span>
  )
}

/** The date on the front of a card: 04/30. */
export const expiry = (card: { month: number; year: number }) =>
  `${String(card.month).padStart(2, '0')}/${String(card.year).slice(2)}`

function Entries({ offer, onClose }: { offer: AutofillOffer; onClose: () => void }) {
  const heading =
    offer.kind === 'card'
      ? t('Сохранённые карты')
      : offer.kind === 'address'
        ? t('Сохранённые адреса')
        : t('Сохранённые пароли')
  const Mark = offer.kind === 'card' ? CardIcon : offer.kind === 'address' ? MapPin : Key

  if (offer.kind === 'card' || offer.kind === 'address') {
    const rows =
      offer.kind === 'card'
        ? offer.cards.map((card) => ({
            id: card.id,
            title: `•••• ${card.last4}`,
            under: [card.label, expiry(card)].filter(Boolean).join(' · '),
            brand: card.brand,
            fill: () => window.browser.vaultFillCard(card.id)
          }))
        : offer.addresses.map((address) => ({
            id: address.id,
            title: address.label || address.city || t('Адрес'),
            under: address.label ? address.city : '',
            brand: null,
            fill: () => window.browser.vaultFillAddress(address.id)
          }))
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
          <Mark width={11} height={11} />
          <span className="truncate">{heading}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-1.5">
          {rows.map((row) => (
            <button
              key={row.id}
              className="flex h-11 w-full items-center gap-2.5 px-3 text-left transition-colors duration-100 hover:bg-[var(--surface-hover)]"
              onClick={async () => {
                await row.fill()
                onClose()
              }}
            >
              {row.brand === null ? (
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill"
                  style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
                >
                  <Mark width={13} height={13} />
                </span>
              ) : (
                <BrandBadge brand={row.brand} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{row.title}</span>
                {row.under && (
                  <span className="block truncate text-2xs text-faint">{row.under}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

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
