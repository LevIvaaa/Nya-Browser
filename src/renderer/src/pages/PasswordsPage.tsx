import { t } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { Credential, VaultState } from '../../../preload/index'
import { ChevronRight, Copy, Cross, Eye, EyeOff, Key, Lock, LockOpen, Plus, Search, Shield, Wand } from '../components/Icons'
import { EmptyState, Modal, Pill, TextField, formatDate } from '../components/ui'

const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, '')

export default function PasswordsPage() {
  const [state, setState] = useState<VaultState | null>(null)
  const [items, setItems] = useState<Credential[]>([])
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Credential | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    setState(await window.browser.vaultState())
    setItems(await window.browser.vaultList())
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.origin.includes(q) || item.username.toLowerCase().includes(q))
  }, [items, query])

  const locked = state?.locked ?? true

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Пароли')}</h1>
            <p className="text-sm text-dim">
              {items.length} записей ·{' '}
              {state?.mode === 'password' ? t('защищено мастер-паролем') : t('защищено ключом Windows')}
            </p>
          </div>
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
        </header>

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

        {items.length === 0 ? (
          <EmptyState
            icon={<Key width={26} height={26} />}
            title={t('Сохранённых паролей нет')}
            hint={t('Войдите на сайт — браузер предложит сохранить пароль. Или добавьте запись вручную.')}
          />
        ) : (
          /* A list of sites, and nothing else until one is opened. Every row
             used to carry a password box and three buttons, so a screenful of
             saved logins read as a wall of dots. */
          <div className="card overflow-hidden">
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

        <p className="mt-4 flex items-center gap-2 text-sm text-faint">
          <Shield width={14} height={14} />
          {t('Пароли шифруются по отдельности (AES-256-GCM); сайт и имя пользователя входят в аутентифицируемые данные, поэтому запись нельзя подставить другому сайту.')}
        </p>
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
      <span className="w-[70px] shrink-0 text-2xs uppercase tracking-wider text-faint">{label}</span>
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
