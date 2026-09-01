import { useEffect, useState } from 'react'
import { useBrowser } from './state/useBrowser'
import CommandPalette from './components/CommandPalette'
import { AppMenu, ProfileMenu } from './components/Menus'
import UpdateCard from './components/UpdateCard'
import type { UpdateState } from '../../shared/types'

/**
 * The overlay renderer.
 *
 * It runs in its own transparent WebContentsView stacked above the page, which
 * is the only way to draw UI over a native page view. It renders nothing but
 * the floating layer — menus, popovers and the command palette — so the page
 * itself stays visible underneath.
 */
export default function OverlayApp() {
  const { settings, profiles, active, engine } = useBrowser()
  const [mode, setMode] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)

  useEffect(() => window.browser.onOverlay(setMode), [])

  // The main process opens the update card by itself when a download
  // finishes, so the state has to be here before the mode arrives.
  useEffect(() => {
    void window.browser.updateState().then(setUpdate)
    return window.browser.onUpdate(setUpdate)
  }, [])

  // Same theme tokens as the chrome UI, minus the opaque page background.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--radius', `${settings.radius}px`)
    root.style.setProperty('--speed', String(settings.reduceMotion ? 0.001 : settings.animationSpeed))
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    root.style.setProperty('--panel', String(settings.glass / 100))
    // Blurring what cannot be seen through costs frames for nothing.
    root.dataset.glass = settings.glass >= 100 ? 'off' : 'on'
    document.body.style.background = 'transparent'
    return () => media.removeEventListener('change', apply)
  }, [settings])

  const close = () => void window.browser.setOverlay(null)

  if (!mode || !settings) return null

  return (
    <div className="relative h-full w-full">
      {mode === 'palette' && (
        <CommandPalette initialValue={active?.url ?? ''} engine={engine} onClose={close} />
      )}
      {mode === 'menu' && (
        <AppMenu
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
