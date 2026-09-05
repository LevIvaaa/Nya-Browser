import { t } from '../i18n'
import { useState } from 'react'
import type { Profile, ProfilesState } from '../../../shared/types'
import {
  Clock,
  Download,
  Eraser,
  Gear,
  Incognito,
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
        {item(<Incognito width={15} height={15} />, t('Приватное окно'), 'Ctrl+Shift+N', () =>
          void window.browser.newWindow(true)
        )}
        <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />
        {item(<Star width={15} height={15} />, t('Закладки'), 'Ctrl+Shift+O', () => onOpen('bookmarks'))}
        {item(<Clock width={15} height={15} />, t('История'), 'Ctrl+H', () => onOpen('history'))}
        {item(<Download width={15} height={15} />, t('Загрузки'), 'Ctrl+J', () => onOpen('downloads'))}
        {item(<Key width={15} height={15} />, t('Пароли'), '', () => onOpen('passwords'))}
        <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />
        {item(<Shield width={15} height={15} />, t('Проверка безопасности'), '', () =>
          window.browser.newTab('nya://security')
        )}
        {item(<Eraser width={15} height={15} />, t('Очистить данные сайтов'), 'Ctrl+Shift+Del', () =>
          window.browser.clearBrowsingData()
        )}
        <div className="my-1.5" style={{ borderTop: '1px solid var(--line)' }} />
        {item(<Printer width={15} height={15} />, t('Печать страницы'), '', () => window.browser.print())}
        {item(<Keyboard width={15} height={15} />, t('Инструменты разработчика'), 'F12', () =>
          window.browser.openDevTools()
        )}
        {item(<Gear width={15} height={15} />, t('Настройки'), 'Ctrl+,', () => onOpen('settings'))}
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

  // Clicking the profile you are already in used to do nothing but close the
  // menu. There is nothing to switch to, so it goes where a profile can
  // actually be changed instead.
  const choose = async (profile: Profile) => {
    if (profile.id === state.activeId) {
      onManage()
      onClose()
      return
    }
    await window.browser.switchProfile(profile.id)
    onClose()
  }

  // While the create dialog is open the popover is unmounted entirely —
  // otherwise its outside-click handler would close everything under the modal.
  return (
    <>
      {!creating && (
      <Popover onClose={onClose} width={300}>
        <div className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-faint">
          {t('Профили')}
        </div>
        <div className="max-h-[320px] overflow-y-auto pb-1.5">
          {state.profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => void choose(profile)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-hover)]"
              style={{ transition: 'background var(--t-fast) linear' }}
            >
              <Avatar avatar={profile.avatar} crop={profile.crop} color={profile.color} size={30} ring={profile.id === state.activeId} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{profile.name}</span>
                <span className="block text-2xs text-faint">
                  {profile.id === state.activeId ? t('активный · настроить') : t('переключиться')}
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
            {t('Новый профиль')}
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
            {t('Управление профилями')}
          </button>
        </div>
      </Popover>
      )}

      {creating && (
        <Modal
          title={t('Новый профиль')}
          onClose={() => {
            setCreating(false)
            onClose()
          }}
          footer={
            <>
              <button className="btn" onClick={() => setCreating(false)}>
                {t('Отмена')}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const profile = await window.browser.createProfile(name || t('Профиль'))
                  setCreating(false)
                  await window.browser.switchProfile(profile.id)
                  onClose()
                }}
              >
                {t('Создать и войти')}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <span className="text-sm text-dim">
              {t('У профиля свои cookies, история, закладки, пароли и настройки. Данные не пересекаются.')}
            </span>
            <TextField value={name} onChange={setName} placeholder={t('Например, Работа')} width="100%" autoFocus />
          </div>
        </Modal>
      )}
    </>
  )
}
