/**
 * Everything the settings say about how the browser looks, put on the root
 * element in one place.
 *
 * There are two renderers — the chrome and the overlay stacked above the page
 * — and they have to agree exactly, or a menu opens in a different theme from
 * the toolbar it came out of. They used to have a copy of this each.
 */
import { useEffect } from 'react'
import type { Settings } from '../../shared/types'
import { chromeManners } from './components/ui'

/** Minutes past midnight, from an "HH:MM" that has already been checked. */
const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Whether it is dark right now.
 *
 * The schedule, when it is on, beats both the setting and the system: somebody
 * who asked for light at seven and dark at eight in the evening has said what
 * they want more precisely than "follow the system" ever could. The two hours
 * may be the wrong way round — dark at 20:00 and light at 07:00 is a night
 * that crosses midnight — which is why this compares the way it does.
 */
export function isDark(settings: Settings, systemDark: boolean, now = new Date()): boolean {
  const { themeSchedule: schedule } = settings
  if (schedule.on) {
    const at = now.getHours() * 60 + now.getMinutes()
    const light = minutesOf(schedule.light)
    const dark = minutesOf(schedule.dark)
    // Light and dark at the same minute is somebody who has not finished
    // setting it up; the plain theme answers until they have.
    if (light !== dark) {
      return light < dark ? at < light || at >= dark : at >= dark && at < light
    }
  }
  return settings.theme === 'dark' || (settings.theme === 'system' && systemDark)
}

/**
 * How tight the interface is, as a multiplier on every gap and control height.
 *
 * Zero is roomy, one is as drawn, two is tight. The compact switch is the same
 * idea with two positions, and it stays because a switch is what people look
 * for; it simply moves the slider when nobody has touched the slider.
 */
export function densityOf(settings: Settings): number {
  const base = settings.density
  // The old switch still means something to anybody who turned it on: it is
  // the tight end of the same slider, and it moves it only if nobody has.
  if (settings.compact && base === 1) return 2
  return base
}

/**
 * The heights of the chrome, from the one density number.
 *
 * Four pixels a step either way: at the roomy end the toolbar is 48 and a tab
 * 38, at the tight end 40 and 30. Below that the 15px icons start touching the
 * edges, above it a laptop screen is mostly browser.
 */
export const toolbarHeight = (settings: Settings) => Math.round(48 - densityOf(settings) * 4)
export const tabHeight = (settings: Settings) => Math.round(38 - densityOf(settings) * 4)

/** Puts the whole look on the root element, and keeps the clock honest. */
export function useLook(settings: Settings | null, accent?: string): void {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      root.dataset.theme = isDark(settings, media.matches) ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    // A schedule is a clock, and a clock has to be looked at. Once a minute is
    // often enough to change the theme within a minute of the hour asked for,
    // and cheap enough that nobody will ever notice it running.
    const tick = settings.themeSchedule.on ? window.setInterval(apply, 60_000) : null

    root.style.setProperty('--accent', accent || settings.accent)
    root.style.setProperty('--radius', `${settings.radius}px`)
    root.style.setProperty('--speed', String(settings.reduceMotion ? 0.001 : settings.animationSpeed))
    root.dataset.motion = settings.reduceMotion ? 'reduced' : 'full'
    /*
     * How see-through the panels are.
     *
     * High contrast wants them solid, and it has to win here rather than in the
     * stylesheet: everything on this element is an inline style, and an inline
     * style beats any rule a sheet can write.
     */
    const panel = settings.highContrast ? 1 : settings.glass / 100
    root.style.setProperty('--panel', String(panel))
    // Blurring what cannot be seen through costs frames for nothing.
    root.dataset.glass = panel >= 1 ? 'off' : 'on'

    /*
     * Density, as one number every gap is derived from.
     *
     * 0 → 1.18, 1 → 1, 2 → 0.82: eighteen per cent either way is the most that
     * still leaves room for a 15px icon in a control and keeps text off the
     * edges. Everything that spaces the chrome multiplies by it.
     */
    root.style.setProperty('--density', String(1.18 - densityOf(settings) * 0.18))
    root.dataset.contrast = settings.highContrast ? 'high' : 'normal'
    // A press that answers. Small enough to feel rather than watch.
    root.dataset.feedback = settings.feedback ? 'on' : 'off'
    chromeManners.shortcuts = settings.shortcutsInTips
    chromeManners.feedback = settings.feedback
    root.style.setProperty(
      '--ui-font',
      settings.uiFont ? `'${settings.uiFont}', var(--ui-font-stack)` : 'var(--ui-font-stack)'
    )

    return () => {
      media.removeEventListener('change', apply)
      if (tick) window.clearInterval(tick)
    }
  }, [settings, accent])
}
