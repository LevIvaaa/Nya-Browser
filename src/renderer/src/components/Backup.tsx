import { useState } from 'react'
import { Row } from './ui'
import { t } from '../i18n'
import type { BackupCounts } from '../../../shared/types'

/**
 * The whole profile into one sealed file, and back out of it.
 *
 * One password, chosen here, is the only thing that opens the file — so it is
 * asked for before either button does anything, and nothing is written or read
 * without it. What happened is said in numbers afterwards, because a backup
 * that claims success without saying what it carried is not a backup anybody
 * should trust.
 */
export function Backup() {
  const [password, setPassword] = useState('')
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)

  const tell = (counts: BackupCounts | null, ok: string) => {
    if (!counts) {
      setSaid(t('Неверный пароль'))
      return
    }
    setSaid(
      `${ok}: ${counts.passwords} · ${counts.cards} · ${counts.bookmarks} · ${counts.history}`
    )
  }

  const run = async (what: 'save' | 'restore') => {
    if (password.length < 4 || busy) return
    setBusy(true)
    setSaid('')
    try {
      const counts =
        what === 'save'
          ? await window.browser.makeBackup(password)
          : await window.browser.restoreBackup(password)
      tell(counts, what === 'save' ? t('Копия сохранена') : t('Восстановлено'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Row title={t('Пароль')} hint={t('Пароли, карты, закладки, история и настройки — в одном файле')}>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-[180px] rounded-[var(--radius-md)] px-3 py-1.5 text-sm outline-none"
          style={{ background: 'var(--field-idle)', border: '1px solid var(--line)' }}
        />
      </Row>
      <Row title={t('Сохранить копию')}>
        <button className="btn btn-primary" disabled={password.length < 4 || busy} onClick={() => void run('save')}>
          {t('Сохранить')}
        </button>
      </Row>
      <Row title={t('Восстановить из копии')}>
        <button className="btn" disabled={password.length < 4 || busy} onClick={() => void run('restore')}>
          {t('Восстановить')}
        </button>
      </Row>
      {said && <Row title={said} />}
    </>
  )
}
