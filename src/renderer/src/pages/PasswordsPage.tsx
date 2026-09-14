import { t } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { Credential, VaultState } from '../../../preload/index'
import type { AddressMeta, CardMeta, PasswordAudit } from '../../../shared/types'
import { AddressesTab, CardsTab } from './VaultCards'
import { Badges, BinTab, CodeBlock, Generator } from './VaultExtras'
import { cx } from '../components/ui'
import { ChevronRight, Copy, Cross, Download, Eye, EyeOff, Install, Key, Lock, LockOpen, Plus, Search, Shield, ShieldCheck, Wand } from '../components/Icons'
import { EmptyState, Modal, Pill, TextField, formatDate } from '../components/ui'

const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, '')

/** The three things a shop asks for, in the order it asks for them —
    and the bin, where the ones deleted by mistake wait. */
type Section = 'passwords' | 'cards' | 'addresses' | 'bin'

/** What the list is narrowed to after a check has run. */
type Filter = 'all' | 'weak' | 'reused' | 'stolen'

export default function PasswordsPage() {
  const [state, setState] = useState<VaultState | null>(null)
  const [items, setItems] = useState<Credential[]>([])
  const [cards, setCards] = useState<CardMeta[]>([])
  const [addresses, setAddresses] = useState<AddressMeta[]>([])
  const [section, setSection] = useState<Section>('passwords')
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Credential | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState('')
  const [binned, setBinned] = useState<Credential[]>([])
  const [audit, setAudit] = useState<Record<string, PasswordAudit>>({})
  const [stolen, setStolen] = useState<string[]>([])
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [genOpen, setGenOpen] = useState(false)
  const [note, setNote] = useState('')

  const refresh = async () => {
    setState(await window.browser.vaultState())
    setItems(await window.browser.vaultList())
    setCards(await window.browser.vaultCards())
    setAddresses(await window.browser.vaultAddresses())
    setBinned(await window.browser.vaultBinned())
  }

  /**
   * The check, in two parts: the verdicts, which never leave this computer,
   * and the leak lookup, which sends five characters of a hash and nothing
   * else. Both are asked for by a button — neither happens on its own.
   */
  const check = async () => {
    setChecking(true)
    setError('')
    setNote('')
    const rows = await window.browser.vaultAudit()
    setAudit(Object.fromEntries(rows.map((row) => [row.id, row])))
    setStolen(await window.browser.vaultStolen())
    setChecked(true)
    setChecking(false)
  }
  useEffect(() => {
    void refresh()
  }, [])

  // Icons for the sites in the list. The cache answers for anything visited in
  // this profile; the rest are fetched once, from the site itself, so a list of
  // logins is a list of recognisable sites and not of grey letters.
  useEffect(() => {
    if (items.length === 0) return
    let alive = true
    void (async () => {
      const cached = await window.browser.favicons()
      if (!alive) return
      setIcons(cached)
      const missing = [...new Set(items.map((item) => normalizeHost(item.origin)))]
        .filter((host) => !cached[host])
        .slice(0, 40)
      for (const host of missing) {
        const data = await window.browser.fetchFavicon(host)
        if (!alive) return
        if (data) setIcons((prev) => ({ ...prev, [host]: data }))
      }
    })()
    return () => {
      alive = false
    }
  }, [items])

  const stolenSet = useMemo(() => new Set(stolen), [stolen])
  const counts = useMemo(
    () => ({
      all: items.length,
      weak: items.filter((item) => audit[item.id]?.verdict === 'weak').length,
      reused: items.filter((item) => audit[item.id]?.reused).length,
      stolen: items.filter((item) => stolenSet.has(item.id)).length
    }),
    [items, audit, stolenSet]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = items
    if (q) {
      list = list.filter(
        (item) => item.origin.includes(q) || item.username.toLowerCase().includes(q)
      )
    }
    if (filter === 'weak') list = list.filter((item) => audit[item.id]?.verdict === 'weak')
    if (filter === 'reused') list = list.filter((item) => audit[item.id]?.reused)
    if (filter === 'stolen') list = list.filter((item) => stolenSet.has(item.id))
    return list
  }, [items, query, filter, audit, stolenSet])

  const locked = state?.locked ?? true

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Пароли и карты')}</h1>
            <p className="text-sm text-dim">
              {items.length + cards.length + addresses.length} записей ·{' '}
              {state?.mode === 'password' ? t('защищено мастер-паролем') : t('защищено ключом Windows')}
            </p>
          </div>
          {section === 'passwords' && (
            <>
              <div className="relative">
                <Search width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('Поиск по сайтам')}
                  className="field focus-ring pl-8"
                  style={{ width: 220 }}
                />
              </div>
              <button className="btn" onClick={() => setAddOpen(true)}>
                <Plus width={15} height={15} />
                {t('Добавить')}
              </button>
            </>
          )}
        </header>

        {/* One vault, three kinds of thing in it. */}
        <div className="animate-fade-up mb-4 flex items-center gap-1">
          {(
            [
              ['passwords', t('Пароли'), items.length],
              ['cards', t('Карты'), cards.length],
              ['addresses', t('Адреса'), addresses.length],
              ['bin', t('Корзина'), binned.length]
            ] as Array<[Section, string, number]>
          ).map(([id, name, count]) => (
            <button
              key={id}
              className={cx(
                'flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-sm',
                section === id ? 'font-medium text-ink' : 'text-dim hover:text-ink'
              )}
              style={{
                background: section === id ? 'var(--surface-solid)' : 'transparent',
                boxShadow: section === id ? 'var(--shadow-sm)' : 'none',
                transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
              }}
              onClick={() => {
                setSection(id)
                setError('')
              }}
            >
              {name}
              <span className="text-2xs tabular-nums text-faint">{count}</span>
            </button>
          ))}
        </div>

        {/* vault status */}
        <div
          className="animate-fade-up card mb-5 flex flex-wrap items-center gap-3 p-4"
          style={{ borderColor: locked ? 'color-mix(in srgb, var(--warn) 40%, transparent)' : 'var(--line)' }}
        >
          <span style={{ color: locked ? 'var(--warn)' : 'var(--good)' }}>
            {locked ? <Lock width={20} height={20} /> : <LockOpen width={20} height={20} />}
          </span>
          <div className="mr-auto min-w-0">
            <div className="text-base font-medium">
              {locked ? t('Хранилище заблокировано') : t('Хранилище разблокировано')}
            </div>
            <div className="text-sm text-dim">
              {state?.mode === 'password'
                ? t('Ключ выводится из мастер-пароля (scrypt) и живёт только в памяти.')
                : state?.osEncryption
                  ? t('Ключ запечатан средствами Windows (DPAPI) — файл нельзя открыть на другом компьютере.')
                  : t('Системное шифрование недоступно — задайте мастер-пароль.')}
            </div>
          </div>
          {state?.mode === 'password' && !locked && (
            <button
              className="btn"
              onClick={async () => {
                await window.browser.vaultLock()
                setRevealed({})
                void refresh()
              }}
            >
              {t('Заблокировать')}
            </button>
          )}
          {locked && (
            <button className="btn btn-primary" onClick={() => setUnlockOpen(true)}>
              {t('Разблокировать')}
            </button>
          )}
          <button className="btn" onClick={() => setMasterOpen(true)}>
            <Shield width={15} height={15} />
            {state?.mode === 'password' ? t('Сменить мастер-пароль') : t('Задать мастер-пароль')}
          </button>
        </div>

        {/* Everything that acts on the whole list rather than on one row.
            The check and the generator on the left, the two doors on the
            right — a CSV is how passwords move between browsers, and both
            directions ask before they touch a file. */}
        {section === 'passwords' && items.length > 0 && (
          <div className="animate-fade-up mb-4 flex flex-wrap items-center gap-2">
            <button className="btn" disabled={locked || checking} onClick={check}>
              <ShieldCheck width={15} height={15} />
              {t('Проверить пароли')}
            </button>
            <button className="btn" onClick={() => setGenOpen(true)}>
              <Wand width={15} height={15} />
              {t('Генератор паролей')}
            </button>
            <span className="mr-auto" />
            <button
              className="btn"
              disabled={locked}
              onClick={async () => {
                setNote('')
                await window.browser.vaultExportCsv()
              }}
              title={t('Пароли из CSV')}
            >
              <Download width={15} height={15} />
              {t('Экспортировать')}
            </button>
            <button
              className="btn"
              disabled={locked}
              onClick={async () => {
                const added = await window.browser.vaultImportCsv()
                setNote(added > 0 ? t('Добавлено записей: {n}', { n: added }) : t('Ничего не найдено'))
                if (added > 0) void refresh()
              }}
              title={t('Их шифрует другой браузер — принесите файл CSV из него')}
            >
              <Install width={15} height={15} />
              {t('Импортировать')}
            </button>
          </div>
        )}

        {/* After a check: what it found, as something to click rather than
            something to read. Nothing is shown before the check runs, because
            an empty row of chips reads as a clean bill of health. */}
        {section === 'passwords' && checked && (
          <div className="animate-fade-up mb-4 flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', t('Все'), counts.all, 'var(--text-dim)'],
                ['stolen', t('В утечке'), counts.stolen, 'var(--bad)'],
                ['weak', t('Слабый'), counts.weak, 'var(--warn)'],
                ['reused', t('Повторяется'), counts.reused, 'var(--warn)']
              ] as Array<[Filter, string, number, string]>
            )
              .filter(([id, , count]) => id === 'all' || count > 0)
              .map(([id, name, count, colour]) => (
                <button
                  key={id}
                  className="flex h-[28px] items-center gap-1.5 rounded-pill px-3 text-sm"
                  style={{
                    color: filter === id ? '#fff' : colour,
                    background:
                      filter === id
                        ? 'var(--accent)'
                        : `color-mix(in srgb, ${colour} 12%, transparent)`,
                    transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
                  }}
                  onClick={() => setFilter(filter === id ? 'all' : id)}
                >
                  {name}
                  <span className="text-2xs tabular-nums opacity-70">{count}</span>
                </button>
              ))}
            {counts.stolen + counts.weak + counts.reused === 0 && (
              <span className="ml-1 text-sm" style={{ color: 'var(--good)' }}>
                {t('Проверка не нашла проблем')}
              </span>
            )}
          </div>
        )}

        {/* Keyed by section, so changing tabs is the new list arriving and
            not the old one being overwritten in place. */}
        <div key={section} className="animate-swap">
        {section === 'bin' ? (
          <BinTab items={binned} locked={locked} onChanged={() => void refresh()} />
        ) : section === 'cards' ? (
          <CardsTab
            cards={cards}
            locked={locked}
            onChange={() => void refresh()}
            onError={setError}
          />
        ) : section === 'addresses' ? (
          <AddressesTab
            addresses={addresses}
            locked={locked}
            onChange={() => void refresh()}
            onError={setError}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Key width={26} height={26} />}
            title={t('Сохранённых паролей нет')}
            hint={t('Войдите на сайт — браузер предложит сохранить пароль. Или добавьте запись вручную.')}
          />
        ) : (
          /* A list of sites, and nothing else until one is opened. Every row
             used to carry a password box and three buttons, so a screenful of
             saved logins read as a wall of dots. */
          <div className="card stagger overflow-hidden">
            {filtered.map((item) => {
              const open = expanded === item.id
              return (
                <div key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-hover)]"
                    style={{ transition: 'background var(--t-fast) linear' }}
                    onClick={() => {
                      setExpanded(open ? null : item.id)
                      setError('')
                      if (open) setRevealed(({ [item.id]: _drop, ...rest }) => rest)
                    }}
                  >
                    <SiteIcon host={item.origin} icon={icons[normalizeHost(item.origin)]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">{item.origin}</span>
                      <span className="block truncate text-sm text-dim">
                        {item.username || t('без имени')}
                      </span>
                    </span>
                    <Badges audit={audit[item.id]} stolen={stolenSet.has(item.id)} />
                    <ChevronRight
                      width={14}
                      height={14}
                      className="shrink-0 text-faint"
                      style={{
                        transform: open ? 'rotate(90deg)' : 'none',
                        transition: 'transform var(--t-fast) var(--ease-out)'
                      }}
                    />
                  </button>

                  {open && (
                    <div className="animate-fade flex flex-col gap-2 px-4 pb-3.5 pt-0.5">
                      <Line
                        label={t('Логин')}
                        value={item.username || t('без имени')}
                        onCopy={
                          item.username
                            ? () => void window.browser.copyText(item.username)
                            : undefined
                        }
                      />
                      <Line
                        label={t('Пароль')}
                        value={revealed[item.id] ?? '••••••••••'}
                        mono
                        onCopy={async () => {
                          const ok = await window.browser.vaultCopy(item.id)
                          if (!ok) setError(t('Хранилище заблокировано'))
                        }}
                        onReveal={async () => {
                          if (revealed[item.id]) {
                            setRevealed(({ [item.id]: _drop, ...rest }) => rest)
                            return
                          }
                          const value = await window.browser.vaultReveal(item.id)
                          if (value) setRevealed((prev) => ({ ...prev, [item.id]: value }))
                          else setError(t('Хранилище заблокировано'))
                        }}
                        revealed={Boolean(revealed[item.id])}
                      />
                      <CodeBlock
                        id={item.id}
                        has={Boolean(item.code)}
                        onChanged={() => void refresh()}
                      />
                      <div className="flex items-center gap-3 pt-1">
                        <span className="mr-auto text-2xs text-faint">
                          добавлен {formatDate(item.created)}
                        </span>
                        <button
                          className="btn h-[28px] px-3 text-sm"
                          style={{ color: 'var(--bad)' }}
                          onClick={() => {
                            setError('')
                            setConfirmDelete(item)
                          }}
                        >
                          <Cross width={13} height={13} />
                          {t('Удалить')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        </div>

        {section === 'passwords' && (
          <p className="mt-4 flex items-center gap-2 text-sm text-faint">
            <Shield width={14} height={14} />
            {t('Пароли шифруются по отдельности (AES-256-GCM); сайт и имя пользователя входят в аутентифицируемые данные, поэтому запись нельзя подставить другому сайту.')}
          </p>
        )}
        {note && <p className="mt-2 text-sm" style={{ color: 'var(--good)' }}>{note}</p>}
        {error && <p className="mt-2 text-sm" style={{ color: 'var(--warn)' }}>{error}</p>}
      </div>

      {unlockOpen && (
        <UnlockDialog
          onClose={() => setUnlockOpen(false)}
          onDone={() => {
            setUnlockOpen(false)
            void refresh()
          }}
        />
      )}
      {masterOpen && (
        <MasterDialog
          mode={state?.mode ?? 'os'}
          onClose={() => setMasterOpen(false)}
          onDone={() => {
            setMasterOpen(false)
            void refresh()
          }}
        />
      )}
      {genOpen && <Generator onClose={() => setGenOpen(false)} />}
      {addOpen && (
        <AddDialog
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            void refresh()
          }}
        />
      )}

      {/* Deleting a password is not undoable and there is no copy of it
          anywhere else, so it is asked about — and refused outright while the
          vault is shut, because whoever is at the keyboard then has not shown
          they are allowed to touch it. */}
      {confirmDelete && (
        <Modal
          title={locked ? t('Хранилище заблокировано') : t('Удалить пароль?')}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                {locked ? t('Закрыть') : t('Отмена')}
              </button>
              {locked ? (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setConfirmDelete(null)
                    setUnlockOpen(true)
                  }}
                >
                  {t('Разблокировать')}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  style={{ background: 'var(--bad)' }}
                  onClick={async () => {
                    const ok = await window.browser.vaultRemove(confirmDelete.id)
                    setConfirmDelete(null)
                    if (!ok) setError(t('Не удалось удалить запись'))
                    else {
                      setExpanded(null)
                      void refresh()
                    }
                  }}
                >
                  {t('Удалить')}
                </button>
              )}
            </>
          }
        >
          <p className="text-sm text-dim">
            {locked
              ? t('Сначала откройте хранилище — пока оно закрыто, записи нельзя ни прочитать, ни удалить.')
              : t('Запись для {host} будет удалена без возможности восстановить.', {
                  host: confirmDelete.origin
                })}
          </p>
        </Modal>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- list pieces */

/** The site's own icon, with its first letter until one arrives. */
function SiteIcon({ host, icon }: { host: string; icon?: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] text-sm font-semibold text-white"
      style={icon ? { background: 'var(--field-idle)' } : { background: 'color-mix(in srgb, var(--accent) 75%, #555)' }}
    >
      {icon ? (
        <img src={icon} alt="" width={18} height={18} style={{ objectFit: 'contain' }} />
      ) : (
        host.charAt(0).toUpperCase()
      )}
    </span>
  )
}

/** One value of an opened entry, with the buttons that act on it. */
function Line({
  label,
  value,
  mono,
  onCopy,
  onReveal,
  revealed
}: {
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
  onReveal?: () => void
  revealed?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[104px] shrink-0 text-2xs uppercase tracking-wider text-faint">{label}</span>
      <span
        className={`min-w-0 flex-1 truncate rounded-[8px] px-2.5 py-1.5 text-sm ${mono ? 'font-mono' : ''}`}
        style={{ background: 'var(--field-idle)' }}
      >
        {value}
      </span>
      {onReveal && (
        <button className="icon-btn shrink-0" title={revealed ? t('Скрыть') : t('Показать')} onClick={onReveal}>
          {revealed ? <EyeOff width={14} height={14} /> : <Eye width={14} height={14} />}
        </button>
      )}
      {onCopy && (
        <button className="icon-btn shrink-0" title={t('Копировать')} onClick={onCopy}>
          <Copy width={14} height={14} />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ dialogs */
function UnlockDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    const ok = await window.browser.vaultUnlock(password)
    if (ok) onDone()
    else setError(t('Неверный мастер-пароль'))
  }

  return (
    <Modal
      title={t('Разблокировать хранилище')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t('Разблокировать')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <TextField
          value={password}
          onChange={setPassword}
          type="password"
          placeholder={t('Мастер-пароль')}
          width="100%"
          autoFocus
          onEnter={submit}
        />
        {error && <span className="text-sm" style={{ color: 'var(--bad)' }}>{error}</span>}
      </div>
    </Modal>
  )
}

function MasterDialog({
  mode,
  onClose,
  onDone
}: {
  mode: 'os' | 'password'
  onClose: () => void
  onDone: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    if (next.length < 8) return setError(t('Минимум 8 символов'))
    if (next !== repeat) return setError(t('Пароли не совпадают'))
    const ok = await window.browser.vaultSetMaster(mode === 'password' ? current : null, next)
    if (ok) onDone()
    else setError(t('Не удалось сменить пароль — проверьте текущий'))
  }

  return (
    <Modal
      title={mode === 'password' ? t('Сменить мастер-пароль') : t('Задать мастер-пароль')}
      onClose={onClose}
      footer={
        <>
          {mode === 'password' && (
            <button
              className="btn mr-auto"
              onClick={async () => {
                const ok = await window.browser.vaultDropMaster(current)
                if (ok) onDone()
                else setError(t('Неверный текущий пароль'))
              }}
            >
              {t('Убрать мастер-пароль')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-dim">
          С мастер-паролем ключ шифрования выводится из него функцией scrypt и нигде не хранится:
          {t('без пароля записи невозможно расшифровать даже на этом компьютере.')}
        </p>
        {mode === 'password' && (
          <TextField value={current} onChange={setCurrent} type="password" placeholder={t('Текущий пароль')} width="100%" />
        )}
        <TextField value={next} onChange={setNext} type="password" placeholder={t('Новый пароль')} width="100%" autoFocus />
        <TextField value={repeat} onChange={setRepeat} type="password" placeholder={t('Повторите пароль')} width="100%" onEnter={submit} />
        {error && <span className="text-sm" style={{ color: 'var(--bad)' }}>{error}</span>}
      </div>
    </Modal>
  )
}

function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [origin, setOrigin] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  return (
    <Modal
      title={t('Новая запись')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const ok = await window.browser.vaultSave({
                origin: origin.replace(/^https?:\/\//i, '').split('/')[0],
                username,
                password
              })
              if (ok) onDone()
              else setError(t('Хранилище заблокировано'))
            }}
          >
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField value={origin} onChange={setOrigin} placeholder={t('Сайт, например github.com')} width="100%" autoFocus />
        <TextField value={username} onChange={setUsername} placeholder={t('Логин или почта')} width="100%" />
        <div className="flex gap-2">
          <TextField value={password} onChange={setPassword} type="password" placeholder={t('Пароль')} width="100%" />
          <button
            className="btn shrink-0"
            title={t('Сгенерировать надёжный пароль')}
            onClick={async () => setPassword(await window.browser.vaultGenerate(20))}
          >
            <Wand width={15} height={15} />
          </button>
        </div>
        {error && <span className="text-sm" style={{ color: 'var(--bad)' }}>{error}</span>}
      </div>
    </Modal>
  )
}
