import { useEffect, useMemo, useState } from 'react'
import { t } from '../i18n'
import type { Credential } from '../../../preload/index'
import type { PasswordAudit } from '../../../shared/types'
import { DEFAULT_SHAPE, judge, makePassword } from '../../../shared/password'
import type { PasswordShape } from '../../../shared/password'
import { Copy, Cross, Download, Note, Plus, Refresh, Trash, Wand } from '../components/Icons'
import { EmptyState, Modal, Pill, Slider, Toggle, formatBytes, formatDate } from '../components/ui'

/**
 * What the vault page grew for 1.2: a verdict on every password, the one-time
 * code that belongs beside it, the bin a deleted entry waits in, and a
 * generator that makes the next one.
 */

/** What the check found about one entry, said in a word. */
export function Badges({ audit, stolen }: { audit?: PasswordAudit; stolen?: boolean }) {
  if (!audit && !stolen) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {stolen && <Pill tone="bad">{t('В утечке')}</Pill>}
      {audit?.verdict === 'weak' && <Pill tone="warn">{t('Слабый')}</Pill>}
      {audit?.reused && <Pill tone="warn">{t('Повторяется')}</Pill>}
      {audit?.old && !stolen && audit.verdict !== 'weak' && !audit.reused && <Pill>{t('Старый')}</Pill>}
    </span>
  )
}

/**
 * The six digits an authenticator app would show, beside the password they
 * belong to. The secret is pasted once and never shown again — there is
 * nothing to read it back for.
 */
