import { useState } from 'react'
import type { Profile, ProfilesState } from '../../../shared/types'
import {
  Clock,
  Download,
  Eraser,
  Gear,
  Key,
  Keyboard,
  Plus,
  Printer,
  Shield,
  Star,
  Users
} from './Icons'
import { Avatar, Modal, Popover, TextField } from './ui'

type View = 'settings' | 'history' | 'passwords' | 'downloads' | 'bookmarks' | 'security'

/* ------------------------------------------------------------- main menu */
export function AppMenu({ onClose, onOpen }: { onClose: () => void; onOpen: (view: View) => void }) {
  const item = (icon: React.ReactNode, label: string, shortcut: string, action: () => void) => (
    <button
      key={label}
      onClick={() => {
        action()
        onClose()
      }}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-base hover:bg-[var(--surface-hover)]"
      style={{ transition: 'background var(--t-fast) linear' }}
    >
      <span className="text-dim">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-2xs text-faint">{shortcut}</span>}
    </button>
  )

  return (
    <Popover onClose={onClose} width={280}>
      <div className="py-1.5">
        {item(<Star width={15} height={15} />, 'Закладки', 'Ctrl+Shift+O', () => onOpen('bookmarks'))}
        {item(<Clock width={15} height={15} />, 'История', 'Ctrl+H', () => onOpen('history'))}
        {item(<Download width={15} height={15} />, 'Загрузки', 'Ctrl+J', () => onOpen('downloads'))}
        {item(<Key width={15} height={15} />, 'Пароли', '', () => onOpen('passwords'))}
        <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />
        {item(<Shield width={15} height={15} />, 'Проверка безопасности', '', () =>
          window.browser.navigate('nya://security')
        )}
        {item(<Eraser width={15} height={15} />, 'Очистить данные сайтов', 'Ctrl+Shift+Del', () =>
          window.browser.clearBrowsingData()
        )}
        <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />
        {item(<Printer width={15} height={15} />, 'Печать страницы', '', () => window.browser.print())}
        {item(<Keyboard width={15} height={15} />, 'Инструменты разработчика', 'F12', () =>
          window.browser.openDevTools()
        )}
        {item(<Gear width={15} height={15} />, 'Настройки', 'Ctrl+,', () => onOpen('settings'))}
      </div>
    </Popover>
  )
}

/* ---------------------------------------------------------- profile menu */
export function ProfileMenu({
  state,
  onClose,
  onManage
}: {
  state: ProfilesState
  onClose: () => void
  onManage: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const switchTo = async (profile: Profile) => {
    if (profile.id !== state.activeId) await window.browser.switchProfile(profile.id)
    onClose()
  }

  // While the create dialog is open the popover is unmounted entirely —
  // otherwise its outside-click handler would close everything under the modal.
  return (
    <>
      {!creating && (
      <Popover onClose={onClose} width={300}>
        <div className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-faint">
          Профили
        </div>
        <div className="max-h-[320px] overflow-y-auto pb-1.5">
          {state.profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => void switchTo(profile)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
              style={{ transition: 'background var(--t-fast) linear' }}
            >
              <Avatar avatar={profile.avatar} color={profile.color} size={30} ring={profile.id === state.activeId} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{profile.name}</span>
                <span className="block text-2xs text-faint">
                  {profile.id === state.activeId ? 'активный' : 'переключиться'}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--line)' }} className="py-1.5">
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-base hover:bg-[var(--surface-hover)]"
            style={{ transition: 'background var(--t-fast) linear' }}
          >
            <Plus width={15} height={15} className="text-dim" />
            Новый профиль
          </button>
          <button
            onClick={() => {
              onManage()
              onClose()
            }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-base hover:bg-[var(--surface-hover)]"
            style={{ transition: 'background var(--t-fast) linear' }}
          >
            <Users width={15} height={15} className="text-dim" />
            Управление профилями
          </button>
        </div>
      </Popover>
      )}

      {creating && (
        <Modal
          title="Новый профиль"
          onClose={() => {
            setCreating(false)
            onClose()
          }}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                Отмена
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const profile = await window.browser.createProfile(name || 'Профиль')
                  setCreating(false)
                  await window.browser.switchProfile(profile.id)
                  onClose()
                }}
              >
                Создать и войти
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <span className="text-sm text-dim">
              У профиля свои cookies, история, закладки, пароли и настройки. Данные не пересекаются.
            </span>
            <TextField value={name} onChange={setName} placeholder="Например, Работа" width="100%" autoFocus />
          </div>
        </Modal>
      )}
    </>
  )
}
