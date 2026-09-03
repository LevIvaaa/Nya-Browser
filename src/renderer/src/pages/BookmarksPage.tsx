import { t } from '../i18n'
import { useMemo, useState } from 'react'
import type { Bookmark } from '../../../preload/index'
import { Cross, Folder, Pencil, Search, Star, StarFilled } from '../components/Icons'
import { EmptyState, Modal, TextField, Toggle } from '../components/ui'

export default function BookmarksPage({
  items,
  onRefresh
}: {
  items: Bookmark[]
  onRefresh: () => void
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Bookmark | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q))
  }, [items, query])

  const groups = useMemo(() => {
    const map = new Map<string, Bookmark[]>()
    for (const item of filtered) {
      const key = item.folder || t('Без папки')
      const list = map.get(key) ?? []
      list.push(item)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] === t('Без папки') ? 1 : a[0].localeCompare(b[0])))
  }, [filtered])

  return (
    <div className="relative z-10 h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 py-8">
        <header className="animate-fade-up mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t('Закладки')}</h1>
            <p className="text-sm text-dim">{items.length} сохранённых страниц</p>
          </div>
          <div className="relative">
            <Search width={14} height={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Поиск по закладкам')}
              className="field focus-ring pl-8"
              style={{ width: 260 }}
            />
          </div>
        </header>

        {groups.length === 0 ? (
          <EmptyState
            icon={<Star width={26} height={26} />}
            title={t('Закладок пока нет')}
            hint={t('Нажмите звёздочку в адресной строке или Ctrl+D, чтобы сохранить страницу.')}
          />
        ) : (
          groups.map(([folder, list]) => (
            <section key={folder} className="animate-fade-up mb-6">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-2xs font-semibold uppercase tracking-wider text-faint">
                <Folder width={12} height={12} />
                {folder}
              </h2>
              <div className="card overflow-hidden">
                {list.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-3 px-3 py-2"
                    style={{ borderTop: '1px solid var(--line)', transition: 'background var(--t-fast) linear' }}
                    onMouseOver={(event) => (event.currentTarget.style.background = 'var(--surface-hover)')}
                    onMouseOut={(event) => (event.currentTarget.style.background = 'transparent')}
                  >
                    <span className="shrink-0" style={{ color: item.pinned ? 'var(--accent)' : 'var(--text-faint)' }}>
                      {item.pinned ? <StarFilled width={14} height={14} /> : <Star width={14} height={14} />}
                    </span>
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => window.browser.navigate(item.url)}
                      onMouseEnter={() => void window.browser.preconnect(item.url)}
                    >
                      <span className="block truncate text-base">{item.title}</span>
                      <span className="block truncate text-sm text-faint">{item.url}</span>
                    </button>
                    <button className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100" title={t('Изменить')} onClick={() => setEditing(item)}>
                      <Pencil width={13} height={13} />
                    </button>
                    <button
                      className="icon-btn h-7 w-7 opacity-0 group-hover:opacity-100"
                      title={t('Удалить')}
                      onClick={async () => {
                        await window.browser.removeBookmark(item.id)
                        onRefresh()
                      }}
                    >
                      <Cross width={13} height={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {editing && (
        <BookmarkDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onRefresh()
          }}
        />
      )}
    </div>
  )
}

function BookmarkDialog({
  item,
  onClose,
  onSaved
}: {
  item: Bookmark
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(item.title)
  const [url, setUrl] = useState(item.url)
  const [folder, setFolder] = useState(item.folder)
  const [pinned, setPinned] = useState(item.pinned)

  return (
    <Modal
      title={t('Изменить закладку')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await window.browser.updateBookmark(item.id, { title, url, folder, pinned })
              onSaved()
            }}
          >
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">{t('Название')}</span>
          <TextField value={title} onChange={setTitle} width="100%" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">{t('Адрес')}</span>
          <TextField value={url} onChange={setUrl} width="100%" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-dim">{t('Папка')}</span>
          <TextField value={folder} onChange={setFolder} placeholder={t('Например, Работа')} width="100%" />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-sm text-dim">{t('Показывать на панели закладок')}</span>
          <Toggle checked={pinned} onChange={setPinned} />
        </div>
      </div>
    </Modal>
  )
}