export function CodeBlock({
  id,
  has,
  onChanged
}: {
  id: string
  has: boolean
  onChanged: () => void
}) {
  const [code, setCode] = useState<{ digits: string; left: number } | null>(null)
  const [secret, setSecret] = useState('')
  const [bad, setBad] = useState(false)

  useEffect(() => {
    if (!has) return
    let alive = true
    const tick = async () => {
      const next = await window.browser.vaultCode(id)
      if (alive) setCode(next)
    }
    void tick()
    const timer = window.setInterval(tick, 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [id, has])

  if (!has) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-[124px] shrink-0 text-2xs uppercase tracking-wider text-faint">
          {t('Одноразовый код')}
        </span>
        <input
          value={secret}
          onChange={(event) => {
            setSecret(event.target.value)
            setBad(false)
          }}
          placeholder={t('Ключ или ссылка otpauth://')}
          className="field focus-ring min-w-0 flex-1 text-sm"
          style={{ height: 30, borderColor: bad ? 'var(--bad)' : undefined }}
        />
        <button
          className="btn h-[30px] shrink-0 px-3 text-sm"
          disabled={!secret.trim()}
          onClick={async () => {
            const ok = await window.browser.vaultSetCode(id, secret.trim())
            if (!ok) return setBad(true)
            setSecret('')
            onChanged()
          }}
        >
          {t('Сохранить')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-[124px] shrink-0 text-2xs uppercase tracking-wider text-faint">
        {t('Одноразовый код')}
      </span>
      <span
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] px-2.5 py-1.5"
        style={{ background: 'var(--field-idle)' }}
      >
        <span className="font-mono text-[17px] leading-none tracking-[0.14em] tabular-nums">
          {code ? `${code.digits.slice(0, 3)} ${code.digits.slice(3)}` : '··· ···'}
        </span>
        {/* The seconds left, drawn rather than counted out: the bar empties and
            the code changes when it reaches the end. */}
        <span
          className="ml-auto h-[4px] w-[56px] shrink-0 overflow-hidden rounded-pill"
          style={{ background: 'var(--line-strong)' }}
        >
          <span
            style={{
              display: 'block',
              width: `${code ? Math.round((code.left / 30) * 100) : 0}%`,
              height: '100%',
              borderRadius: 999,
              background: code && code.left <= 5 ? 'var(--warn)' : 'var(--accent)',
              transition: code && code.left === 30 ? 'none' : 'width 1s linear'
            }}
          />
        </span>
      </span>
      <button
        className="icon-btn shrink-0"
        title={t('Копировать')}
        onClick={() => code && void window.browser.copyText(code.digits)}
      >
        <Copy width={14} height={14} />
      </button>
      <button
        className="icon-btn shrink-0"
        title={t('Удалить')}
        onClick={async () => {
          await window.browser.vaultSetCode(id, '')
          onChanged()
        }}
      >
        <Cross width={14} height={14} />
      </button>
    </div>
  )
}

/**
 * The line beside a password that is not a password: the recovery code, the
 * answer to "your first school", which of three accounts this one is. It saves
 * when the field is left, because a Save button for one line is a Save button
 * people forget to press.
 */
export function NoteBlock({ id, note, onSaved }: { id: string; note: string; onSaved: () => void }) {
  const [text, setText] = useState(note)
  useEffect(() => setText(note), [note, id])
  return (
    <div className="flex items-start gap-2">
      <span className="w-[124px] shrink-0 pt-1.5 text-2xs uppercase tracking-wider text-faint">
        {t('Заметка')}
      </span>
      <textarea
        value={text}
        rows={text.length > 60 ? 3 : 1}
        onChange={(event) => setText(event.target.value)}
        onBlur={async () => {
          if (text === note) return
          await window.browser.vaultSetNote(id, text)
          onSaved()
        }}
        placeholder="—"
        className="field focus-ring min-w-0 flex-1 resize-none py-1.5 text-sm"
        style={{ height: 'auto', minHeight: 32 }}
      />
    </div>
  )
}

/**
 * One file kept with the entry — the sheet of recovery codes a bank prints
 * once. It is sealed by the same key as the password and never lands on disk
 * in the clear; taking it out is a save dialog, which is a deliberate act.
 */
export function FileBlock({
  id,
  file,
  onChanged
}: {
  id: string
  file?: { name: string; size: number }
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <span className="w-[124px] shrink-0 text-2xs uppercase tracking-wider text-faint">
        {t('Вложение')}
      </span>
      {file ? (
        <>
          <span
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-sm"
            style={{ background: 'var(--field-idle)' }}
          >
            <Note width={13} height={13} className="shrink-0 text-faint" />
            <span className="truncate">{file.name}</span>
            <span className="ml-auto shrink-0 text-2xs tabular-nums text-faint">
              {formatBytes(file.size)}
            </span>
          </span>
          <button
            className="icon-btn shrink-0"
            title={t('Сохранить файл')}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await window.browser.vaultSaveAttachment(id)
              setBusy(false)
            }}
          >
            <Download width={14} height={14} />
          </button>
          <button
            className="icon-btn shrink-0"
            title={t('Удалить')}
            onClick={async () => {
              await window.browser.vaultDetach(id)
              onChanged()
            }}
          >
            <Cross width={14} height={14} />
          </button>
        </>
      ) : (
        <button
          className="btn h-[30px] px-3 text-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await window.browser.vaultAttach(id)
            setBusy(false)
            if (ok) onChanged()
          }}
        >
          <Plus width={13} height={13} />
          {t('Прикрепить файл')}
        </button>
      )}
    </div>
  )
}

/** What was deleted, and the thirty days it has to be taken back. */
export function BinTab({
  items,
  locked,
  onChanged
}: {
  items: Credential[]
  locked: boolean
  onChanged: () => void
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Trash width={26} height={26} />}
        title={t('Корзина')}
        hint={t('Удалённые записи ждут здесь тридцать дней')}
      />
    )
  }
  return (
    <>
      <div className="card stagger overflow-hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ borderTop: '1px solid var(--line)' }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{item.origin}</span>
              <span className="block truncate text-sm text-dim">
                {item.username || t('без имени')} · {formatDate(item.binned ?? item.used)}
              </span>
            </span>
            <button
              className="btn h-[28px] shrink-0 px-3 text-sm"
              disabled={locked}
              onClick={async () => {
                await window.browser.vaultRestore(item.id)
                onChanged()
              }}
            >
              <Refresh width={13} height={13} />
              {t('Восстановить')}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <p className="mr-auto text-sm text-faint">
          {t('Удалённые записи ждут здесь тридцать дней')}
        </p>
        <button
          className="btn"
          style={{ color: 'var(--bad)' }}
          disabled={locked}
          onClick={async () => {
            await window.browser.vaultEmptyBin()
            onChanged()
          }}
        >
          <Trash width={14} height={14} />
          {t('Очистить корзину')}
        </button>
      </div>
    </>
  )
}

