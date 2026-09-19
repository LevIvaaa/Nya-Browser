import { useMemo, useState } from 'react'
import { t } from '../i18n'
import type { PageFile } from '../../../preload/index'
import { Doc, Download, Film, Image as Picture } from './Icons'
import { Modal, cx } from './ui'

/**
 * Everything on the page that could be kept, with a tick against each one.
 *
 * The alternative is what everybody actually does: right-click, save as,
 * right-click, save as, forty times, and then wondering which of them was
 * missed. The list comes from the page itself — what it links to and what it
 * shows — so nothing here is a guess about what might exist at an address.
 */
type Group = 'picture' | 'media' | 'file'

const MARKS: Record<Group, () => JSX.Element> = {
  picture: () => <Picture width={14} height={14} />,
  media: () => <Film width={14} height={14} />,
  file: () => <Doc width={14} height={14} />
}

export default function PageFiles({
  files,
  onClose
}: {
  files: PageFile[]
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(files.map((f) => f.url)))
  const [group, setGroup] = useState<Group | 'all'>('all')

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: files.length, picture: 0, media: 0, file: 0 }
    for (const file of files) out[file.kind] = (out[file.kind] ?? 0) + 1
    return out
  }, [files])

  const shown = group === 'all' ? files : files.filter((file) => file.kind === group)
  const chosen = shown.filter((file) => picked.has(file.url))

  const toggle = (url: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })

  return (
    <Modal
      title={t('Файлы на странице')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            className="btn mr-auto"
            onClick={() =>
              setPicked(
                chosen.length === shown.length
                  ? new Set([...picked].filter((url) => !shown.some((f) => f.url === url)))
                  : new Set([...picked, ...shown.map((f) => f.url)])
              )
            }
          >
            {chosen.length === shown.length && shown.length > 0 ? t('Снять всё') : t('Выбрать всё')}
          </button>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn btn-primary"
            disabled={chosen.length === 0}
            onClick={() => {
              void window.browser.downloadMany(chosen.map((file) => file.url))
              onClose()
            }}
          >
            <Download width={14} height={14} />
            {t('Скачать')} {chosen.length > 0 ? chosen.length : ''}
          </button>
        </>
      }
    >
      {files.length === 0 ? (
        <p className="py-6 text-center text-sm text-dim">{t('Ничего не найдено')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['all', t('Все')],
                ['picture', t('Картинки')],
                ['media', t('Видео и музыка')],
                ['file', t('Документы')]
              ] as Array<[Group | 'all', string]>
            )
              .filter(([id]) => id === 'all' || counts[id] > 0)
              .map(([id, name]) => (
                <button
                  key={id}
                  className={cx(
                    'flex h-[26px] items-center gap-1.5 rounded-pill px-2.5 text-sm',
                    group === id ? 'font-medium' : 'text-dim hover:text-ink'
                  )}
                  style={{
                    color: group === id ? '#fff' : undefined,
                    background: group === id ? 'var(--accent)' : 'var(--field-idle)',
                    transition: 'background var(--t-fast) linear, color var(--t-fast) linear'
                  }}
                  onClick={() => setGroup(id)}
                >
                  {name}
                  <span className="text-2xs tabular-nums opacity-70">{counts[id]}</span>
                </button>
              ))}
          </div>

          <div
            className="max-h-[340px] overflow-y-auto rounded-[var(--radius-md)]"
            style={{ border: '1px solid var(--line)' }}
          >
            {shown.map((file, index) => {
              const on = picked.has(file.url)
              const Mark = MARKS[(file.kind as Group) in MARKS ? (file.kind as Group) : 'file']
              return (
                <button
                  // A page can offer the same address twice — the same photo
                  // linked from two places — and two rows with one key is one
                  // row on screen.
                  key={`${file.url}#${index}`}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
                  style={{ transition: 'background var(--t-fast) linear' }}
                  onClick={() => toggle(file.url)}
                >
                  <span
                    className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] text-[11px] font-bold text-white"
                    style={{
                      background: on ? 'var(--accent)' : 'transparent',
                      border: on ? 'none' : '1px solid var(--line-strong)'
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="shrink-0 text-faint">
                    <Mark />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{file.name}</span>
                    <span className="block truncate text-2xs text-faint">{file.url}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
