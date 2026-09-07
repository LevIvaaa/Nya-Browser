import { t } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Key } from './Icons'
import type { SavePasswordOffer } from '../../../preload/index'

/**
 * The question after a login form is sent: keep this password?
 *
 * It used to be a bar across the whole window, while everything else about
 * passwords moved into a card in the corner. This is that card — on the right,
 * where nothing else is — and the login and the password can be corrected
 * before they become the only copy: what the page sent is sometimes a typo, and
 * a generated password is sometimes worth adjusting.
 *
 * It is only asked at all when the answer could change something. A password
 * the vault already holds for that name, unchanged, is the one the browser
 * filled in a moment ago; asking to save it again taught people to dismiss the
 * question without reading it.
 */
export default function SavePassword({
  offer,
  onClose
}: {
  offer: SavePasswordOffer | null
  onClose: () => void
}) {
  const [username, setUsername] = useState(offer?.username ?? '')
  const [password, setPassword] = useState(offer?.password ?? '')
  const [shown, setShown] = useState(false)
  const first = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setUsername(offer?.username ?? '')
    setPassword(offer?.password ?? '')
  }, [offer?.host, offer?.username, offer?.password])

  useEffect(() => {
    first.current?.focus()
  }, [])

  if (!offer) return null

  const save = async () => {
    await window.browser.vaultConfirmSave(true, username, password)
    onClose()
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
      onKeyDown={(event) => {
        if (event.key === 'Enter') void save()
        if (event.key === 'Escape') void window.browser.vaultConfirmSave(false)
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Key width={15} height={15} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">
            {offer.known ? t('Обновить пароль?') : t('Сохранить пароль?')}
          </span>
          <span className="block truncate text-2xs text-faint">{offer.host}</span>
        </span>
      </div>

      <input
        ref={first}
        className="field mt-3 h-[34px] text-sm"
        placeholder={t('Логин')}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          className="field h-[34px] min-w-0 flex-1 text-sm"
          type={shown ? 'text' : 'password'}
          placeholder={t('Пароль')}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] hover:bg-[var(--surface-hover)]"
          style={{ background: 'var(--field-idle)', color: 'var(--text-dim)' }}
          title={shown ? t('Скрыть пароль') : t('Показать пароль')}
          onClick={() => setShown((on) => !on)}
        >
          {shown ? <EyeOff width={14} height={14} /> : <Eye width={14} height={14} />}
        </button>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3">
        <button
          className="btn h-[32px] flex-1 justify-center"
          onClick={() => void window.browser.vaultConfirmSave(false)}
        >
          {t('Не сейчас')}
        </button>
        <button
          className="btn btn-primary h-[32px] flex-1 justify-center"
          disabled={!password}
          onClick={save}
        >
          {offer.known ? t('Обновить') : t('Сохранить')}
        </button>
      </div>
    </div>
  )
}
