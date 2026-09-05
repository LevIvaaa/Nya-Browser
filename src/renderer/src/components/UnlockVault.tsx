import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { Key, Lock, Shield } from './Icons'

/**
 * The one question the browser asks when it starts, when the vault is set to
 * stay shut until someone answers it.
 *
 * Windows Hello answers it with the PIN, fingerprint or face the machine
 * already knows; a master password answers it by being typed. Either way it is
 * asked once — after this the vault is open for as long as the browser runs.
 *
 * Nothing about the browser waits on it. The card can be dismissed and the
 * vault stays shut, which is a browser without saved passwords rather than a
 * browser you cannot use.
 */
export default function UnlockVault({
  mode,
  hello,
  onDone,
  onSkip
}: {
  /** 'password' when a master password is set, 'os' when the keychain holds it */
  mode: 'os' | 'password'
  /** whether Windows Hello has a key put aside for it */
  hello: boolean
  onDone: () => void
  onSkip: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [wrong, setWrong] = useState(false)
  const field = useRef<HTMLInputElement>(null)

  // Hello first when it is there: it is the faster answer and the one that
  // needs no typing.
  useEffect(() => {
    if (hello) void viaHello()
    else field.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function viaHello() {
    if (busy) return
    setBusy(true)
    setWrong(false)
    const ok = await window.browser.vaultHelloUnlock()
    setBusy(false)
    if (ok) return onDone()
    setWrong(true)
    field.current?.focus()
  }

  async function viaPassword() {
    if (busy || !password) return
    setBusy(true)
    const ok = await window.browser.vaultUnlock(password)
    setBusy(false)
    setPassword('')
    if (ok) return onDone()
    setWrong(true)
    field.current?.focus()
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center">
      <div
        className="animate-fade absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg) 72%, transparent)', backdropFilter: 'blur(14px)' }}
      />

      <div
        className="animate-sheet relative w-[min(400px,92vw)] rounded-card p-6"
        style={{
          background: 'var(--elevated)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-xl)'
        }}
      >
        <div
          className="mb-4 flex h-11 w-11 items-center justify-center rounded-[13px]"
          style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
        >
          <Lock width={20} height={20} />
        </div>

        <h2 className="text-lg font-semibold text-ink">{t('Пароли под замком')}</h2>
        <p className="mt-1 text-sm text-dim">
          {hello
            ? t('Подтвердите, что это вы — Windows Hello или мастер-пароль')
            : mode === 'password'
              ? t('Введите мастер-пароль, чтобы открыть хранилище')
              : t('Подтвердите, что это вы, чтобы открыть хранилище')}
        </p>

        {hello && (
          <button
            className="btn btn-primary mt-4 h-[38px] w-full justify-center"
            disabled={busy}
            onClick={() => void viaHello()}
          >
            <Shield width={16} height={16} />
            {busy ? t('Ждём Windows Hello…') : t('Windows Hello')}
          </button>
        )}

        {/* The keychain holds the key and nothing else can be asked for: this is
            a deliberate open rather than a proof. */}
        {mode === 'os' && !hello && (
          <button
            className="btn btn-primary mt-4 h-[38px] w-full justify-center"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await window.browser.vaultUnlock('')
              setBusy(false)
              if (ok) onDone()
              else setWrong(true)
            }}
          >
            <Key width={16} height={16} />
            {t('Открыть хранилище')}
          </button>
        )}

        {mode === 'password' && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                ref={field}
                type="password"
                value={password}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('Мастер-пароль')}
                className="field h-[38px] min-w-0 flex-1"
                onChange={(event) => {
                  setPassword(event.target.value)
                  setWrong(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void viaPassword()
                }}
              />
              <button
                className="btn h-[38px] shrink-0 px-4"
                disabled={busy || !password}
                onClick={() => void viaPassword()}
              >
                <Key width={15} height={15} />
                {t('Открыть')}
              </button>
            </div>
          </div>
        )}

        {wrong && (
          <p className="mt-2 text-sm" style={{ color: 'var(--danger, #e5484d)' }}>
            {mode === 'password' ? t('Неверный пароль') : t('Не удалось подтвердить')}
          </p>
        )}

        <button className="mt-4 w-full text-center text-sm text-faint hover:text-dim" onClick={onSkip}>
          {t('Не сейчас')}
        </button>
      </div>
    </div>
  )
}
