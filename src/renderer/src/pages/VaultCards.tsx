import { t } from '../i18n'
import { useEffect, useState } from 'react'
import type { AddressFields, AddressMeta, CardMeta } from '../../../shared/types'
import { CardIcon, Copy, Cross, Eye, EyeOff, MapPin, Plus } from '../components/Icons'
import { BRANDS, BRAND_COLOURS, cardLine, expiry } from '../components/AutofillOffer'
import { EmptyState, Modal, TextField, formatDate } from '../components/ui'

/**
 * The other two things a shop asks for, kept where the passwords are kept.
 *
 * A card is sealed by the same key, under its own id, and what stays in the
 * clear is only what tells one card from another: the brand, the last four
 * digits, the date on the front. The security code is not here — not in the
 * file, not in memory, not in this screen. Three digits a person can always
 * type is the difference between a stolen file and a usable card.
 *
 * An address is sealed whole; the list shows what it is called and which city
 * it is in, because that is all anyone needs to pick the right one.
 */

const empty: AddressFields = {
  name: '',
  phone: '',
  email: '',
  country: '',
  region: '',
  city: '',
  street: '',
  house: '',
  flat: '',
  postcode: ''
}

/* ------------------------------------------------------------------ cards */

export function CardsTab({
  cards,
  locked,
  onChange,
  onError
}: {
  cards: CardMeta[]
  locked: boolean
  onChange: () => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<CardMeta | 'new' | null>(null)
  const [shown, setShown] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<CardMeta | null>(null)

  return (
    <>
      {cards.length === 0 ? (
        <EmptyState
          icon={<CardIcon width={26} height={26} />}
          title={t('Сохранённых карт нет')}
          hint={t('Добавьте карту — она подставится на оплате, а код CVC вы введёте сами.')}
        />
      ) : (
        <div className="card stagger overflow-hidden">
          {cards.map((card) => (
            <div key={card.id} style={{ borderTop: '1px solid var(--line)' }}>
              <div className="flex w-full items-center gap-3 px-4 py-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                  style={{
                    background: `color-mix(in srgb, ${BRAND_COLOURS[card.brand] ?? 'var(--text-faint)'} 16%, transparent)`,
                    color: BRAND_COLOURS[card.brand] ?? 'var(--text-dim)'
                  }}
                >
                  <CardIcon width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  {/* The payment system stays put and the dots become digits:
                      what is being looked at is which card this is, and that
                      answer should not disappear at the moment of asking. */}
                  <span className="flex items-baseline gap-1.5 truncate text-base font-medium">
                    <span className="shrink-0">{BRANDS[card.brand] ?? t('Карта')}</span>
                    <span
                      key={shown[card.id] ? 'shown' : 'hidden'}
                      className="animate-digits truncate tabular-nums"
                    >
                      {shown[card.id] ?? `•••• ${card.last4}`}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-dim">
                    {[card.label, card.holder, expiry(card)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button
                  className="icon-btn h-8 w-8"
                  title={shown[card.id] ? t('Скрыть') : t('Показать')}
                  onClick={async () => {
                    if (shown[card.id]) {
                      setShown(({ [card.id]: _drop, ...rest }) => rest)
                      return
                    }
                    const number = await window.browser.vaultRevealCard(card.id)
                    if (number) setShown((prev) => ({ ...prev, [card.id]: spaced(number) }))
                    else onError(t('Хранилище заблокировано'))
                  }}
                >
                  {shown[card.id] ? <EyeOff width={14} height={14} /> : <Eye width={14} height={14} />}
                </button>
                <button
                  className="icon-btn h-8 w-8"
                  title={t('Скопировать')}
                  onClick={async () => {
                    const ok = await window.browser.vaultCopyCard(card.id)
                    if (!ok) onError(t('Хранилище заблокировано'))
                  }}
                >
                  <Copy width={14} height={14} />
                </button>
                <button
                  className="icon-btn h-8 w-8"
                  title={t('Изменить')}
                  onClick={() => setEditing(card)}
                >
                  <Plus width={14} height={14} style={{ transform: 'rotate(45deg)' }} />
                </button>
                <button
                  className="icon-btn h-8 w-8"
                  title={t('Удалить')}
                  style={{ color: 'var(--bad)' }}
                  onClick={() => setConfirm(card)}
                >
                  <Cross width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn mt-4" onClick={() => setEditing('new')}>
        <Plus width={15} height={15} />
        {t('Новая карта')}
      </button>

      <p className="mt-4 flex items-center gap-2 text-sm text-faint">
        <CardIcon width={14} height={14} />
        {t('Номер карты шифруется тем же ключом, что и пароли. Код CVC не хранится никогда.')}
      </p>

      {editing && (
        <CardDialog
          card={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            onChange()
          }}
          onError={onError}
        />
      )}

      {confirm && (
        <Modal
          title={locked ? t('Хранилище заблокировано') : t('Удалить карту?')}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                {locked ? t('Закрыть') : t('Отмена')}
              </button>
              {!locked && (
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--bad)' }}
                  onClick={async () => {
                    const ok = await window.browser.vaultRemoveCard(confirm.id)
                    setConfirm(null)
                    if (ok) onChange()
                    else onError(t('Не удалось удалить запись'))
                  }}
                >
                  {t('Удалить')}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-dim">{cardLine(confirm)}</p>
        </Modal>
      )}
    </>
  )
}

/** Which payment system the number belongs to, said as it is typed. */
function BrandChip({ digits }: { digits: string }) {
  if (digits.length < 2) return null
  const brand = brandGuess(digits)
  const colour = BRAND_COLOURS[brand] ?? 'var(--text-faint)'
  // The same chip the offer under a payment form uses, to the pixel: one size,
  // one weight, one tint, the name in the middle of it and nothing else in
  // there beside the name.
  return (
    <span
      key={brand || 'other'}
      className="animate-digits flex h-7 min-w-[72px] shrink-0 items-center justify-center self-center rounded-[9px] px-2 text-2xs font-medium"
      style={{
        background: `color-mix(in srgb, ${colour} 16%, transparent)`,
        color: brand ? 'var(--ink)' : 'var(--text-dim)',
        transition: 'background var(--t-fast) linear'
      }}
    >
      {BRANDS[brand] ?? t('Другая карта')}
    </span>
  )
}

/** 4111111111111111 → 4111 1111 1111 1111, which is how it is read aloud. */
const spaced = (digits: string) => digits.replace(/(.{4})/g, '$1 ').trim()

function CardDialog({
  card,
  onClose,
  onDone,
  onError
}: {
  card: CardMeta | null
  onClose: () => void
  onDone: () => void
  onError: (message: string) => void
}) {
  const [label, setLabel] = useState(card?.label ?? '')
  const [number, setNumber] = useState('')
  const [holder, setHolder] = useState(card?.holder ?? '')
  const [month, setMonth] = useState(card ? String(card.month) : '')
  const [year, setYear] = useState(card ? String(card.year) : '')

  // Changing a card should not mean typing the number again, so it is fetched
  // once and shown in the box the way it is printed.
  useEffect(() => {
    if (!card) return
    let alive = true
    void window.browser.vaultRevealCard(card.id).then((value) => {
      if (alive && value) setNumber(spaced(value))
    })
    return () => {
      alive = false
    }
  }, [card])

  const digits = number.replace(/\D/g, '')
  const ready = digits.length >= 12 && Number(month) >= 1 && Number(year) >= 2000

  const save = async () => {
    if (!ready) return
    const ok = await window.browser.vaultSaveCard({
      id: card?.id,
      label,
      number: digits,
      holder,
      month: Number(month),
      year: Number(year)
    })
    if (ok) onDone()
    else onError(t('Хранилище заблокировано'))
  }

  return (
    <Modal
      title={card ? t('Изменить') : t('Новая карта')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" disabled={!ready} onClick={save}>
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('Номер карты')}>
          <div className="flex items-center gap-2">
            <TextField
              value={number}
              onChange={(value) => setNumber(spaced(value.replace(/\D/g, '').slice(0, 19)))}
              width="100%"
              mono
              autoFocus
            />
            <BrandChip digits={digits} />
          </div>
        </Field>
        <Field label={t('Владелец')}>
          <TextField value={holder} onChange={setHolder} width="100%" />
        </Field>
        <div className="flex gap-3">
          <Field label={t('Месяц')}>
            <TextField
              value={month}
              onChange={(value) => setMonth(value.replace(/\D/g, '').slice(0, 2))}
              width={90}
            />
          </Field>
          <Field label={t('Год')}>
            <TextField
              value={year}
              onChange={(value) => setYear(value.replace(/\D/g, '').slice(0, 4))}
              width={110}
            />
          </Field>
          <Field label={t('Название')}>
            <TextField value={label} onChange={setLabel} width="100%" />
          </Field>
        </div>

      </div>
    </Modal>
  )
}

/**
 * The same reading of the first digits the vault does, for the line under the
 * box while it is being typed. Nothing is decided by it.
 */
function brandGuess(digits: string): string {
  if (/^4/.test(digits)) return 'visa'
  if (/^220[0-4]/.test(digits)) return 'mir'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^35/.test(digits)) return 'jcb'
  if (/^62/.test(digits)) return 'unionpay'
  if (/^6(011|5)/.test(digits)) return 'discover'
  return ''
}

/* -------------------------------------------------------------- addresses */

export function AddressesTab({
  addresses,
  locked,
  onChange,
  onError
}: {
  addresses: AddressMeta[]
  locked: boolean
  onChange: () => void
  onError: (message: string) => void
}) {
  const [editing, setEditing] = useState<AddressMeta | 'new' | null>(null)
  const [confirm, setConfirm] = useState<AddressMeta | null>(null)

  return (
    <>
      {addresses.length === 0 ? (
        <EmptyState
          icon={<MapPin width={26} height={26} />}
          title={t('Сохранённых адресов нет')}
          hint={t('Добавьте адрес — он подставится в форме доставки целиком.')}
        />
      ) : (
        <div className="card stagger overflow-hidden">
          {addresses.map((address) => (
            <div key={address.id} style={{ borderTop: '1px solid var(--line)' }}>
              <div className="flex w-full items-center gap-3 px-4 py-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                  style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
                >
                  <MapPin width={16} height={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">
                    {address.label || address.city || t('Адрес')}
                  </span>
                  <span className="block truncate text-sm text-dim">
                    {address.label ? address.city : formatDate(address.created)}
                  </span>
                </span>
                <button
                  className="icon-btn h-8 w-8"
                  title={t('Изменить')}
                  onClick={() => setEditing(address)}
                >
                  <Plus width={14} height={14} style={{ transform: 'rotate(45deg)' }} />
                </button>
                <button
                  className="icon-btn h-8 w-8"
                  title={t('Удалить')}
                  style={{ color: 'var(--bad)' }}
                  onClick={() => setConfirm(address)}
                >
                  <Cross width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn mt-4" onClick={() => setEditing('new')}>
        <Plus width={15} height={15} />
        {t('Новый адрес')}
      </button>

      <p className="mt-4 flex items-center gap-2 text-sm text-faint">
        <MapPin width={14} height={14} />
        {t('Адрес шифруется целиком; в списке видны только название и город.')}
      </p>

      {editing && (
        <AddressDialog
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            onChange()
          }}
          onError={onError}
        />
      )}

      {confirm && (
        <Modal
          title={locked ? t('Хранилище заблокировано') : t('Удалить адрес?')}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                {locked ? t('Закрыть') : t('Отмена')}
              </button>
              {!locked && (
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--bad)' }}
                  onClick={async () => {
                    const ok = await window.browser.vaultRemoveAddress(confirm.id)
                    setConfirm(null)
                    if (ok) onChange()
                    else onError(t('Не удалось удалить запись'))
                  }}
                >
                  {t('Удалить')}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-dim">{confirm.label || confirm.city}</p>
        </Modal>
      )}
    </>
  )
}

function AddressDialog({
  address,
  onClose,
  onDone,
  onError
}: {
  address: AddressMeta | null
  onClose: () => void
  onDone: () => void
  onError: (message: string) => void
}) {
  const [label, setLabel] = useState(address?.label ?? '')
  const [fields, setFields] = useState<AddressFields>(empty)

  useEffect(() => {
    if (!address) return
    let alive = true
    void window.browser.vaultRevealAddress(address.id).then((value) => {
      if (alive && value) setFields(value)
    })
    return () => {
      alive = false
    }
  }, [address])

  const set = (key: keyof AddressFields) => (value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const ready = fields.city.trim() !== '' || fields.street.trim() !== ''

  return (
    <Modal
      title={address ? t('Изменить') : t('Новый адрес')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!ready}
            onClick={async () => {
              const ok = await window.browser.vaultSaveAddress({ id: address?.id, label, fields })
              if (ok) onDone()
              else onError(t('Хранилище заблокировано'))
            }}
          >
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <Field label={t('Название')}>
            <TextField value={label} onChange={setLabel} width="100%" autoFocus />
          </Field>
          <Field label={t('Получатель')}>
            <TextField value={fields.name} onChange={set('name')} width="100%" />
          </Field>
        </div>
        <div className="flex gap-3">
          <Field label={t('Телефон')}>
            <TextField value={fields.phone} onChange={set('phone')} width="100%" />
          </Field>
          <Field label={t('Почта')}>
            <TextField value={fields.email} onChange={set('email')} width="100%" />
          </Field>
        </div>
        <div className="flex gap-3">
          <Field label={t('Страна')}>
            <TextField value={fields.country} onChange={set('country')} width="100%" />
          </Field>
          <Field label={t('Область')}>
            <TextField value={fields.region} onChange={set('region')} width="100%" />
          </Field>
        </div>
        <div className="flex gap-3">
          <Field label={t('Город')}>
            <TextField value={fields.city} onChange={set('city')} width="100%" />
          </Field>
          <Field label={t('Индекс')}>
            <TextField value={fields.postcode} onChange={set('postcode')} width={120} />
          </Field>
        </div>
        <Field label={t('Улица')}>
          <TextField value={fields.street} onChange={set('street')} width="100%" />
        </Field>
        <div className="flex gap-3">
          <Field label={t('Дом')}>
            <TextField value={fields.house} onChange={set('house')} width="100%" />
          </Field>
          <Field label={t('Квартира')}>
            <TextField value={fields.flat} onChange={set('flat')} width="100%" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ shared */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="text-sm text-dim">{label}</span>
      {children}
    </label>
  )
}
