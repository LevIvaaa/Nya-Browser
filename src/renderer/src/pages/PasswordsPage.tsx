import { t } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import type { Credential, VaultState } from '../../../preload/index'
import { Copy, Cross, Eye, EyeOff, Key, Lock, LockOpen, Plus, Search, Shield, Wand } from '../components/Icons'
import { EmptyState, Modal, Pill, TextField, formatDate } from '../components/ui'

export default function PasswordsPage() {
  const [state, setState] = useState<VaultState | null>(null)
  const [items, setItems] = useState<Credential[]>([])
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<Record<string, string>>({})
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
          <div className="card overflow-hidden">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="group flex flex-wrap items-center gap-3 px-4 py-3"
                style={{ borderTop: '1px solid var(--line)' }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-sm font-semibold text-white"
                  style={{ background: 'color-mix(in srgb, var(--accent) 75%, #555)' }}
                >
                  {item.origin.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-base font-medium">{item.origin}</div>
                  <div className="truncate text-sm text-dim">{item.username || t('без имени')}</div>
                </div>

                <div className="flex items-center gap-2">
                  <code
                    className="rounded-[8px] px-2 py-1 font-mono text-xs"
                    style={{ background: 'var(--field-idle)', minWidth: 120 }}
                  >
                    {revealed[item.id] ?? '••••••••••'}
                  </code>
                  <button
                    className="icon-btn"
                    title={revealed[item.id] ? t('Скрыть') : t('Показать')}
                    onClick={async () => {
                      if (revealed[item.id]) {
                        setRevealed(({ [item.id]: _drop, ...rest }) => rest)
                        return
                      }
                      const value = await window.browser.vaultReveal(item.id)
                      if (value) setRevealed((prev) => ({ ...prev, [item.id]: value }))
                      else setError(t('Хранилище заблокировано'))
                    }}
                  >
                    {revealed[item.id] ? <EyeOff width={14} height={14} /> : <Eye width={14} height={14} />}
                  </button>
                  <button
                    className="icon-btn"
                    title={t('Копировать пароль')}
                    onClick={async () => {
                      const value = await window.browser.vaultReveal(item.id)
                      if (value) await navigator.clipboard.writeText(value)
                    }}
                  >
                    <Copy width={14} height={14} />
                  </button>
                  <button
                    className="icon-btn"
                    title={t('Удалить')}
                    onClick={async () => {
                      await window.browser.vaultRemove(item.id)
                      void refresh()
                    }}
                  >
                    <Cross width={14} height={14} />
                  </button>
                </div>

                <span className="w-full text-2xs text-faint md:w-auto">
                  добавлен {formatDate(item.created)}
                </span>
              </div>
            ))}
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
