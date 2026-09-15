import { useEffect, useState } from 'react'
import { applyLanguage, onLanguageChange } from './i18n'
import { useBrowser } from './state/useBrowser'
import CommandPalette from './components/CommandPalette'
import { useLook } from './look'
import { AppMenu, ProfileMenu } from './components/Menus'
import GroupColour from './components/GroupColour'
import AutofillCard from './components/AutofillOffer'
import InstallApp from './components/InstallApp'
import MediaPanel from './components/MediaPanel'
import PageFiles from './components/PageFiles'
import PictureText from './components/PictureText'
import PageMenu from './components/PageMenu'
import PrintSheet from './components/PrintSheet'
import SavePassword from './components/SavePassword'
import ShotEditor from './components/ShotEditor'
import TabsPanel from './components/TabsPanel'
import SitePanel from './components/SitePanel'
import UpdateCard from './components/UpdateCard'
import type { UpdateState } from '../../shared/types'
import type { PageFile } from '../../preload/index'

/**
 * The overlay renderer.
 *
 * It runs in its own transparent WebContentsView stacked above the page, which
 * is the only way to draw UI over a native page view. It renders nothing but
 * the floating layer — menus, popovers and the command palette — so the page
 * itself stays visible underneath.
 */
export default function OverlayApp() {
  const { settings, profiles, profile, active, engine, groups, spaces, tabs, appCandidate, autofill, savePassword } =
    useBrowser()
  const [mode, setMode] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [, setLangVersion] = useState(0)
  useEffect(() => onLanguageChange(() => setLangVersion((v) => v + 1)), [])
  useEffect(() => {
    if (settings) void applyLanguage(settings.language)
  }, [settings?.language])

  useEffect(() => window.browser.onOverlay(setMode), [])

  // The main process opens the update card by itself when a download
  // finishes, so the state has to be here before the mode arrives.
  useEffect(() => {
    void window.browser.updateState().then(setUpdate)
    return window.browser.onUpdate(setUpdate)
  }, [])

  // Same tokens as the chrome UI, minus the opaque page background.
  useLook(settings, settings?.accentFromProfile ? profile?.color : undefined)
  useEffect(() => {
    document.body.style.background = 'transparent'
  }, [])

  const close = () => void window.browser.setOverlay(null)

  // The picture arrives on its own channel, because it is far too big to sit
  // in the name of a mode.
  const [shot, setShot] = useState('')
  useEffect(() => window.browser.onShot(setShot), [])

  // The same for the list of files a page has on it: it arrives before the
  // mode that shows it.
  const [files, setFiles] = useState<PageFile[]>([])
  useEffect(() => window.browser.onFiles(setFiles), [])

  // The words read out of a picture arrive the same way.
  const [pictureText, setPictureText] = useState('')
  useEffect(() => window.browser.onPictureText((data) => setPictureText(data.text)), [])

  if (!mode || !settings) return null

  return (
    <div className="relative h-full w-full">
      {mode === 'site' && <SitePanel onClose={close} />}
      {mode === 'autofill' && <AutofillCard offer={autofill} onClose={close} />}
      {mode === 'print' && <PrintSheet onClose={close} />}
      {mode === 'files' && <PageFiles files={files} onClose={close} />}
      {mode === 'picture-text' && <PictureText text={pictureText} onClose={close} />}
      {mode === 'save-password' && <SavePassword offer={savePassword} onClose={close} />}
      {mode.startsWith('tabs-panel:') && (
        <TabsPanel
          tabs={tabs}
          groups={groups}
          spaces={spaces}
          x={Number(mode.slice('tabs-panel:'.length)) || 0}
          onClose={close}
        />
      )}
      {mode.startsWith('media:') && (
        <MediaPanel x={Number(mode.slice('media:'.length)) || 0} onClose={close} />
      )}
      {mode.startsWith('page-menu:') && (
        <PageMenu
          tab={active}
          x={Number(mode.slice('page-menu:'.length)) || 0}
          onClose={close}
          onFind={() => void window.browser.uiAction('find')}
        />
      )}
      {mode === 'shot' && shot && (
        <ShotEditor
          image={shot}
          onClose={() => {
            setShot('')
            close()
          }}
        />
      )}
      {mode === 'install-app' && <InstallApp candidate={appCandidate} onClose={close} />}
      {mode.startsWith('group-colour:') && (
        <GroupColour
          group={groups.find((g) => g.id === Number(mode.slice('group-colour:'.length))) ?? null}
          onClose={close}
        />
      )}
      {mode === 'palette' && (
        <CommandPalette initialValue={active?.url ?? ''} engine={engine} onClose={close} />
      )}
      {mode === 'menu' && (
        <AppMenu
          order={settings?.menuOrder ?? []}
          onClose={close}
          onOpen={(view) => {
            if (view === 'security') {
              void window.browser.navigate('nya://security')
              return close()
            }
            void window.browser.setOverlay(null)
            window.browser.openChromePage(view)
          }}
        />
      )}
      {mode === 'update' && update && <UpdateCard state={update} onClose={close} />}
      {mode === 'profiles' && profiles && (
        <ProfileMenu
          state={profiles}
          onClose={close}
          onManage={() => {
            void window.browser.setOverlay(null)
            window.browser.openChromePage('settings#profiles')
          }}
        />
      )}
    </div>
  )
}