/**
 * The generator, with the dials visible. A password is worth nothing if it is
 * refused by the site that asked for it, so the alphabet is adjustable and the
 * verdict below says what the audit would say about this one.
 */
export function Generator({
  onClose,
  onUse
}: {
  onClose: () => void
  onUse?: (password: string) => void
}) {
  const [shape, setShape] = useState<PasswordShape>(DEFAULT_SHAPE)
  const [seed, setSeed] = useState(0)
  const password = useMemo(() => makePassword(shape), [shape, seed])
  const verdict = judge(password)
  const words: Record<string, string> = {
    weak: t('Слабый'),
    fair: t('Средний'),
    good: t('Надёжный')
  }
  const colours: Record<string, string> = {
    weak: 'var(--bad)',
    fair: 'var(--warn)',
    good: 'var(--good)'
  }

  return (
    <Modal
      title={t('Генератор паролей')}
      onClose={onClose}
      width={470}
      footer={
        <>
          <button className="btn mr-auto" onClick={() => setSeed((n) => n + 1)}>
            <Refresh width={14} height={14} />
            {t('Сгенерировать')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('Закрыть')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (onUse) onUse(password)
              else void window.browser.copyText(password)
              onClose()
            }}
          >
            {onUse ? t('Сохранить') : t('Копировать')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex items-center gap-2 rounded-[12px] px-3.5 py-3"
          style={{ background: 'var(--field-idle)' }}
        >
          <span className="min-w-0 flex-1 break-all font-mono text-[15px] leading-snug">
            {password}
          </span>
          <button
            className="icon-btn shrink-0"
            title={t('Копировать')}
            onClick={() => void window.browser.copyText(password)}
          >
            <Copy width={14} height={14} />
          </button>
        </div>

        {/* Three bars rather than a number: nobody acts on "74 bits". */}
        <div className="flex items-center gap-3">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-[5px] w-[34px] rounded-pill"
                style={{
                  background:
                    i <= ['weak', 'fair', 'good'].indexOf(verdict)
                      ? colours[verdict]
                      : 'var(--line-strong)',
                  transition: 'background var(--t-base) linear'
                }}
              />
            ))}
          </span>
          <span className="text-sm font-medium" style={{ color: colours[verdict] }}>
            {words[verdict]}
          </span>
        </div>

        <label className="flex items-center gap-3">
          <span className="mr-auto text-base">{t('Длина')}</span>
          <Slider
            value={shape.length}
            min={8}
            max={48}
            onChange={(length) => setShape((prev) => ({ ...prev, length }))}
            width={190}
          />
        </label>
        {(
          [
            ['upper', t('Заглавные')],
            ['digits', t('Цифры')],
            ['marks', t('Знаки')]
          ] as Array<[keyof PasswordShape, string]>
        ).map(([field, label]) => (
          <label key={field} className="flex items-center gap-3">
            <span className="mr-auto text-base">{label}</span>
            <Toggle
              checked={Boolean(shape[field])}
              label={label}
              onChange={(value) => setShape((prev) => ({ ...prev, [field]: value }))}
            />
          </label>
        ))}
        <p className="text-sm text-faint">
          {t('Похожие друг на друга символы (l и 1, O и 0) не используются — такой пароль можно продиктовать.')}
        </p>
      </div>
    </Modal>
  )
}

export { Wand }
